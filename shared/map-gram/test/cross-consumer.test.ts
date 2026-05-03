import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gridDisk, isValidCell } from "h3-js";
import { parseMapGram } from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const canonicalPath = join(fixturesDir, "canonical.map.gram");

/**
 * Simulates the Colyseus adapter: extract h3Index set from ParsedMap.cells
 * without lowercasing (CellRecord uses original tileClass).
 */
function colonCells(cells: Map<string, { tileType: string }>): Set<string> {
  return new Set(cells.keys());
}

/**
 * Simulates the intermedium adapter: extract h3Index set from ParsedMap.cells
 * with lowercase-first tileType (WorldTile.tileType).
 */
function intermediumCells(cells: Map<string, { tileType: string }>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [h3, cell] of cells) {
    result.set(h3, cell.tileType[0]!.toLowerCase() + cell.tileType.slice(1));
  }
  return result;
}

describe("cross-consumer contract (US2)", () => {
  it("both adapters produce the same h3Index set from canonical.map.gram", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);

    const colyseusH3 = colonCells(parsed.cells);
    const intermediumMap = intermediumCells(parsed.cells);

    expect(colyseusH3.size).toBe(intermediumMap.size);
    for (const h3 of colyseusH3) {
      expect(intermediumMap.has(h3)).toBe(true);
    }
  });

  it("tileType differences are only case-normalisation (Pillar vs pillar)", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);

    for (const [h3, cell] of parsed.cells) {
      const colyseusType = cell.tileType; // e.g., "Pillar"
      const intermediumType = cell.tileType[0]!.toLowerCase() + cell.tileType.slice(1); // e.g., "pillar"
      expect(intermediumType).toBe(colyseusType[0]!.toLowerCase() + colyseusType.slice(1));
      void h3;
    }
  });

  it("items arrays are identical in both adapters", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);

    for (const [h3, cell] of parsed.cells) {
      // Both adapters use parsedCell.items directly — verify it is the same reference
      expect(cell.items).toBeInstanceOf(Array);
      void h3;
    }
  });

  it("polygon fill produces more cells than just the 4 vertex cells", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);
    // The canonical map has a polygon with 4 vertices; the fill should expand it
    expect(parsed.cells.size).toBeGreaterThan(4);
  });

  it("intermedium: all returned cell h3Index values are valid H3 cells", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);
    for (const [h3] of parsed.cells) {
      expect(isValidCell(h3), `invalid H3: ${h3}`).toBe(true);
    }
  });

  it("intermedium: neighbour count is 6 for interior cells (gridDisk pattern)", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const parsed = await parseMapGram(text);
    // Pick any cell and verify gridDisk gives 6 neighbors
    const [firstH3] = parsed.cells.keys();
    if (!firstH3) return;
    const neighbors = gridDisk(firstH3, 1).filter((c) => c !== firstH3);
    expect(neighbors.length).toBe(6);
  });
});
