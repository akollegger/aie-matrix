import { ulid } from "ulid";
import type { WorldEvent, WorldEventKind } from "../types.js";

/** Colyseus `room.broadcast("world-v1", …)` payload from the world server (see internal fanout). */
export type ColyseusWorldV1Payload = {
  readonly t: string;
  readonly targetGhostId: string;
  readonly payload: Record<string, unknown>;
};

const KIND_BY_T: Record<string, WorldEventKind> = {
  "message.new": "world.message.new",
  "proximity.enter": "world.proximity.enter",
  "proximity.exit": "world.proximity.exit",
  "quest.trigger": "world.quest.trigger",
  "session.start": "world.session.start",
  "session.end": "world.session.end",
};

/**
 * Maps a `world-v1` fanout payload to an IC-004 envelope, or `null` if unsupported/invalid.
 */
export function translateColyseusWorldV1(raw: unknown): WorldEvent | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const o = raw as ColyseusWorldV1Payload;
  if (typeof o.t !== "string" || typeof o.targetGhostId !== "string" || o.targetGhostId.length === 0) {
    return null;
  }
  const kind = KIND_BY_T[o.t];
  if (kind == null) {
    return null;
  }
  const payload =
    o.payload != null && typeof o.payload === "object" && !Array.isArray(o.payload)
      ? o.payload
      : {};
  return {
    schema: "aie-matrix.world-event.v1",
    eventId: ulid(),
    ghostId: o.targetGhostId,
    kind,
    payload: { ...payload },
    sentAt: new Date().toISOString(),
  };
}
