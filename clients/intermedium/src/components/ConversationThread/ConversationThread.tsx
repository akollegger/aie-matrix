import type { ConversationThread as ConversationThreadType } from "../../types/conversation.js";

interface ConversationThreadProps {
  readonly thread: ConversationThreadType;
}

/**
 * Ordered conversation message list (FR-009, FR-011).
 * Shows a stub when conversation is unavailable (IC-002 gap).
 */
export function ConversationThread({ thread }: ConversationThreadProps) {
  const { messages, isAvailable } = thread;

  if (!isAvailable) {
    return (
      <p style={{ color: "rgba(180, 200, 220, 0.5)", fontSize: 13, margin: 0, fontStyle: "italic" }}>
        Conversation not yet available.
      </p>
    );
  }

  if (messages.length === 0) {
    return (
      <p style={{ color: "rgba(180, 200, 220, 0.6)", fontSize: 13, margin: 0, fontStyle: "italic" }}>
        No messages yet.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {messages.map((msg) => (
        <div
          key={msg.messageId}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: msg.sender === "human" ? "flex-end" : "flex-start",
          }}
        >
          <div
            style={{
              maxWidth: "80%",
              padding: "6px 10px",
              borderRadius: msg.sender === "human" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background:
                msg.sender === "human"
                  ? "rgba(60, 100, 160, 0.55)"
                  : "rgba(30, 40, 60, 0.7)",
              color: "rgba(220, 230, 245, 0.9)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  );
}
