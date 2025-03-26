// app/api/assistants/threads/route.ts
import openai from 'app/openai';

export async function POST() {
  const thread = await openai.beta.threads.create();
  return Response.json({ threadId: thread.id });
}
