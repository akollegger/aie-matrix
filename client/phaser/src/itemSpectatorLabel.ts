import type { Room } from "colyseus.js";
import type { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";

/** Spectator canvas label: `ItemDefinition.glyph` when present, else `itemRef`. */
export function spectatorLabelForItemRef(room: Room<WorldSpectatorState>, itemRef: string): string {
  return room.state.itemGlyphs.get(itemRef) ?? itemRef;
}
