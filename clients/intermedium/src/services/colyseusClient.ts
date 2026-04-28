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

export function getColyseusUrl(): string {
  return import.meta.env.VITE_COLYSEUS_URL ?? "";
}

function ensureClient(): Client {
  const url = getColyseusUrl();
  if (!url) {
    throw new Error("VITE_COLYSEUS_URL is not set");
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
 * `joinOrCreate("world_spectator")` with `WorldSpectatorState` for `ghostTiles` patches.
 */
export async function joinWorldSpectator(): Promise<Room<WorldSpectatorState>> {
  if (room && room.connection.isOpen) {
    return room;
  }
  setLinkState("connecting");
  try {
    const c = ensureClient();
    const r = await c.joinOrCreate<WorldSpectatorState>("world_spectator", {}, WorldSpectatorState);
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
