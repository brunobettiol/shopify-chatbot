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
 * This version intercepts the streaming NDJSON output and looks for tool_calls.
 * It accumulates the JSON fragments of tool call arguments and, if complete,
 * calls the product API endpoint. Finally, it appends the (possibly updated)
 * assistant response to session history.
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

    // Save the user's message to the session history
    await appendMessage(threadId, 'user', content);
    console.log('User message appended to session history.');

    // Send the user message to OpenAI
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content,
    });
    console.log('User message sent to OpenAI.');

    // Initiate streaming response from OpenAI.
    // Ensure your openai module is configured to use model "gpt-4-0125-preview".
    const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId
      // Note: The streaming endpoint does support tool_calls with the proper model.
      // If you encounter errors, you may need to upgrade the endpoint or use a non-streaming endpoint.
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

    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Starting to read the streaming data...');
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk:', chunk);
            fullResponseData += chunk;
            controller.enqueue(value);
          }
          controller.close();
          console.log('Finished reading stream.');
        } catch (err) {
          console.error("Error reading assistant stream:", err);
          controller.error(err);
        } finally {
          try {
            const lines = fullResponseData.split("\n").filter(line => line.trim() !== "");
            console.log(`Total lines received: ${lines.length}`);
            for (const line of lines) {
              console.log("Processing line:", line);
              const jsonObj = JSON.parse(line);
              // Check for tool_calls in delta
              if (jsonObj.choices && jsonObj.choices[0] && jsonObj.choices[0].delta && jsonObj.choices[0].delta.tool_calls) {
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
              // Also accumulate normal text responses
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
          // If we accumulated any tool call arguments, attempt to process them.
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
            await appendMessage(threadId, 'assistant', assistantText);
            console.log("Assistant message appended to session history.");
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
