import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { appendMessage } from '../../sessionStore';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';
const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

// Preflight handler for CORS
export async function OPTIONS() {
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
 * In this modified version we intercept the stream’s full response data.
 * After the streaming finishes we check whether a function call was returned.
 * If so, we call the products API endpoint (for example, with a search query)
 * and update the conversation history with a natural assistant reply that includes
 * product information.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  try {
    const { content } = await request.json();

    // Save the user's message to the session history
    await appendMessage(threadId, 'user', content);

    // Create a new message in the thread (send the user message to OpenAI)
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content,
    });

    // Start the streaming response for the assistant's reply
    const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    let readable: ReadableStream<any>;
    if (typeof (stream as any).toReadableStream === 'function') {
      readable = (stream as any).toReadableStream() as ReadableStream<any>;
    } else {
      readable = (stream as unknown) as ReadableStream<any>;
    }

    // Intercept the stream to accumulate the assistant's full response
    const decoder = new TextDecoder();
    let fullResponseData = "";
    const reader = readable.getReader();

    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullResponseData += decoder.decode(value, { stream: true });
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          console.error("Error reading assistant stream:", err);
          controller.error(err);
        } finally {
          // After stream completion, parse the accumulated NDJSON data.
          let assistantText = "";
          let functionCallData = null;
          try {
            const lines = fullResponseData.split("\n").filter(line => line.trim() !== "");
            for (const line of lines) {
              const jsonObj = JSON.parse(line);
              // If a delta event contains a function_call field, capture it.
              if (jsonObj.message && jsonObj.message.function_call) {
                functionCallData = jsonObj.message.function_call;
                // Optionally break here if you assume only one function call.
                break;
              }
              if (jsonObj.event === "thread.message.delta") {
                const delta = jsonObj.data?.delta;
                if (delta && Array.isArray(delta.content)) {
                  for (const part of delta.content) {
                    if (part.type === "text" && part.text?.value) {
                      assistantText += part.text.value;
                    }
                  }
                }
              }
            }
          } catch (parseError) {
            console.error("Error parsing assistant response data:", parseError);
          }
          // If a function call was detected, call the product API endpoint.
          if (functionCallData) {
            try {
              let searchQuery = "";
              try {
                const args = JSON.parse(functionCallData.arguments);
                searchQuery = args.query;
              } catch (e) {
                console.error("Failed to parse function call arguments:", e);
              }
              if (searchQuery) {
                const productResponse = await fetch("https://shopify-chatbot-production-044b.up.railway.app/api/shopify/products", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ product_name: searchQuery })
                });
                if (!productResponse.ok) {
                  console.error("Product API error:", await productResponse.text());
                } else {
                  const products = await productResponse.json();
                  if (products && products.length > 0) {
                    const product = products[0]; // simple selection logic
                    const productLink = "https://partnerinaging.myshopify.com/products/" + product.handle;
                    assistantText = `I recommend **${product.title}**. Price: ${product.price} ${product.currency}. Check it out here: ${productLink}`;
                  }
                }
              }
            } catch (functionError) {
              console.error("Error during function call handling:", functionError);
            }
          }
          // Save the full (or updated) assistant reply to session history.
          if (assistantText) {
            await appendMessage(threadId, 'assistant', assistantText);
          }
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
