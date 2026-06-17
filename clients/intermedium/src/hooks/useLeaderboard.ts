import { useEffect, useRef, useState } from "react";
import type { LeaderboardResult } from "@aie-matrix/shared-types";
import {
  getSpectatorRoom,
  onSpectatorRoom,
} from "../services/colyseusClient.js";

/** Shape of the `leaderboard.updated` Colyseus fanout payload. */
interface LeaderboardUpdatedEvent {
  t: "leaderboard.updated";
  leaderboardId: string;
  title: string;
  isFinal: boolean;
  computedAt: string;
  entries: LeaderboardResult["entries"];
}

async function fetchLeaderboard(
  apiBase: string,
  id: string,
  token?: string | null,
): Promise<LeaderboardResult | null> {
  if (!apiBase || !id || !token) return null;
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "leaderboard", arguments: { id } },
      }),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) return null;
    const envelope = JSON.parse(dataLine.slice("data:".length).trim()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    const textItem = envelope.result?.content?.find((c) => c.type === "text");
    if (!textItem?.text) return null;
    const parsed = JSON.parse(textItem.text) as Record<string, unknown>;
    if (parsed.ok === false) return null;
    return parsed as unknown as LeaderboardResult;
  } catch {
    return null;
  }
}

export interface LeaderboardState {
  readonly result: LeaderboardResult | null;
  readonly loading: boolean;
  readonly sessionComplete: boolean;
}

/**
 * Fetches a leaderboard by ID once on mount, then stays live via
 * Colyseus `"world-v1"` fanout messages (no polling loop).
 */
export function useLeaderboard(leaderboardId: string, token?: string | null): LeaderboardState {
  const [result, setResult] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

  const apiBaseRef = useRef(apiBase);
  apiBaseRef.current = apiBase;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Fetch once on mount (or when leaderboardId / token changes).
  useEffect(() => {
    if (!leaderboardId || !token) return;
    let cancelled = false;

    setLoading(true);
    fetchLeaderboard(apiBaseRef.current, leaderboardId, tokenRef.current)
      .then((r) => { if (!cancelled && r) setResult(r); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [leaderboardId, token]);

  // Subscribe to Colyseus `"world-v1"` fanout for live updates — no polling.
  useEffect(() => {
    if (!leaderboardId) return;

    // Handler must be detachable, so we capture it per-effect run.
    const handleMessage = (type: unknown, message: unknown) => {
      if (type !== "world-v1") return;
      const payload = message as LeaderboardUpdatedEvent | undefined;
      if (!payload || payload.t !== "leaderboard.updated") return;
      if (payload.leaderboardId !== leaderboardId) return;

      setResult((prev) => ({
        id: leaderboardId,
        title: payload.title,
        description: prev?.description ?? "",
        entries: payload.entries,
        computedAt: payload.computedAt,
        isFinal: payload.isFinal,
      }));
    };

    // colyseus.js Room.onMessage returns a cleanup function.
    const cleanupHandlers: Array<() => void> = [];

    const attachRoom = (room: import("colyseus.js").Room | null) => {
      if (!room) return;
      // onMessage returns a function that removes this specific handler.
      const off = room.onMessage("*", handleMessage);
      if (typeof off === "function") cleanupHandlers.push(off);
    };

    attachRoom(getSpectatorRoom());
    const unsubRoom = onSpectatorRoom((r) => { attachRoom(r); });

    return () => {
      unsubRoom?.();
      for (const off of cleanupHandlers) off();
    };
  }, [leaderboardId]);

  return {
    result,
    loading,
    sessionComplete: result?.isFinal === true,
  };
}
