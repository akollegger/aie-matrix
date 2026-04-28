import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";

/** `${col},${row}` → H3 res-15 cell id (matches `tileCoords` / `ghostTiles` map keys). */
export function buildGridKeyToCellId(room: Room<WorldSpectatorState>): Map<string, string> {
  const m = new Map<string, string>();
  room.state.tileCoords.forEach((coord, cellId) => {
    m.set(`${coord.col},${coord.row}`, cellId);
  });
  return m;
}

export function parseItemRefs(csv: string | undefined): string[] {
  if (csv === undefined || csv === "") {
    return [];
  }
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}
