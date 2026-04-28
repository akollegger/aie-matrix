import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "../types/conversation.js";
import type { MessageRecord } from "@aie-matrix/shared-types";

const POLL_INTERVAL_MS = 5000;

interface A2AConversationState {
  readonly thread: Omit<import("../types/conversation.js").ConversationThread, "ghostId"> & { ghostId: string | null };
  readonly sendMessage: (text: string) => Promise<void>;
}

function toConversationMessage(r: MessageRecord): ConversationMessage {
  return {
    messageId: r.message_id,
    sender: r.role === "partner" ? "human" : "ghost",
    content: r.content,
    timestamp: r.timestamp,
  };
}

async function fetchMessages(
  worldApiUrl: string,
  ghostId: string,
  since?: string,
): Promise<ConversationMessage[]> {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  const url = `${worldApiUrl}/threads/${encodeURIComponent(ghostId)}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { messages?: MessageRecord[] };
  return (data.messages ?? []).map(toConversationMessage);
}

async function postMessage(
  worldApiUrl: string,
  humanId: string,
  ghostId: string,
  text: string,
): Promise<void> {
  await fetch(`${worldApiUrl}/threads/${encodeURIComponent(ghostId)}/human-say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ humanId, text }),
  });
}

/**
 * Polls the world server's /threads/:ghostId endpoint for a human↔ghost conversation.
 * Uses the world API URL (VITE_WORLD_API_URL), not the ghost-house URL.
 */
export function useA2AConversation(
  ghostId: string | null,
  worldApiUrl: string,
  humanId: string,
): A2AConversationState {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);
  const sinceRef = useRef<string | undefined>(undefined);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!ghostId || !worldApiUrl) {
      setIsAvailable(false);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const fetched = await fetchMessages(worldApiUrl, ghostId, sinceRef.current);
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

    pollRef.current = poll;
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      pollRef.current = null;
      clearInterval(id);
    };
  }, [ghostId, worldApiUrl]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!ghostId || !worldApiUrl) return;
      try {
        await postMessage(worldApiUrl, humanId, ghostId, text);
        // Immediate poll so the sent message appears without waiting for the next interval.
        void pollRef.current?.();
      } catch {
        // Silently ignore; next poll will surface the message if the POST eventually landed.
      }
    },
    [ghostId, worldApiUrl, humanId],
  );

  return {
    thread: { ghostId, messages, isAvailable, isLoading: false },
    sendMessage,
  };
}
