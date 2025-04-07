import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { appendMessage } from '../../sessionStore';
import { Readable } from 'stream';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';
const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

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

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  console.log(`POST /messages invoked for threadId: ${threadId}`);
  try {
    const { content } = await request.json();
    console.log(`User message received: ${content}`);

    // Save user's message to session history
    await appendMessage(threadId, 'user', content);
    console.log('User message appended to session history.');

    // Send user message to OpenAI
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content,
    });
    console.log('User message sent to OpenAI.');

    // Initiate streaming response from OpenAI
    const assistantStream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    // Convert the assistant stream to a Node.js Readable stream
    const nodeReadable = Readable.from(assistantStream as any);
    // Convert the Node.js stream into a Web ReadableStream so that we can use getReader()
    const webReadable = Readable.toWeb(nodeReadable);
    const reader = webReadable.getReader();

    const decoder = new TextDecoder();
    let fullResponseData = '';
    let toolCallArgs = '';
    let toolCallDetected = false;
    let assistantText = '';

    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Ensure value is a Uint8Array; if it's a string, convert it.
            let chunk: Uint8Array;
            if (typeof value === 'string') {
              chunk = new TextEncoder().encode(value);
            } else if (value instanceof Uint8Array) {
              chunk = value;
            } else {
              // Fallback conversion
              chunk = new Uint8Array(value);
            }
            
            const chunkStr = decoder.decode(chunk, { stream: true });
            fullResponseData += chunkStr;
            controller.enqueue(chunk);

            const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
              try {
                const json = JSON.parse(line);
                // Look for tool call function arguments
                if (json.choices && json.choices[0]?.delta?.tool_calls) {
                  const toolCalls = json.choices[0].delta.tool_calls;
                  for (const call of toolCalls) {
                    if (call.function?.arguments) {
                      toolCallDetected = true;
                      toolCallArgs += call.function.arguments;
                    }
                  }
                }
                // Accumulate normal text responses
                if (json.event === 'thread.message.delta') {
                  const delta = json.data?.delta;
                  if (delta?.content) {
                    for (const part of delta.content) {
                      if (part.type === 'text' && part.text?.value) {
                        assistantText += part.text.value;
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn('Skipping malformed JSON line');
              }
            }
          }
          controller.close();
        } catch (err) {
          console.error('Error reading assistant stream:', err);
          controller.error(err);
        } finally {
          // If a tool call was detected, process it
          if (toolCallDetected && toolCallArgs) {
            try {
              const parsedArgs = JSON.parse(toolCallArgs);
              const query = parsedArgs.query;
              console.log('Function call detected with query:', query);

              const productResponse = await fetch(
                'https://shopify-chatbot-production-044b.up.railway.app/api/shopify/products',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ product_name: query }),
                }
              );

              if (!productResponse.ok) {
                console.error('Failed to fetch products');
              } else {
                const products = await productResponse.json();
                if (products?.length > 0) {
                  const product = products[0];
                  const productLink = `https://partnerinaging.myshopify.com/products/${product.handle}`;
                  assistantText = `I recommend **${product.title}**. Price: ${product.price} ${product.currency}. [View it here](${productLink})`;
                } else {
                  assistantText = `I couldn't find any products matching **${query}**.`;
                }
              }
            } catch (err) {
              console.error('Error handling tool call:', err);
            }
          }

          // Append the final assistant text to session history if available
          if (assistantText) {
            await appendMessage(threadId, 'assistant', assistantText);
            console.log('Final assistant message:', assistantText);
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
    console.error('POST /messages error:', error);
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
