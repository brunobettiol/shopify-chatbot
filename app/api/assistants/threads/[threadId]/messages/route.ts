import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { appendMessage } from '../../sessionStore';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';
const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

// Preflight handler for CORS
export async function OPTIONS() {
  console.log('OPTIONS request received.');
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

/**
 * This version intercepts the streaming NDJSON output from OpenAI.
 * It accumulates JSON fragments from delta events and checks for a final
 * "thread.run.requires_action" event to extract the complete function call arguments.
 * If any tool call arguments are detected, it calls the product API and uses its output.
 * Finally, it appends the assistant’s response to the session history and sends two final output chunks:
 * one with the final text (event "final") and one marker (event "run.complete").
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  console.log(`POST /messages invoked for threadId: ${threadId}`);
  try {
    const { content } = await request.json();
    console.log(`User message received: ${content}`);

    // Save the user's message to the session history.
    await appendMessage(threadId, 'user', content);
    console.log('User message appended to session history.');

    // Send the user's message to OpenAI.
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content,
    });
    console.log('User message sent to OpenAI.');

    // Initiate streaming response from OpenAI.
    const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    } as any);
    console.log('Streaming response initiated from OpenAI.');

    let readable: ReadableStream<any>;
    if (typeof (stream as any).toReadableStream === 'function') {
      readable = (stream as any).toReadableStream() as ReadableStream<any>;
    } else {
      readable = (stream as unknown) as ReadableStream<any>;
    }

    const decoder = new TextDecoder();
    let fullResponseData = "";
    let toolCallAccumulator = "";
    let toolCallId: string | null = null;
    let assistantText = "";
    const reader = readable.getReader();

    // Create a new intercepted stream that will include final markers.
    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Starting to read the streaming data...');
          // Read all the streaming chunks
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk:', chunk);
            fullResponseData += chunk;
            // Forward the raw chunk immediately to the client
            controller.enqueue(value);
          }
        } catch (err) {
          console.error("Error reading assistant stream:", err);
          controller.error(err);
        }
        // Process the full streaming data after reading is complete.
        try {
          const lines = fullResponseData.split("\n").filter(line => line.trim() !== "");
          console.log(`Total lines received: ${lines.length}`);
          for (const line of lines) {
            console.log("Processing line:", line);
            let jsonObj;
            try {
              jsonObj = JSON.parse(line);
            } catch (e) {
              console.error("Error parsing JSON line:", e, line);
              continue;
            }

            // Check for delta tool_calls fragments.
            if (jsonObj.choices && jsonObj.choices[0]?.delta?.tool_calls) {
              const toolCalls = jsonObj.choices[0].delta.tool_calls;
              for (const tc of toolCalls) {
                if (tc.id) {
                  toolCallId = tc.id;
                }
                if (tc.function && tc.function.arguments) {
                  toolCallAccumulator += tc.function.arguments;
                  console.log("Accumulating tool call arguments:", toolCallAccumulator);
                }
              }
            }

            // Check for a final requires_action event which contains complete tool call arguments.
            if (jsonObj.event === "thread.run.requires_action") {
              const requiredAction = jsonObj.data?.required_action;
              if (
                requiredAction &&
                requiredAction.submit_tool_outputs &&
                Array.isArray(requiredAction.submit_tool_outputs.tool_calls)
              ) {
                for (const call of requiredAction.submit_tool_outputs.tool_calls) {
                  if (call.function && call.function.arguments) {
                    toolCallAccumulator += call.function.arguments;
                    console.log("Accumulated from requires_action:", toolCallAccumulator);
                  }
                }
              }
            }

            // Accumulate normal text responses from delta events.
            if (jsonObj.event === "thread.message.delta") {
              const delta = jsonObj.data?.delta;
              if (delta) {
                if (Array.isArray(delta.content)) {
                  for (const part of delta.content) {
                    if (part.type === "text" && part.text?.value) {
                      assistantText += part.text.value;
                    }
                  }
                } else if (typeof delta.content === "string") {
                  assistantText += delta.content;
                }
              }
            }

            // Also check for a final message event.
            if (jsonObj.event === "thread.message") {
              const message = jsonObj.data?.message;
              if (message && message.content) {
                assistantText += message.content;
              }
            }
          }

          // If tool call arguments were accumulated, process them.
          if (toolCallAccumulator) {
            try {
              const parsedArgs = JSON.parse(toolCallAccumulator);
              const searchQuery = parsedArgs.query;
              console.log("Parsed function call arguments, search query:", searchQuery);
              if (searchQuery) {
                console.log("Calling product API with search query:", searchQuery);
                const productResponse = await fetch("https://shopify-chatbot-production-044b.up.railway.app/api/shopify/products", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ product_name: searchQuery })
                });
                console.log("Product API response status:", productResponse.status);
                if (!productResponse.ok) {
                  const prodError = await productResponse.text();
                  console.error("Product API error:", prodError);
                } else {
                  const products = await productResponse.json();
                  console.log("Product API returned products, count:", products.length);
                  if (products && products.length > 0) {
                    const product = products[0]; // simple selection logic
                    const productLink = "https://partnerinaging.myshopify.com/products/" + product.handle;
                    // Overwrite the assistantText with our function call result
                    assistantText = `I recommend **${product.title}**. Price: ${product.price} ${product.currency}. Check it out here: ${productLink}`;
                    console.log("Selected product:", product.title, "Link:", productLink);
                  }
                }
              }
            } catch (functionError) {
              console.error("Error during function call handling:", functionError);
            }
          } else {
            console.log("No tool call arguments accumulated.");
          }

          console.log("Final assistant text after processing:", assistantText);
          if (assistantText) {
            // Enqueue a final chunk with the final text as JSON.
            const finalChunkObj = {
              event: "final",
              content: assistantText
            };
            const finalChunk = new TextEncoder().encode(JSON.stringify(finalChunkObj) + "\n");
            controller.enqueue(finalChunk);
            // Append the final assistant message to the session history.
            await appendMessage(threadId, 'assistant', assistantText);
            console.log("Assistant message appended to session history.");
          }
          // Enqueue a final "run complete" marker so the frontend knows the run is finished.
          const completeMarker = new TextEncoder().encode(JSON.stringify({ event: "run.complete" }) + "\n");
          controller.enqueue(completeMarker);
        } catch (parseError) {
          console.error("Error processing assistant response data:", parseError);
        } finally {
          // Only close the controller after final markers are sent.
          controller.close();
        }
      }
    });

    return new NextResponse(interceptedStream, {
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error: any) {
    console.error('Error in POST /messages:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
}
