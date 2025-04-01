import openai from 'app/openai';
import { NextResponse } from 'next/server';
import { createSession, appendMessage } from './sessionStore';

const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

// Handle preflight OPTIONS requests
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

export async function POST() {
  try {
    // Create a new thread via OpenAI API
    const thread = await openai.beta.threads.create();
    const threadId: string = thread.id;
    // Initialize session history for this thread (guest session)
    createSession(threadId);
    // Optionally add an initial assistant greeting to the session history
    appendMessage(threadId, 'assistant', 'Chat started!');
    // Return the new thread ID to the client with CORS headers
    return NextResponse.json(
      { threadId },
      {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      }
    );
  } catch (error: any) {
    console.error('Error creating new thread:', error);
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
