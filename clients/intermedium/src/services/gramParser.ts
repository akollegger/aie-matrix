/**
 * Parse `.map.gram` text into a tile index.
 *
 * 1. `Gram.validate` (WASM) ensures the document is well-formed per `@relateby/pattern` (R-003).
 * 2. `extractTilesFromGramText` maps committed `.map.gram` cell/item lines into `WorldTile` rows
 *    using the same regex contract as `tools/tmj-to-gram` / `freeplay` tests. A full IR walk of
 *    `Gram.parse` is future work if we need deeper semantics than this stable serialisation shape.
 *
 * @see FR-006, `specs/010-tmj-to-gram` gram output
 */

import { Gram } from "@relateby/pattern";
import { Effect } from "effect";
import { gridDisk, isValidCell } from "h3-js";
import type { WorldTile, TileType } from "../types/worldTile.js";

function neighborsForCell(h3Index: string): string[] {
  if (!isValidCell(h3Index)) {
    return [];
  }
  return gridDisk(h3Index, 1).filter((c) => c !== h3Index);
}

const cellRe =
  /\(cell-[^:]+:([A-Za-z][A-Za-z0-9]*)\s*\{\s*location:\s*h3`([^`]+)`/g;

const itemRe =
  /\(item-[^:]+:([A-Za-z][A-Za-z0-9]*)\s*\{\s*location:\s*h3`([^`]+)`/g;

const legacyH3 = /location:\s*"([^"]+)"/g;

function normalizeH3(s: string): string {
  return s.trim().replace(/^0x/i, "").toLowerCase();
}

function asTileType(label: string): TileType {
  return label.length > 0 ? (label[0]!.toLowerCase() + label.slice(1)) as TileType : "open";
}

function extractTilesFromGramText(gramText: string): Map<string, WorldTile> {
  const h3ToItems = new Map<string, string[]>();

  let m: RegExpExecArray | null;
  itemRe.lastIndex = 0;
  while ((m = itemRe.exec(gramText)) !== null) {
    const itemType = m[1]!.toLowerCase();
    const h3 = normalizeH3(m[2]!);
    const list = h3ToItems.get(h3) ?? [];
    list.push(itemType);
    h3ToItems.set(h3, list);
  }

  const tiles = new Map<string, WorldTile>();

  cellRe.lastIndex = 0;
  while ((m = cellRe.exec(gramText)) !== null) {
    const tileTypeLabel = m[1]!;
    const h3 = normalizeH3(m[2]!);
    const items = Object.freeze(h3ToItems.get(h3) ?? []);
    tiles.set(h3, {
      h3Index: h3,
      tileType: asTileType(tileTypeLabel),
      items,
      neighbors: Object.freeze(neighborsForCell(h3)),
    });
  }

  // Cells authored only with legacy `location: "…"` (no h3`…`) — best-effort.
  if (tiles.size === 0) {
    const seen = new Set<string>();
    legacyH3.lastIndex = 0;
    while ((m = legacyH3.exec(gramText)) !== null) {
      const h3 = normalizeH3(m[1]!);
      if (seen.has(h3)) {
        continue;
      }
      seen.add(h3);
      const items = Object.freeze(h3ToItems.get(h3) ?? []);
      tiles.set(h3, {
        h3Index: h3,
        tileType: "open",
        items,
        neighbors: Object.freeze(neighborsForCell(h3)),
      });
    }
  }

  // Still attach item-only H3s as minimal tiles
  for (const [h3, it] of h3ToItems) {
    if (!tiles.has(h3)) {
      tiles.set(h3, {
        h3Index: h3,
        tileType: "open",
        items: Object.freeze(it),
        neighbors: Object.freeze(neighborsForCell(h3)),
      });
    }
  }

  return tiles;
}

/**
 * Validate with Gram WASM, then build the client tile index.
 */
export async function parseMapGramToTiles(gramText: string): Promise<Map<string, WorldTile>> {
  await Effect.runPromise(Gram.validate(gramText));
  return extractTilesFromGramText(gramText);
}
