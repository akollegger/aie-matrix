import { useEffect, useRef } from "react";
import type { ConversationThread } from "../../types/conversation.js";
import type { GhostIdentity } from "../../types/ghost.js";

interface ChatThreadProps {
  readonly thread: ConversationThread;
  readonly ghostIdentity: GhostIdentity | null;
}

export function ChatThread({ thread, ghostIdentity: _ghostIdentity }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages.length]);

  if (!thread.isAvailable && thread.messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-faint text-lg italic">
        {thread.ghostId ? "Connecting to ghost…" : null}
      </div>
    );
  }

  if (thread.messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-faint text-lg italic">
        No messages yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-1 font-mono text-lg min-h-0 px-1 py-1">
      {thread.messages.map((msg) => {
        const isHuman = msg.sender === "human";
        return (
          <div key={msg.messageId} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: "'Fira Code', monospace",
                fontFeatureSettings: '"liga" 1, "calt" 1',
                fontSize: 13,
                flexShrink: 0,
                color: isHuman ? "rgba(120, 160, 240, 0.7)" : "rgba(100, 170, 150, 0.7)",
                lineHeight: 1.5,
              }}
            >
              {isHuman ? "->" : "<-"}
            </span>
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 3,
                background: isHuman
                  ? "rgba(30, 55, 100, 0.72)"
                  : "rgba(20, 35, 55, 0.72)",
                color: isHuman ? "rgba(180, 210, 255, 0.92)" : "rgba(160, 200, 190, 0.9)",
                lineHeight: 1.5,
                wordBreak: "break-word",
                fontFamily: "'Fira Code', monospace",
              }}
            >
              {msg.content}
            </span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
