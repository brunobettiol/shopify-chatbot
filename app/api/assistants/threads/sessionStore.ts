import fs from 'fs';
import path from 'path';

interface ChatMessage {
  role: string;
  text: string;
}

interface Session {
  messages: ChatMessage[];
  lastActive: number; // timestamp in milliseconds
}

interface SessionsData {
  [threadId: string]: Session;
}

// Path to persistent storage file (JSON)
const dataFilePath = path.join(process.cwd(), 'sessions.json');

// In-memory sessions store
let sessions: SessionsData = {};

// Load existing sessions from file (if any) at startup
try {
  if (fs.existsSync(dataFilePath)) {
    const fileData = fs.readFileSync(dataFilePath, 'utf-8');
    sessions = JSON.parse(fileData);
  }
} catch (err) {
  console.error('Could not load session history file:', err);
  sessions = {};
}

// Persist sessions back to the file
function saveSessions() {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save session data:', err);
  }
}

// Set inactivity limit: 3 days (in milliseconds)
const INACTIVITY_LIMIT = 3 * 24 * 60 * 60 * 1000;

// Cleanup function: removes any sessions inactive for more than 3 days
export function cleanupInactiveSessions() {
  const now = Date.now();
  let updated = false;
  for (const threadId in sessions) {
    if (now - sessions[threadId].lastActive > INACTIVITY_LIMIT) {
      delete sessions[threadId];
      updated = true;
    }
  }
  if (updated) {
    saveSessions();
  }
}

export function createSession(threadId: string) {
  sessions[threadId] = {
    messages: [],
    lastActive: Date.now()
  };
  saveSessions();
}

export function appendMessage(threadId: string, role: string, text: string) {
  if (!sessions[threadId]) {
    createSession(threadId);
  }
  sessions[threadId].messages.push({ role, text });
  sessions[threadId].lastActive = Date.now();
  saveSessions();
}

export function getHistory(threadId: string): ChatMessage[] | undefined {
  if (!sessions[threadId]) {
    return undefined;
  }
  return sessions[threadId].messages;
}

export function clearHistory(threadId: string) {
  if (sessions[threadId]) {
    sessions[threadId].messages = [];
    sessions[threadId].lastActive = Date.now();
    saveSessions();
  }
}
