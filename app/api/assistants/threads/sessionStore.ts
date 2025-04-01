import fs from 'fs';
import path from 'path';

interface ChatMessage {
  role: string;
  text: string;
}

interface SessionsData {
  [threadId: string]: ChatMessage[];
}

// Define the path for persistent storage (JSON file)
const dataFilePath = path.join(process.cwd(), 'sessions.json');

// In-memory sessions store
let sessions: SessionsData = {};

// Load sessions from file at startup (if available)
try {
  if (fs.existsSync(dataFilePath)) {
    const fileData = fs.readFileSync(dataFilePath, 'utf-8');
    sessions = JSON.parse(fileData);
  }
} catch (err) {
  console.error('Could not load session history file:', err);
  sessions = {};
}

// Persist the in-memory sessions back to the JSON file
function saveSessions() {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save session data:', err);
  }
}

/**
 * Create a new session for a thread.
 */
export function createSession(threadId: string) {
  sessions[threadId] = [];
  saveSessions();
}

/**
 * Append a message to a session's history.
 * @param threadId The session/thread ID.
 * @param role Either "user" or "assistant".
 * @param text The message content.
 */
export function appendMessage(threadId: string, role: string, text: string) {
  if (!sessions[threadId]) {
    sessions[threadId] = [];
  }
  sessions[threadId].push({ role, text });
  saveSessions();
}

/**
 * Get the full chat history for a session.
 */
export function getHistory(threadId: string): ChatMessage[] | undefined {
  return sessions[threadId];
}

/**
 * Clear a session's history.
 */
export function clearHistory(threadId: string) {
  if (sessions[threadId]) {
    sessions[threadId] = [];
    saveSessions();
  }
}
