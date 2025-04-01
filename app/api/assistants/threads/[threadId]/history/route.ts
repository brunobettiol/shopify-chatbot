import { getHistory, clearHistory } from '../../sessionStore';
import { NextResponse } from 'next/server';

const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> }
) {
  const { threadId } = params;
  const history = getHistory(threadId);
  if (!history) {
    return new NextResponse(JSON.stringify({ error: "Thread not found" }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  return NextResponse.json(history, {
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Record<string, string> }
) {
  const { threadId } = params;
  const history = getHistory(threadId);
  if (!history) {
    return new NextResponse(JSON.stringify({ error: "Thread not found" }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  clearHistory(threadId);
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
