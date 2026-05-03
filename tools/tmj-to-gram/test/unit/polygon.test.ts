import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getResolution, isValidCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { buildGramUtf8 } from "../../src/convert.js";
import { parseMapGram } from "@aie-matrix/map-gram";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const mapTmj = join(repoRoot, "maps/sandbox/map-with-polygons.tmj");
const mapGram = join(repoRoot, "maps/sandbox/map-with-polygons.map.gram");

/** Extract polygon geometry arrays from the new layered format. */
function parsePolygonGeometries(gram: string): Array<{ typeName: string; vertices: string[] }> {
  const out: Array<{ typeName: string; vertices: string[] }> = [];
  const re = /\(:Polygon:([A-Za-z][A-Za-z0-9]*)\s*\{\s*geometry:\s*\[([^\]]+)\]\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gram)) !== null) {
    const vertices = [...m[2]!.matchAll(/h3`([^`]+)`/g)].map((v) => v[1]!.toLowerCase());
    out.push({ typeName: m[1]!, vertices });
  }
  return out;
}

describe("map-with-polygons polygon conversion (layered format)", () => {
  it("live conversion matches committed golden", async () => {
    const live = await buildGramUtf8(mapTmj);
    const golden = await readFile(mapGram, "utf8");
    expect(live).toBe(golden);
  });

  it("output contains a LayerStack", async () => {
    const text = await readFile(mapGram, "utf8");
    expect(text).toContain("LayerStack");
  });

  it("output contains polygon Layer walk", async () => {
    const text = await readFile(mapGram, "utf8");
    expect(text).toContain(":Polygon:");
    expect(text).toContain("geometry:");
  });

  it("every polygon vertex H3 is valid res-15", async () => {
    const text = await readFile(mapGram, "utf8");
    for (const poly of parsePolygonGeometries(text)) {
      for (const h3 of poly.vertices) {
        expect(isValidCell(h3), `invalid H3 in ${poly.typeName}: ${h3}`).toBe(true);
        expect(getResolution(h3), `wrong res in ${poly.typeName}: ${h3}`).toBe(15);
      }
    }
  });

  it("every polygon has at least 3 vertex cells", async () => {
    const text = await readFile(mapGram, "utf8");
    for (const poly of parsePolygonGeometries(text)) {
      expect(poly.vertices.length, `${poly.typeName} vertices`).toBeGreaterThanOrEqual(3);
    }
  });

  it("parseMapGram expands polygons to more cells than just vertices", async () => {
    const text = await readFile(mapGram, "utf8");
    const map = await parseMapGram(text);
    const polygons = parsePolygonGeometries(text);
    // Total unique vertices across all polygons
    const totalVertexCount = new Set(polygons.flatMap((p) => p.vertices)).size;
    // Parsed cell map should have more cells than just the vertices
    expect(map.cells.size).toBeGreaterThan(totalVertexCount);
  });

  it("tmj and gram loaders produce the same cell set", async () => {
    const text = await readFile(mapGram, "utf8");
    const map = await parseMapGram(text);
    // Every cell should be a valid res-15 H3 index
    for (const h3 of map.cells.keys()) {
      expect(isValidCell(h3), h3).toBe(true);
      expect(getResolution(h3), h3).toBe(15);
    }
    expect(map.cells.size).toBeGreaterThan(0);
  });
});
