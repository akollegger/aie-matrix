/**
 * Read-only Colyseus spectator room client.
 *
 * @see `specs/011-intermedium-client/contracts/ic-001-colyseus-ghost-positions.md`
 * @see FR-021
 */

import type { Room } from "colyseus.js";
import { Client } from "colyseus.js";
import { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";

export type ColyseusLinkState = "disconnected" | "connecting" | "reconnecting" | "connected";

const listeners = new Set<(s: ColyseusLinkState) => void>();
const roomListeners = new Set<(r: Room<WorldSpectatorState> | null) => void>();

let linkState: ColyseusLinkState = "disconnected";
let client: Client | null = null;
let room: Room<WorldSpectatorState> | null = null;
/** When `true`, the next `onLeave` is a consented `leave()` — do not auto-reconnect. */
let ignoreNextLeaveReconnect = false;

function setLinkState(next: ColyseusLinkState) {
  linkState = next;
  for (const l of listeners) {
    l(next);
  }
}

function setRoom(next: Room<WorldSpectatorState> | null) {
  room = next;
  for (const l of roomListeners) {
    l(next);
  }
}

/** HTTP base URL for all server endpoints (e.g. https://api.matrix.neo4j.gg). */
function getHttpBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "";
}

/** Derive the WebSocket URL from the HTTP base (https → wss, http → ws). */
export function getColyseusUrl(): string {
  return getHttpBase().replace(/^http(s?):\/\//, "ws$1://");
}

function ensureClient(): Client {
  const url = getColyseusUrl();
  if (!url) {
    throw new Error("VITE_API_BASE_URL is not set");
  }
  if (!client) {
    client = new Client(url);
  }
  return client;
}

export function getColyseusLinkState(): ColyseusLinkState {
  return linkState;
}

export function onColyseusLinkState(cb: (s: ColyseusLinkState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function onSpectatorRoom(cb: (r: Room<WorldSpectatorState> | null) => void): () => void {
  roomListeners.add(cb);
  queueMicrotask(() => {
    cb(room);
  });
  return () => {
    roomListeners.delete(cb);
  };
}

export function getSpectatorRoom(): Room<WorldSpectatorState> | null {
  return room;
}

/**
 * Fetch the singleton spectator room ID from `/spectator/room`, then join by ID.
 * The server registers one `"matrix"` room and exposes its ID via that endpoint.
 * Retries on transient 4212 (room not found) in case the room is still being created.
 */
async function fetchRoomId(): Promise<string> {
  const res = await fetch(`${getHttpBase()}/spectator/room`);
  if (!res.ok) {
    throw new Error(`/spectator/room: ${res.status} ${await res.text()}`);
  }
  const { roomId } = (await res.json()) as { roomId: string };
  return roomId;
}

export async function joinWorldSpectator(): Promise<Room<WorldSpectatorState>> {
  if (room && room.connection.isOpen) {
    return room;
  }
  setLinkState("connecting");
  try {
    const c = ensureClient();
    const roomId = await fetchRoomId();
    const r = await c.joinById<WorldSpectatorState>(roomId, {}, WorldSpectatorState);
    setRoom(r);
    r.onLeave(() => {
      if (ignoreNextLeaveReconnect) {
        ignoreNextLeaveReconnect = false;
        if (getSpectatorRoom() === r) {
          setRoom(null);
        }
        setLinkState("disconnected");
        client = null;
        return;
      }
      if (getSpectatorRoom() !== r) {
        return;
      }
      setRoom(null);
      setLinkState("reconnecting");
    });
    setLinkState("connected");
    return r;
  } catch (e) {
    setLinkState("disconnected");
    throw e;
  }
}

/**
 * Leave the current room and do not schedule automatic reconnect.
 */
export function leaveWorldSpectator(): void {
  if (!room) {
    setLinkState("disconnected");
    client = null;
    return;
  }
  ignoreNextLeaveReconnect = true;
  void room.leave(true);
}

/**
 * Force a clean disconnect + re-join.  Call this when the live session changes so
 * Intermedium receives a fresh full-state snapshot from the Colyseus room and resets
 * its `ghostTiles` listeners — avoiding stale ghost positions from a previous session.
 */
export async function reconnectWorldSpectator(): Promise<void> {
  leaveWorldSpectator();
  // Brief pause so the leave handshake completes before we re-join.
  await new Promise<void>((r) => setTimeout(r, 200));
  await joinWorldSpectator();
}
