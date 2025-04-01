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

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> }
) {
  try {
    const { threadId } = params;
    const { content } = await request.json();

    // Save the user's message to the session history
    appendMessage(threadId, 'user', content);

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
          // Parse the accumulated NDJSON data to extract assistant text
          let assistantText = "";
          try {
            const lines = fullResponseData.split("\n").filter(line => line.trim() !== "");
            for (const line of lines) {
              const jsonObj = JSON.parse(line);
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
          // Save the full assistant reply to session history
          if (assistantText) {
            appendMessage(threadId, 'assistant', assistantText);
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
