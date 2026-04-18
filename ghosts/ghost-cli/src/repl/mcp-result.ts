import type { ExitList, GhostIdentity, GhostPosition, TileView } from "./repl-state.js";

export function parseGhostIdentity(raw: unknown): GhostIdentity | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as { ghostId?: unknown; displayName?: unknown };
  const ghostId = typeof o.ghostId === "string" ? o.ghostId : null;
  if (!ghostId) {
    return null;
  }
  const displayName = typeof o.displayName === "string" ? o.displayName : undefined;
  return { ghostId, displayName };
}

export function parseGhostPosition(raw: unknown): GhostPosition | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as { tileId?: unknown; col?: unknown; row?: unknown };
  const tileId = typeof o.tileId === "string" ? o.tileId : null;
  if (!tileId) {
    return null;
  }
  const col = typeof o.col === "number" ? o.col : 0;
  const row = typeof o.row === "number" ? o.row : 0;
  return { tileId, col, row };
}

/** Builds World View prose from a `look` tool payload (best-effort). */
export function parseTileView(raw: unknown): TileView | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const tileId = typeof o.tileId === "string" ? o.tileId : "?";
  const tileClass = typeof o.tileClass === "string" ? o.tileClass : typeof o.class === "string" ? o.class : "?";
  const occupants = Array.isArray(o.occupants)
    ? o.occupants.filter((x): x is string => typeof x === "string")
    : [];
  const prose =
    typeof o.prose === "string"
      ? o.prose
      : [
          `tile: ${tileId}`,
          `class: ${tileClass}`,
          occupants.length ? `occupants: ${occupants.join(", ")}` : "occupants: none",
        ].join("\n");
  return { tileId, tileClass, occupants, prose };
}

export function parseExitList(raw: unknown): ExitList | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as { exits?: unknown };
  if (!Array.isArray(o.exits)) {
    return { exits: [] };
  }
  const exits = o.exits
    .map((e) => {
      if (!e || typeof e !== "object") {
        return null;
      }
      const x = e as { toward?: unknown; direction?: unknown; tileId?: unknown };
      const toward = typeof x.toward === "string" ? x.toward : typeof x.direction === "string" ? x.direction : null;
      const tileId = typeof x.tileId === "string" ? x.tileId : null;
      if (!toward || !tileId) {
        return null;
      }
      return { toward, tileId };
    })
    .filter((x): x is { toward: string; tileId: string } => x !== null);
  return { exits };
}

export function formatGoLogMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "go: done";
  }
  const o = raw as { ok?: unknown; code?: unknown; reason?: unknown };
  if (o.ok === false) {
    const code = typeof o.code === "string" ? o.code : "BLOCKED";
    const reason = typeof o.reason === "string" ? o.reason : "Movement was denied.";
    return `blocked: ${reason} (${code})`;
  }
  return "moved";
}
