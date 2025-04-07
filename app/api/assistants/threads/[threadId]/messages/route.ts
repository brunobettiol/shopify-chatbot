import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { appendMessage } from '../../sessionStore';
import { Readable } from 'stream';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';
const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

// Global in‑memory active run tracker (for demonstration only)
const activeRuns: Record<string, boolean> = {};

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
    // Prevent adding a new message if a run is still active.
    if (activeRuns[threadId]) {
      return new NextResponse(
        JSON.stringify({ error: "A run is already active for this thread. Please wait until it finishes." }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        }
      );
    }

    const { content } = await request.json();
    console.log(`User message received: ${content}`);

    // Save the user's message to session history.
    await appendMessage(threadId, 'user', content);
    console.log('User message appended to session history.');

    // Send the user's message to OpenAI.
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content,
    });
    console.log('User message sent to OpenAI.');

    // Mark the run as active.
    activeRuns[threadId] = true;

    // Initiate the streaming run.
    const assistantStream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    // Convert the assistant stream (which may be an async iterable) into a Node.js Readable stream.
    const nodeReadable = Readable.from(assistantStream as any);
    // Convert the Node.js stream to a Web ReadableStream (which provides getReader()).
    const webReadable = Readable.toWeb(nodeReadable);

    // When the stream completes, mark the run as finished.
    (async () => {
      const reader = webReadable.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      activeRuns[threadId] = false;
    })();

    // Cast the webReadable to a BodyInit so NextResponse accepts it.
    return new NextResponse(webReadable as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/x-ndjson',
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
