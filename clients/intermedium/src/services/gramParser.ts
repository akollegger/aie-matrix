/**
 * Parse `.map.gram` text into a tile index for the intermedium client.
 *
 * Delegates all gram parsing to `@aie-matrix/map-gram` (IC-004).
 * Adapts `ParsedCell` → `WorldTile`: tileType is lowercased first character,
 * items are frozen, neighbors are all 6 H3 topological adjacents regardless of
 * map occupancy (matching pre-migration behaviour).
 */

import { parseMapGram } from "@aie-matrix/map-gram";
import { gridDisk, isValidCell } from "h3-js";
import type { WorldTile, TileType } from "../types/worldTile.js";

function asTileType(typeName: string): TileType {
  if (typeName.length === 0) return "open";
  return (typeName[0]!.toLowerCase() + typeName.slice(1)) as TileType;
}

function neighborsForCell(h3Index: string): string[] {
  if (!isValidCell(h3Index)) return [];
  return gridDisk(h3Index, 1).filter((c) => c !== h3Index);
}

export async function parseMapGramToTiles(gramText: string): Promise<Map<string, WorldTile>> {
  const parsed = await parseMapGram(gramText);
  const tiles = new Map<string, WorldTile>();

  for (const [h3Index, cell] of parsed.cells) {
    tiles.set(h3Index, {
      h3Index,
      tileType: asTileType(cell.tileType),
      items: Object.freeze([...cell.items]),
      neighbors: Object.freeze(neighborsForCell(h3Index)),
    });
  }

  return tiles;
}
