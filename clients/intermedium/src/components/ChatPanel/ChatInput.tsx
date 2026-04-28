import { useRef, useState } from "react";

interface ChatInputProps {
  readonly isAvailable: boolean;
  readonly onSend: (text: string) => Promise<void>;
}

export function ChatInput({ isAvailable, onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || !isAvailable) return;
    setValue("");
    await onSend(text);
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex items-center gap-2 border-t border-border pt-3 mt-1"
    >
      <span
        className={[
          "font-mono text-xl select-none shrink-0",
          isAvailable ? "text-human" : "text-text-faint",
        ].join(" ")}
      >
        &gt;
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!isAvailable}
        placeholder={isAvailable ? "Say something…" : "Select a ghost to chat"}
        autoComplete="off"
        spellCheck={false}
        className="flex-1 bg-transparent border-none outline-none text-text font-mono text-lg placeholder:text-text-faint caret-human disabled:cursor-not-allowed"
        onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
      />
      <button
        type="submit"
        disabled={!isAvailable || value.trim().length === 0}
        className="bg-human-bg border border-border-bright rounded text-text-dim text-base px-3 py-1 font-mono tracking-[--tracking-label] enabled:cursor-pointer enabled:hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        send
      </button>
    </form>
  );
}
