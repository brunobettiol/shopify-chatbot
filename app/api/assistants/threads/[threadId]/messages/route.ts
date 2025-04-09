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
 * It accumulates JSON fragments (including function calls) and processes any tool call
 * by invoking the product API. Instead of selecting a single product or simply appending
 * the raw JSON product list, it builds a new prompt that includes the original user query
 * and the full list of product options. That prompt is sent to ChatGPT to generate a natural
 * language product recommendation.
 *
 * Two final JSON chunks are sent ("final" and "run.complete"). A longer delay (2000ms) is
 * applied before appending the final assistant message, to help ensure the OpenAI run is fully finalized.
 * After generating the final recommendation, any active run (identified by runId) is terminated.
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
    // New variable to store run ID.
    let runId: string | null = null;
    const reader = readable.getReader();

    // Create an intercepted stream that will include extra final markers.
    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Starting to read the streaming data...');
          // Read all streaming chunks.
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk:', chunk);
            fullResponseData += chunk;
            // Immediately forward the raw chunk to the client.
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

            // Capture the run ID when the run is created.
            if (!runId && jsonObj.event === "thread.run.created" && jsonObj.data?.id) {
              runId = jsonObj.data.id;
              console.log("Captured runId:", runId);
            }

            // Accumulate fragments from tool_calls.
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

            // Also check for a final requires_action event that can provide tool call arguments.
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

            // Accumulate text responses.
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

            // Also capture final message event text.
            if (jsonObj.event === "thread.message") {
              const message = jsonObj.data?.message;
              if (message && message.content) {
                assistantText += message.content;
              }
            }
          }

          // If a tool call was detected, process it.
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
                    // Map through all products.
                    const productInfo = products.map((product: any) => ({
                      title: product.title,
                      price: product.price,
                      currency: product.currency,
                      link: "https://partnerinaging.myshopify.com/products/" + product.handle
                    }));
                    
                    // Build a new prompt for ChatGPT that includes the original query and the product list.
                    const additionalPrompt = `User query: "${content}"\n\nProduct options:\n${JSON.stringify(productInfo, null, 2)}\n\nBased on the product options above, provide a natural language recommendation that best matches the user's query.`;
                    
                    // Call ChatGPT to generate the final recommendation.
                    const chatResponse = await openai.chat.completions.create({
                      model: "gpt-4",
                      messages: [
                        {
                          role: "system",
                          content:
`You are a product recommendation expert. Analyze the product options provided and generate a natural, friendly recommendation that best answers the user query.`,
                        },
                        { role: "user", content: additionalPrompt }
                      ],
                      temperature: 0.7,
                    });
                    
                    const recommendation = chatResponse.choices[0].message.content;
                    console.log("Product recommendation generated:", recommendation);
                    // Only update assistantText if recommendation is not null.
                    if (recommendation !== null) {
                      assistantText = recommendation;
                    }
                    // Terminate the active run if possible.
                    if (runId) {
                      try {
                        await openai.beta.threads.runs.terminate(threadId, runId);
                        console.log("Active run terminated successfully.");
                      } catch (terminationError) {
                        console.error("Error terminating the active run:", terminationError);
                      }
                    }
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
            // Enqueue a final chunk with the assistant text.
            const finalChunkObj = { event: "final", content: assistantText };
            const finalChunk = new TextEncoder().encode(JSON.stringify(finalChunkObj) + "\n");
            controller.enqueue(finalChunk);
            // Wait 2000ms to help ensure the run is finalized.
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Append the final assistant message to the session history.
            await appendMessage(threadId, 'assistant', assistantText);
            console.log("Assistant message appended to session history.");
          }
          // Enqueue the final "run.complete" marker.
          const completeMarker = new TextEncoder().encode(JSON.stringify({ event: "run.complete" }) + "\n");
          controller.enqueue(completeMarker);
        } catch (parseError) {
          console.error("Error processing assistant response data:", parseError);
        } finally {
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
