import { gridDisk, isValidCell } from "h3-js";
import type { GhostPosition } from "../types/ghostPosition.js";

/** k-ring for “browsable region” at Area scale. */
export const AREA_DISK_K = 2;
/** 7+hex neighbourhood at Neighbor scale. */
export const NEIGHBOR_DISK_K = 1;

export function cellDisk(h3: string, k: number): Set<string> {
  if (!isValidCell(h3)) {
    return new Set();
  }
  return new Set(gridDisk(h3, k));
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
