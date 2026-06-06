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

const POLL_INTERVAL_MS = 60_000;

async function fetchLeaderboard(
  apiBase: string,
  id: string,
): Promise<LeaderboardResult | null> {
  if (!apiBase || !id) return null;
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "leaderboard", arguments: { id } },
      }),
    });
    if (!res.ok) return null;
    const envelope = (await res.json()) as {
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
 * Fetches a leaderboard by ID and keeps it live via Colyseus `leaderboard.updated` fanout.
 * Falls back to polling every 60 s if the Colyseus message is never received.
 */
export function useLeaderboard(leaderboardId: string): LeaderboardState {
  const [result, setResult] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

  // Keep a ref so poll callback always has the latest apiBase without re-subscribing.
  const apiBaseRef = useRef(apiBase);
  apiBaseRef.current = apiBase;

  // Initial fetch + polling fallback.
  useEffect(() => {
    if (!leaderboardId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const r = await fetchLeaderboard(apiBaseRef.current, leaderboardId);
        if (!cancelled && r) setResult(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    // TODO: replace polling with Colyseus message subscription below once confirmed working.
    const timerId = setInterval(() => { void load(); }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [leaderboardId]);

  // Subscribe to Colyseus `leaderboard.updated` fanout messages.
  useEffect(() => {
    if (!leaderboardId) return;

    let unsubRoom: (() => void) | null = null;

    const attachRoom = (room: import("colyseus.js").Room | null) => {
      // Each time the room changes, re-attach the listener.
      if (!room) return;
      room.onMessage("*", (type: unknown, message: unknown) => {
        if (type !== "world_v1") return;
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
      });
    };

    // Attach to already-connected room (if any) and future rooms.
    attachRoom(getSpectatorRoom());
    unsubRoom = onSpectatorRoom((r) => { attachRoom(r); });

    return () => {
      unsubRoom?.();
    };
  }, [leaderboardId]);

  return {
    result,
    loading,
    sessionComplete: result?.isFinal === true,
  };
}
