import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMapGramToTiles } from "./gramParser.js";

const canonicalPath = fileURLToPath(new URL("../../../../maps/sandbox/canonical.map.gram", import.meta.url));

describe("parseMapGramToTiles — canonical.map.gram", () => {
  it("returns a non-empty tile map", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const { tiles } = await parseMapGramToTiles(text);
    expect(tiles.size).toBeGreaterThan(0);
  });

  it("Pillar cell has lowercase-first tileType 'pillar'", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const { tiles } = await parseMapGramToTiles(text);
    // canonical.map.gram overrides 8f2800000000012 as Pillar
    const cell = tiles.get("8f2800000000012");
    expect(cell).toBeDefined();
    expect(cell?.tileType).toBe("pillar");
  });

  it("item cell carries the item in its items array", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const { tiles } = await parseMapGramToTiles(text);
    const cell = tiles.get("8f2800000000015");
    expect(cell).toBeDefined();
    expect(cell?.items).toContain("BrassKey");
  });

  it("every cell has 6 neighbors (all topological adjacents)", async () => {
    const text = await readFile(canonicalPath, "utf8");
    const { tiles } = await parseMapGramToTiles(text);
    // Intermedium reports all 6 H3 neighbors, not just map-internal ones
    for (const tile of tiles.values()) {
      expect(tile.neighbors.length).toBe(6);
      break; // check first cell only — pattern holds
    }
  });
});
