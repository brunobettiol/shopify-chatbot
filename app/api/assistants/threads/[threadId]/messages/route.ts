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
 * by invoking the product API. Instead of simply appending a JSON dump of all products,
 * it builds a concise prompt that includes the original user query and a bullet‑point list
 * of product options (with formatted prices). That prompt is sent to ChatGPT to generate
 * a natural language product recommendation.
 *
 * Finally, a single final JSON chunk containing the recommendation is streamed,
 * and the final recommendation is appended to the session history.
 * After that, if available, the active run is cancelled using the cancel method.
 * A "run.complete" marker is also enqueued.
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

    // Save the user's message to session history.
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
    // Variable to capture run ID.
    let runId: string | null = null;
    const reader = readable.getReader();

    // Create an intercepted stream for extra final markers.
    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Starting to read streaming data...');
          // Read all streaming chunks.
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk:', chunk);
            fullResponseData += chunk;
            // Immediately forward the raw chunk.
            controller.enqueue(value);
          }
        } catch (err) {
          console.error("Error reading assistant stream:", err);
          controller.error(err);
        }
        // Process the full streaming data.
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
            // Capture the run ID.
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
            // Also check for final requires_action event.
            if (jsonObj.event === "thread.run.requires_action") {
              const requiredAction = jsonObj.data?.required_action;
              if (requiredAction && requiredAction.submit_tool_outputs && Array.isArray(requiredAction.submit_tool_outputs.tool_calls)) {
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
            // Capture final message text.
            if (jsonObj.event === "thread.message") {
              const message = jsonObj.data?.message;
              if (message && message.content) {
                assistantText += message.content;
              }
            }
          }
          
          // Process tool call if detected.
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
                    // Format the product price properly (assuming raw price is in cents).
                    const productInfo = products.map((product: any) => ({
                      title: product.title,
                      price: (parseFloat(product.price) / 100).toFixed(2),
                      currency: product.currency,
                      link: "https://partnerinaging.myshopify.com/products/" + product.handle
                    }));
                    // Build a bullet list of product options.
                    const bulletList = productInfo
                      .map((p: any) => `• ${p.title}: ${p.price} ${p.currency} (<a href="${p.link}" target="_blank" rel="noopener noreferrer">Buy Here</a>)`)
                      .join("\n");
                    const additionalPrompt = `User query: "${content}"\n\nI found the following product options:\n${bulletList}\n\nBased on these options, please provide a concise and natural language recommendation for the best matching product. Note: Use the provided prices exactly as listed.`;
                    
                    // Call ChatGPT to generate the final recommendation.
                    const chatResponse = await openai.chat.completions.create({
                      model: "gpt-4",
                      messages: [
                        {
                          role: "system",
                          content:
`You are a product recommendation expert. Analyze the product options provided and generate a natural, friendly recommendation that best answers the user's query. Please ensure that any product purchase links in your recommendation are embedded as clickable HTML <a> tags.`,
                        },
                        { role: "user", content: additionalPrompt }
                      ],
                      temperature: 0.7,
                    });
                    
                    const recommendation = chatResponse.choices[0].message.content;
                    console.log("Product recommendation generated:", recommendation);
                    if (recommendation !== null) {
                      assistantText = recommendation;
                    }
                    // Cancel the active run if possible.
                    if (runId && typeof (openai.beta.threads.runs as any).cancel === "function") {
                      try {
                        await (openai.beta.threads.runs as any).cancel(threadId, runId);
                        console.log("Active run cancelled successfully.");
                      } catch (cancellationError) {
                        console.error("Error cancelling the active run:", cancellationError);
                      }
                    } else {
                      console.log("Cancel method not available; skipping cancellation.");
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
            // Enqueue a single final chunk with the assistant text.
            const finalChunkObj = { event: "final", content: assistantText };
            const finalChunk = new TextEncoder().encode(JSON.stringify(finalChunkObj) + "\n");
            controller.enqueue(finalChunk);
            // Wait 2000ms to help ensure the run is fully finalized.
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
