import { Client } from "colyseus.js";
import { translateColyseusWorldV1 } from "./translate-world-v1.js";
import type { WorldEvent } from "../types.js";

export type ColyseusWorldBridgeHandle = {
  /** Stop the client and leave the room. */
  readonly close: () => void;
};

function httpBaseToWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

async function resolveMatrixRoomId(worldHttpBase: string): Promise<string> {
  const u = `${worldHttpBase.replace(/\/$/, "")}/spectator/room`;
  const res = await fetch(u);
  if (!res.ok) {
    throw new Error(`spectator/room: HTTP ${res.status}`);
  }
  const j = (await res.json()) as { roomId?: string };
  if (typeof j.roomId !== "string" || j.roomId.length === 0) {
    throw new Error("spectator/room: missing roomId");
  }
  return j.roomId;
}

/**
 * Connects to the aie-matrix Colyseus `matrix` room and forwards `world-v1` messages
 * to the given callback (after IC-004 translation).
 */
export async function startColyseusWorldBridge(options: {
  /** e.g. `http://127.0.0.1:8787` — used for `GET /spectator/room` and to derive the WebSocket origin. */
  readonly worldHttpBase: string;
  /** When set, skips `GET /spectator/room` and joins this id directly. */
  readonly roomIdOverride?: string;
  readonly onEvent: (event: WorldEvent) => void;
  /** Optional name for the Colyseus seat (debug only). */
  readonly clientName?: string;
}): Promise<ColyseusWorldBridgeHandle> {
  const roomId = options.roomIdOverride ?? (await resolveMatrixRoomId(options.worldHttpBase));
  const ws = httpBaseToWsBase(options.worldHttpBase);
  const client = new Client(ws);
  const room = await client.joinById(roomId, { name: options.clientName ?? "ghost-house-a2a-bridge" });
  const handler = (raw: unknown) => {
    const e = translateColyseusWorldV1(raw);
    if (e) {
      options.onEvent(e);
    }
  };
  room.onMessage("world-v1", handler);
  return {
    close: () => {
      try {
        void client;
        void room.leave();
      } catch {
        /* best effort */
      }
    },
  };
}
