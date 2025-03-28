import openai from 'app/openai';

const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    // Await params to extract dynamic parameters
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

    // Narrow the type so that we always pass a native ReadableStream to the Response
    let readable: ReadableStream<any>;
    if (typeof (stream as any).toReadableStream === 'function') {
      readable = ((stream as any).toReadableStream() as unknown) as ReadableStream<any>;
    } else {
      readable = (stream as unknown) as ReadableStream<any>;
    }

    return new Response(readable);
  } catch (error: any) {
    console.error('Error in POST /messages:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
