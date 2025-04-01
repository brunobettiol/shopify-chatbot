import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { appendMessage } from '../../sessionStore';

const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

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
  { params }: { params: { threadId: string } }
) {
  try {
    const { threadId } = params;
    const { toolCallOutputs, runId } = await request.json();

    // Submit tool outputs and obtain a streaming response from OpenAI
    const stream = openai.beta.threads.runs.submitToolOutputsStream(threadId, runId, {
      tool_outputs: toolCallOutputs
    });

    let readable: ReadableStream<any>;
    if (typeof (stream as any).toReadableStream === 'function') {
      readable = (stream as any).toReadableStream() as ReadableStream<any>;
    } else {
      readable = (stream as unknown) as ReadableStream<any>;
    }

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
          console.error("Error reading assistant stream (tool output):", err);
          controller.error(err);
        } finally {
          // Parse the accumulated NDJSON response to extract assistant text
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
            console.error("Error parsing assistant response (tool output):", parseError);
          }
          // Save the assistant's reply from the tool output to session history
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
    console.error('Error in POST /actions:', error);
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
