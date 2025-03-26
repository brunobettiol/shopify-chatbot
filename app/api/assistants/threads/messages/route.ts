import openai from 'app/openai';
const assistantId: string = process.env.OPENAI_ASSISTANT_ID ?? 'default_assistant_id';

export async function POST(request: any, { params: { threadId } }: any) {
  const { content } = await request.json();
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content,
  });
  const stream = openai.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
  });
  return new Response(stream.toReadableStream());
}