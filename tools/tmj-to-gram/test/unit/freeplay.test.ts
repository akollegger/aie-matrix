import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getResolution, isValidCell } from "h3-js";
import { Gram } from "@relateby/pattern";
import { Effect } from "effect";
import { parseMapGram } from "@aie-matrix/map-gram";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const freeplayGram = join(repoRoot, "maps/sandbox/freeplay.map.gram");

/** Extract all H3 indices from `geometry: [h3`...`, ...]` arrays in the new layered format. */
function collectGeometryH3s(gramText: string): string[] {
  const out: string[] = [];
  const re = /h3`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gramText)) !== null) {
    out.push(m[1]!.trim().replace(/^0x/i, "").toLowerCase());
  }
  return out;
}

describe("freeplay.map.gram (layered format)", () => {
  it("parses with Gram.parse", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const exit = await Effect.runPromiseExit(Gram.parse(text));
    expect(exit._tag).toBe("Success");
  });

  it("contains a LayerStack", async () => {
    const text = await readFile(freeplayGram, "utf8");
    expect(text).toContain("LayerStack");
  });

  it("contains movement Rules", async () => {
    const text = await readFile(freeplayGram, "utf8");
    expect(text).toContain(":GO");
  });

  it("every geometry H3 index is valid res-15", async () => {
    const text = await readFile(freeplayGram, "utf8");
    for (const h3 of collectGeometryH3s(text)) {
      expect(isValidCell(h3), h3).toBe(true);
      expect(getResolution(h3), h3).toBe(15);
    }
  });

  it("parseMapGram produces a non-empty cell map", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const map = await parseMapGram(text);
    expect(map.cells.size).toBeGreaterThan(0);
  });

  it("TileType declarations exist for all tile types used in layers", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const map = await parseMapGram(text);
    for (const cell of map.cells.values()) {
      const typeDef = [...map.tileTypes.values()].find((t) => t.typeName === cell.tileType);
      expect(typeDef, `missing TileType for ${cell.tileType}`).toBeDefined();
    }
  });

  it("items in cells reference declared ItemTypes", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const map = await parseMapGram(text);
    const itemTypeNames = new Set([...map.itemTypes.values()].map((t) => t.typeName));
    for (const cell of map.cells.values()) {
      for (const itemName of cell.items) {
        expect(itemTypeNames.has(itemName), `missing ItemType for ${itemName}`).toBe(true);
      }
    }
  });
});
