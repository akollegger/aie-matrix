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
      .map((s) => s.trim().replace(/\/\/.*$/, "").trim())
      .filter((s) => s.length > 0);
    out.push({ id: m[1]!, type: m[2]!, verts });
  }
  return out;
}

/** Maps tile/instance identifiers to H3 index strings from `location: h3\`…\`` (or legacy quoted). */
function identityToH3FromGram(gram: string): Map<string, string> {
  const map = new Map<string, string>();
  const tagged = /\(([a-zA-Z0-9-]+):[A-Za-z][A-Za-z0-9]*\s*\{\s*location:\s*h3`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = tagged.exec(gram)) !== null) {
    const hex = m[2]!.trim().replace(/^0x/i, "").toLowerCase();
    map.set(m[1]!, hex);
  }
  const legacy = /\(([a-zA-Z0-9-]+):[A-Za-z][A-Za-z0-9]*\s*\{\s*location:\s*"([^"]+)"/g;
  while ((m = legacy.exec(gram)) !== null) {
    const hex = m[2]!.trim().replace(/^0x/i, "").toLowerCase();
    if (!map.has(m[1]!)) {
      map.set(m[1]!, hex);
    }
  }
  return map;
}

function polygonVertexH3s(gram: string, verts: readonly string[]): string[] {
  const idMap = identityToH3FromGram(gram);
  return verts.map((ref) => {
    const h = idMap.get(ref);
    if (h === undefined) {
      throw new Error(`undefined polygon vertex ref ${ref}`);
    }
    return h;
  });
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
  const map = new Map<string, string>();
  const tagged = new RegExp(
    `\\(cell-([^:]+):${typeLabel}\\s*\\{\\s*location:\\s*h3\\\`([^\\\`]+)\\\`\\s*\\}`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = tagged.exec(gram)) !== null) {
    const hex = m[2]!.trim().replace(/^0x/i, "").toLowerCase();
    map.set(hex, m[1]!);
  }
  const legacy = new RegExp(`\\(cell-([^:]+):${typeLabel}\\s*\\{\\s*location:\\s*"([^"]+)"\\s*\\}`, "g");
  while ((m = legacy.exec(gram)) !== null) {
    const hex = m[2]!.trim().replace(/^0x/i, "").toLowerCase();
    if (!map.has(hex)) {
      map.set(hex, m[1]!);
    }
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
      for (const h of polygonVertexH3s(text, poly.verts)) {
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
    const interiors = polys.map((p) => new Set(polygonToCells(latLngRing(polygonVertexH3s(text, p.verts)), 15)));
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

  it("no redundant cell-* for a polygon type on that polygon's shape cover (fill ∪ vertices)", async () => {
    const text = await readFile(mapGram, "utf8");
    const polys = parsePolygonLines(text);
    for (const poly of polys) {
      const ring = polygonVertexH3s(text, poly.verts);
      const interior = new Set(polygonToCells(latLngRing(ring), 15));
      const cover = new Set<string>([...interior, ...ring]);
      const cellsOfPolyType = cellNodesByType(text, poly.type);
      for (const h of cover) {
        expect(
          cellsOfPolyType.has(h),
          `redundant cell-* for ${poly.type} on ${h} inside poly-${poly.id} shape cover`,
        ).toBe(false);
      }
    }
  });

  it("shape-primary: some hex in Red polygon cover (fill ∪ vertices) has no Red cell-* node", async () => {
    const text = await readFile(mapGram, "utf8");
    const red = parsePolygonLines(text).find((p) => p.id === "1");
    expect(red).toBeDefined();
    const ring = polygonVertexH3s(text, red!.verts);
    const interior = new Set(polygonToCells(latLngRing(ring), 15));
    const cover = new Set<string>([...interior, ...ring]);
    const redCells = cellNodesByType(text, "Red");
    let suppressed = 0;
    for (const h3 of cover) {
      if (!redCells.has(h3)) {
        suppressed++;
      }
    }
    expect(suppressed).toBeGreaterThan(0);
  });
});
