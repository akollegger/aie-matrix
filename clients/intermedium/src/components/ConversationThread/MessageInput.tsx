import { useRef, useState } from "react";

interface MessageInputProps {
  readonly isAvailable: boolean;
  readonly onSend: (text: string) => void;
}

/**
 * Text input + submit for paired ghost conversation (FR-010, FR-011).
 * Disabled with tooltip when conversation is unavailable.
 */
export function MessageInput({ isAvailable, onSend }: MessageInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !isAvailable) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", gap: 8, alignItems: "center" }}
      title={isAvailable ? undefined : "Conversation not yet available"}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!isAvailable}
        placeholder={isAvailable ? "Message your ghost…" : "Unavailable"}
        style={{
          flex: 1,
          padding: "7px 10px",
          background: "rgba(20, 30, 50, 0.7)",
          border: "1px solid rgba(80, 120, 180, 0.4)",
          borderRadius: 6,
          color: isAvailable ? "rgba(220, 230, 245, 0.9)" : "rgba(150, 165, 190, 0.5)",
          fontSize: 13,
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={!isAvailable || text.trim().length === 0}
        style={{
          padding: "7px 14px",
          background: isAvailable ? "rgba(60, 100, 160, 0.6)" : "rgba(40, 55, 80, 0.4)",
          border: "1px solid rgba(80, 120, 180, 0.35)",
          borderRadius: 6,
          color: isAvailable ? "rgba(200, 220, 245, 0.9)" : "rgba(130, 150, 180, 0.45)",
          fontSize: 13,
          cursor: isAvailable ? "pointer" : "not-allowed",
        }}
      >
        Send
      </button>
    </form>
  );
}
