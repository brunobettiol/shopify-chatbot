"use client";
import React, { useState, useEffect, useRef } from "react";

const Chat = ({ functionCallHandler }: any) => {
  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize the chat thread
  useEffect(() => {
    fetch(`/api/assistants/threads`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setThreadId(data.threadId);
        setMessages([{ role: "assistant", text: "Hi! How can I help you?" }]);
      })
      .catch((err) => console.error(err));
  }, []);

  // Auto-scroll when messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!threadId || userInput.trim() === "") return;
    
    const messageToSend = userInput;
    // Add user message and a placeholder for the assistant reply
    setMessages((prev) => [
      ...prev,
      { role: "user", text: messageToSend },
      { role: "assistant", text: "" },
    ]);
    setUserInput("");

    try {
      const response = await fetch(
        `/api/assistants/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageToSend }),
        }
      );

      if (!response.body) {
        console.error("Response body is null");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let buffer = "";
      let accumulatedText = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        // Decode current chunk and append to buffer
        buffer += decoder.decode(value, { stream: !done });
        // Split by newline assuming NDJSON format
        const lines = buffer.split("\n");
        // Keep any partial line for next iteration
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const jsonObj = JSON.parse(line);
            // Process only delta events containing text
            if (jsonObj.event === "thread.message.delta") {
              const delta = jsonObj.data?.delta;
              if (delta && Array.isArray(delta.content)) {
                for (const part of delta.content) {
                  if (part.type === "text" && part.text?.value) {
                    accumulatedText += part.text.value;
                  }
                }
                // Update the last assistant message with the accumulated text
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    text: accumulatedText,
                  };
                  return updated;
                });
              }
            }
          } catch (e) {
            console.error("Failed to parse JSON:", e);
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        maxWidth: "600px",
        margin: "0 auto",
        border: "1px solid #ddd",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          flex: 1,
          padding: "1rem",
          overflowY: "auto",
          backgroundColor: "#f5f5f5",
        }}
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              marginBottom: "0.5rem",
            }}
          >
            <div
              style={{
                backgroundColor: msg.role === "user" ? "#DCF8C6" : "#FFF",
                border: "1px solid #ccc",
                padding: "0.75rem",
                borderRadius: "10px",
                maxWidth: "80%",
                boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
              }}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          padding: "1rem",
          borderTop: "1px solid #ddd",
          backgroundColor: "#fff",
        }}
      >
        <input
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Type your message..."
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
        />
        <button
          type="submit"
          style={{
            marginLeft: "0.5rem",
            padding: "0.5rem 1rem",
            borderRadius: "4px",
            border: "none",
            backgroundColor: "#0070f3",
            color: "#fff",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default Chat;
