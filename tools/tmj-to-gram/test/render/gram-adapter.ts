import { readFile } from "node:fs/promises";
import { parseMapGram } from "@aie-matrix/map-gram";
import type { HexMapFrame, ParityItemInstance, ParityRenderModel } from "./render-model.js";

/** Extract `color: "..."` values from TileType declarations in the gram text (tmj-to-gram emits this). */
function extractTileColors(gramText: string): Map<string, string> {
  const result = new Map<string, string>();
  const re = /\([a-z0-9-]+:TileType:([A-Za-z][A-Za-z0-9]*)\s*\{[^}]*color:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gramText)) !== null) {
    result.set(m[1]!, m[2]!);
  }
  return result;
}

/**
 * Parses a `.map.gram` file using the canonical parser and builds the same
 * logical terrain + items model as {@link tmjPathToRenderModel}.
 *
 * The `frame` parameter is taken from the sibling `.tmj` file for H3 projection;
 * gram files do not embed `h3_anchor`.
 */
export async function gramTextToRenderModel(gramText: string, frame: HexMapFrame): Promise<ParityRenderModel> {
  const parsed = await parseMapGram(gramText);

  const terrain = new Map<string, string>();
  for (const [h3, cell] of parsed.cells) {
    terrain.set(h3, cell.tileType);
  }

  const items: ParityItemInstance[] = [];
  for (const [h3, cell] of parsed.cells) {
    for (const itemTypeName of cell.items) {
      items.push({ h3, itemClass: itemTypeName });
    }
  }

  const tileColorsFromGram = extractTileColors(gramText);

  return { frame, terrain, items, tileColorsFromGram };
}

export async function gramPathToRenderModel(gramPath: string, frame: HexMapFrame): Promise<ParityRenderModel> {
  const text = await readFile(gramPath, "utf8");
  return gramTextToRenderModel(text, frame);
}
