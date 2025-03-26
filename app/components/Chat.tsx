"use client";
import React, { useState, useEffect } from "react";
import { AssistantStream } from "openai/lib/AssistantStream";

const Chat = ({ functionCallHandler }: any) => {
  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/assistants/threads`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setThreadId(data.threadId);
        setMessages([{ role: "assistant", text: "Chat started!" }]);
      });
  }, []);

  const sendMessage = async () => {
    if (!threadId) return;
    setMessages((prev) => [...prev, { role: "user", text: userInput }]);
    setUserInput("");
  
    const response = await fetch(
      `/api/assistants/threads/${threadId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content: userInput }),
      }
    );
  
    if (!response.body) {
      console.error("Response body is null");
      return;
    }
  
    const stream = AssistantStream.fromReadableStream(response.body);
    let fullMessage = "";
    for await (const chunk of stream) {
      fullMessage += chunk;
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", text: fullMessage },
      ]);
    }
  };
  

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  return (
    <div>
      <div>
        {messages.map((msg, index) => (
          <div key={index}><strong>{msg.role}:</strong> {msg.text}</div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
};

export default Chat;