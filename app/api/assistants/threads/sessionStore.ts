import { createClient } from 'redis';

interface ChatMessage {
  role: string;
  text: string;
}

interface Session {
  messages: ChatMessage[];
  lastActive: number;
}

const INACTIVITY_LIMIT_SECONDS = 3 * 24 * 60 * 60; // 3 days in seconds

// Read Redis URL from environment variables
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("Missing REDIS_URL environment variable");
}

// Create and connect Redis client using the .env connection string
const redisClient = createClient({ url: redisUrl });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

(async () => {
  try {
    await redisClient.connect();
    console.log("Connected to Redis");
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
  }
})();

// Helper function to get the key for a session by threadId
function getSessionKey(threadId: string): string {
  return `session:${threadId}`;
}

/**
 * Creates a new session for a given thread.
 */
export async function createSession(threadId: string): Promise<void> {
  const session: Session = {
    messages: [],
    lastActive: Date.now(),
  };
  const key = getSessionKey(threadId);
  await redisClient.set(key, JSON.stringify(session));
  await redisClient.expire(key, INACTIVITY_LIMIT_SECONDS);
}

/**
 * Appends a new message to a session’s history.
 * If no session exists, a new one is created.
 */
export async function appendMessage(threadId: string, role: string, text: string): Promise<void> {
  const key = getSessionKey(threadId);
  const sessionStr = await redisClient.get(key);
  let session: Session;
  if (sessionStr) {
    session = JSON.parse(sessionStr);
  } else {
    session = { messages: [], lastActive: Date.now() };
  }
  session.messages.push({ role, text });
  session.lastActive = Date.now();
  await redisClient.set(key, JSON.stringify(session));
  await redisClient.expire(key, INACTIVITY_LIMIT_SECONDS);
}

/**
 * Retrieves the chat history (messages) for a given thread.
 */
export async function getHistory(threadId: string): Promise<ChatMessage[] | undefined> {
  const key = getSessionKey(threadId);
  const sessionStr = await redisClient.get(key);
  if (!sessionStr) {
    return undefined;
  }
  const session: Session = JSON.parse(sessionStr);
  return session.messages;
}

/**
 * Clears the session's history by setting its messages to an empty array.
 */
export async function clearHistory(threadId: string): Promise<void> {
  const key = getSessionKey(threadId);
  const sessionStr = await redisClient.get(key);
  let session: Session;
  if (sessionStr) {
    session = JSON.parse(sessionStr);
  } else {
    session = { messages: [], lastActive: Date.now() };
  }
  session.messages = [];
  session.lastActive = Date.now();
  await redisClient.set(key, JSON.stringify(session));
  await redisClient.expire(key, INACTIVITY_LIMIT_SECONDS);
}
