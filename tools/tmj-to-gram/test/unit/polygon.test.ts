import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cellToLatLng, getResolution, isValidCell, polygonToCells } from "h3-js";
import { describe, expect, it } from "vitest";
import { buildGramUtf8 } from "../../src/convert.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const mapTmj = join(repoRoot, "maps/sandbox/map-with-polygons.tmj");
const mapGram = join(repoRoot, "maps/sandbox/map-with-polygons.map.gram");

function latLngRing(vertexCells: readonly string[]): [number, number][] {
  return vertexCells.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return [lat, lng] as [number, number];
  });
}

function parsePolygonLines(gram: string): Array<{ readonly id: string; readonly type: string; readonly verts: string[] }> {
  const re = /\[poly-(\d+):Polygon:([A-Za-z][A-Za-z0-9]*)\s*\|\s*([^\]]+)\]/g;
  const out: Array<{ id: string; type: string; verts: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(gram)) !== null) {
    const verts = m[3]!
      .split(",")
      .map((s) => {
        const t = s.trim();
        return t.startsWith("h") ? t.slice(1) : t;
      })
      .filter((s) => s.length > 0);
    out.push({ id: m[1]!, type: m[2]!, verts });
  }
  return out;
}

function tileTypeLabels(gram: string): Set<string> {
  const labels = new Set<string>();
  const defRe = /\([a-z0-9-]+:TileType:([A-Za-z][A-Za-z0-9]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(gram)) !== null) {
    labels.add(m[1]!);
  }
  return labels;
}

function cellNodesByType(gram: string, typeLabel: string): Map<string, string> {
  const re = new RegExp(`\\(cell-([^:]+):${typeLabel}\\s*\\{\\s*location:\\s*"([^"]+)"\\s*\\}`, "g");
  const map = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(gram)) !== null) {
    map.set(m[2]!, m[1]!);
  }
  return map;
}

describe("map-with-polygons polygon conversion", () => {
  it("live conversion matches committed golden", async () => {
    const live = await buildGramUtf8(mapTmj);
    const golden = await readFile(mapGram, "utf8");
    expect(live).toBe(golden);
  });

  it("every polygon vertex is valid H3 res-15", async () => {
    const text = await readFile(mapGram, "utf8");
    for (const poly of parsePolygonLines(text)) {
      for (const h of poly.verts) {
        expect(isValidCell(h), h).toBe(true);
        expect(getResolution(h), h).toBe(15);
      }
    }
  });

  it("every polygon type label has a TileType definition", async () => {
    const text = await readFile(mapGram, "utf8");
    const defs = tileTypeLabels(text);
    for (const poly of parsePolygonLines(text)) {
      expect(defs.has(poly.type), poly.type).toBe(true);
    }
  });

  it("pairwise polygon interiors do not intersect", async () => {
    const text = await readFile(mapGram, "utf8");
    const polys = parsePolygonLines(text);
    const interiors = polys.map((p) => new Set(polygonToCells(latLngRing(p.verts), 15)));
    for (let i = 0; i < interiors.length; i++) {
      for (let j = i + 1; j < interiors.length; j++) {
        const a = interiors[i]!;
        const b = interiors[j]!;
        let overlap = 0;
        const smaller = a.size <= b.size ? a : b;
        const other = a.size <= b.size ? b : a;
        for (const h of smaller) {
          if (other.has(h)) {
            overlap++;
          }
        }
        expect(overlap, `poly ${polys[i]!.id} vs ${polys[j]!.id}`).toBe(0);
      }
    }
  });

  it("Yellow and Purple polygons share a vertex cell but have disjoint interiors", async () => {
    const text = await readFile(mapGram, "utf8");
    const polys = parsePolygonLines(text);
    const yellow = polys.find((p) => p.id === "4");
    const purple = polys.find((p) => p.id === "6");
    expect(yellow).toBeDefined();
    expect(purple).toBeDefined();
    const shared = yellow!.verts.filter((h) => purple!.verts.includes(h));
    expect(shared.length).toBeGreaterThan(0);

    const yi = new Set(polygonToCells(latLngRing(yellow!.verts), 15));
    const pi = new Set(polygonToCells(latLngRing(purple!.verts), 15));
    let n = 0;
    for (const h of yi) {
      if (pi.has(h)) {
        n++;
      }
    }
    expect(n).toBe(0);
  });

  it("override: Yellow layout cells inside the Purple polygon interior are still emitted", async () => {
    const text = await readFile(mapGram, "utf8");
    const purple = parsePolygonLines(text).find((p) => p.id === "6");
    expect(purple).toBeDefined();
    const purpleInterior = new Set(polygonToCells(latLngRing(purple!.verts), 15));
    const yellowCells = cellNodesByType(text, "Yellow");
    let found = 0;
    for (const h3 of yellowCells.keys()) {
      if (purpleInterior.has(h3)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("compression: some Red layout cell in Red polygon interior is not emitted as an individual node", async () => {
    const text = await readFile(mapGram, "utf8");
    const red = parsePolygonLines(text).find((p) => p.id === "1");
    expect(red).toBeDefined();
    const verts = new Set(red!.verts);
    const interior = new Set(polygonToCells(latLngRing(red!.verts), 15));
    const redCells = cellNodesByType(text, "Red");
    let suppressed = 0;
    for (const h3 of interior) {
      if (verts.has(h3)) {
        continue;
      }
      if (!redCells.has(h3)) {
        suppressed++;
      }
    }
    expect(suppressed).toBeGreaterThan(0);
  });
});
