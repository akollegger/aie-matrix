import { useEffect, useRef } from "react";
import type { ConversationThread } from "../../types/conversation.js";
import type { GhostIdentity } from "../../types/ghost.js";

interface ChatThreadProps {
  readonly thread: ConversationThread;
  readonly ghostIdentity: GhostIdentity | null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ChatThread({ thread, ghostIdentity }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages.length]);

  if (!thread.isAvailable && thread.messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-faint text-lg italic">
        {thread.ghostId ? "Connecting to ghost…" : "Select a ghost to start chatting"}
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

  const ghostName = ghostIdentity?.name ?? thread.ghostId ?? "ghost";

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 font-mono text-lg min-h-0">
      {thread.messages.map((msg) => {
        const isHuman = msg.sender === "human";
        return (
          <div
            key={msg.messageId}
            className={[
              "grid grid-cols-[3.75rem_7.5rem_1fr] gap-x-2.5 py-0.5 pl-2 border-l-2",
              isHuman ? "border-human" : "border-ghost",
            ].join(" ")}
          >
            <span className="text-base text-text-faint self-baseline pt-0.5">
              {formatTime(msg.timestamp)}
            </span>
            <span
              className={[
                "font-semibold whitespace-nowrap overflow-hidden text-ellipsis self-baseline",
                isHuman ? "text-human" : "text-ghost",
              ].join(" ")}
            >
              {isHuman ? "you" : ghostName}:
            </span>
            <span className="text-text leading-relaxed break-words">
              {msg.content}
            </span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
