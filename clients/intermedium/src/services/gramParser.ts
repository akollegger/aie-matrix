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

export type TileTypeStyles = ReadonlyMap<string, string>;

function asTileType(typeName: string): TileType {
  if (typeName.length === 0) return "open";
  return (typeName[0]!.toLowerCase() + typeName.slice(1)) as TileType;
}

function neighborsForCell(h3Index: string): string[] {
  if (!isValidCell(h3Index)) return [];
  return gridDisk(h3Index, 1).filter((c) => c !== h3Index);
}

function extractHexColor(style?: string): string | undefined {
  if (!style) return undefined;
  return /background:\s*(#[0-9a-fA-F]{3,8})/.exec(style)?.[1];
}

export async function parseMapGramToTiles(gramText: string): Promise<{
  tiles: Map<string, WorldTile>;
  tileTypeStyles: TileTypeStyles;
}> {
  const parsed = await parseMapGram(gramText);

  const stylesBuilder = new Map<string, string>();
  for (const def of parsed.tileTypes.values()) {
    const hex = extractHexColor(def.style);
    if (hex) stylesBuilder.set(asTileType(def.typeName), hex);
  }
  const tileTypeStyles: TileTypeStyles = stylesBuilder;

  const tiles = new Map<string, WorldTile>();
  for (const [h3Index, cell] of parsed.cells) {
    tiles.set(h3Index, {
      h3Index,
      tileType: asTileType(cell.tileType),
      items: Object.freeze([...cell.items]),
      neighbors: Object.freeze(neighborsForCell(h3Index)),
    });
  }

  return { tiles, tileTypeStyles };
}
