import openai from 'app/openai';
import { NextResponse } from 'next/server';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';
const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

// Preflight handler
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
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await params;
    const { content } = await request.json();

    // Create a new message in the thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content,
    });

    // Start the streaming response for the thread
    const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: assistantId,
    });

    let readable: ReadableStream<any>;
    if (typeof (stream as any).toReadableStream === 'function') {
      readable = ((stream as any).toReadableStream() as unknown) as ReadableStream<any>;
    } else {
      readable = (stream as unknown) as ReadableStream<any>;
    }

    return new NextResponse(readable, {
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
