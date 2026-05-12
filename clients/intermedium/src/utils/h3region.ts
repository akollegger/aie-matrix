import { gridDisk, isValidCell } from "h3-js";
import type { GhostPosition } from "../types/ghostPosition.js";
import type { WorldTile } from "../types/worldTile.js";

/** k-ring for "browsable region" at Area scale. */
export const AREA_DISK_K = 2;
/** 7+hex neighbourhood at Neighbor scale. */
export const NEIGHBOR_DISK_K = 1;
/**
 * Render culling radius at Room stop. At ROOM_CPV=16 and 45° pitch the visible
 * frustum extends roughly 8 cells left/right and further in depth due to pitch.
 * k=12 (547 cells max) safely covers the viewport with buffer for pan transitions.
 */
export const ROOM_RENDER_RADIUS = 12;

export function cellDisk(h3: string, k: number): Set<string> {
  if (!isValidCell(h3)) {
    return new Set();
  }
  return new Set(gridDisk(h3, k));
}

/** Return only the tiles within k rings of focusH3. Used to cull off-screen tiles at Room stop. */
export function tilesInDisk(
  tiles: ReadonlyMap<string, WorldTile>,
  focusH3: string,
  k: number,
): Map<string, WorldTile> {
  const disk = cellDisk(focusH3, k);
  const out = new Map<string, WorldTile>();
  for (const [h3, tile] of tiles) {
    if (disk.has(h3)) out.set(h3, tile);
  }
  return out;
}

export function listGhostsInCells(
  ghosts: ReadonlyMap<string, GhostPosition>,
  set: Set<string>,
): { id: string; g: GhostPosition }[] {
  const out: { id: string; g: GhostPosition }[] = [];
  for (const g of ghosts.values()) {
    if (set.has(g.h3Index)) {
      out.push({ id: g.ghostId, g });
    }
  }
  return out;
}
