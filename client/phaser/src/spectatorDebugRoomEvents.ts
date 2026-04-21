import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";

function previewMessage(msg: unknown): string {
  if (msg === undefined || msg === null) {
    return "";
  }
  if (typeof msg === "string") {
    return msg.length > 200 ? `${msg.slice(0, 197)}…` : msg;
  }
  try {
    const s = JSON.stringify(msg);
    return s.length > 240 ? `${s.slice(0, 237)}…` : s;
  } catch {
    return String(msg);
  }
}

/**
 * Colyseus signals that are useful in the spectator log besides movement
 * (`ghostTiles` / `ghost-patch` — already obvious on the map).
 *
 * - **ghostModes** — conversational vs normal (MCP `say` / `bye`).
 * - **Room lifecycle** — disconnect / protocol errors.
 * - **Other room messages** — any `broadcast` type except `ghost-patch` (movement envelope).
 */
export function attachSpectatorDebugRoomEvents(
  room: Room<WorldSpectatorState>,
  append: (line: string) => void,
): () => void {
  const unsubs: Array<() => void> = [];

  const pushUnsub = (u: (() => boolean) | (() => void) | undefined): void => {
    if (u === undefined) {
      return;
    }
    unsubs.push(() => {
      void u();
    });
  };

  const modes = room.state.ghostModes;
  pushUnsub(
    modes.onAdd((mode, ghostId) => {
      append(`[ghost-mode] ghost=${ghostId} mode=${mode}`);
    }, true),
  );
  pushUnsub(
    modes.onChange((mode, ghostId) => {
      append(`[ghost-mode] change ghost=${ghostId} mode=${mode}`);
    }),
  );
  pushUnsub(
    modes.onRemove((_mode, ghostId) => {
      append(`[ghost-mode] remove ghost=${ghostId} (defaults to normal)`);
    }),
  );

  const onLeave = (code: number, reason?: string): void => {
    append(`[room] leave code=${code}${reason ? ` reason=${reason}` : ""}`);
  };
  room.onLeave(onLeave);
  unsubs.push(() => {
    room.onLeave.remove(onLeave);
  });

  const onError = (code: number, message?: string): void => {
    append(`[room] error code=${code}${message ? ` message=${message}` : ""}`);
  };
  room.onError(onError);
  unsubs.push(() => {
    room.onError.remove(onError);
  });

  const unsubWildcard = room.onMessage("*", (type, msg) => {
    if (type === "ghost-patch") {
      return;
    }
    const typeStr =
      typeof type === "string" || typeof type === "number"
        ? String(type)
        : `schema:${(type as { _typeid?: number })._typeid ?? "?"}`;
    const prev = previewMessage(msg);
    append(`[room-msg] ${typeStr}${prev ? ` ${prev}` : ""}`);
  });
  unsubs.push(unsubWildcard);

  return () => {
    for (const u of unsubs) {
      u();
    }
  };
}
