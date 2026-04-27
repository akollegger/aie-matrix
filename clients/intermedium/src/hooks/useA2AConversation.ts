import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMessage, ConversationThread } from "../types/conversation.js";

const POLL_INTERVAL_MS = 5000;

interface A2AConversationState {
  readonly thread: Omit<ConversationThread, "ghostId"> & { ghostId: string | null };
  readonly sendMessage: (text: string) => Promise<void>;
}

async function fetchMessages(
  baseUrl: string,
  ghostId: string,
  since?: string,
): Promise<ConversationMessage[]> {
  const url = `${baseUrl}/conversation/${encodeURIComponent(ghostId)}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as ConversationMessage[]) : [];
}

async function postMessage(
  baseUrl: string,
  ghostId: string,
  text: string,
): Promise<void> {
  await fetch(`${baseUrl}/conversation/${encodeURIComponent(ghostId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/**
 * Polls the ghost house A2A conversation endpoint (IC-002, FR-011).
 * Returns `isAvailable: false` on 404/network error so UI can stub gracefully.
 */
export function useA2AConversation(
  ghostId: string | null,
  baseUrl: string,
): A2AConversationState {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);
  const sinceRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!ghostId || !baseUrl) {
      setIsAvailable(false);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const fetched = await fetchMessages(baseUrl, ghostId, sinceRef.current);
        if (cancelled) return;
        if (fetched.length > 0) {
          const last = fetched[fetched.length - 1];
          if (last?.timestamp) sinceRef.current = last.timestamp;
          setMessages((prev) => [...prev, ...fetched]);
        }
        setIsAvailable(true);
      } catch {
        if (!cancelled) setIsAvailable(false);
      }
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ghostId, baseUrl]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!ghostId || !baseUrl) return;
      // Optimistic append (FR-011)
      const optimistic: ConversationMessage = {
        messageId: `opt-${Date.now()}`,
        sender: "human",
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        await postMessage(baseUrl, ghostId, text);
      } catch {
        // Optimistic message stays; real message arrives on next poll.
      }
    },
    [ghostId, baseUrl],
  );

  return {
    thread: { ghostId, messages, isAvailable, isLoading: false },
    sendMessage,
  };
}
