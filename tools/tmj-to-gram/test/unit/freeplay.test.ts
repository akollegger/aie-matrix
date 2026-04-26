import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getResolution, isValidCell } from "h3-js";
import { Gram } from "@relateby/pattern";
import { Effect } from "effect";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const freeplayItemsPath = join(repoRoot, "maps/sandbox/freeplay.items.json");
const freeplayGram = join(repoRoot, "maps/sandbox/freeplay.map.gram");

function collectLocations(gramText: string): string[] {
  const out: string[] = [];
  const tagged = /location:\s*h3`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = tagged.exec(gramText)) !== null) {
    const hex = m[1]!.trim().replace(/^0x/i, "").toLowerCase();
    out.push(hex);
  }
  const legacy = /location:\s*"([^"]+)"/g;
  while ((m = legacy.exec(gramText)) !== null) {
    out.push(m[1]!.trim().replace(/^0x/i, "").toLowerCase());
  }
  return out;
}

function collectTileTypeLabels(gramText: string): Set<string> {
  const labels = new Set<string>();
  const defRe = /\(([a-z0-9-]+):TileType:([A-Za-z][A-Za-z0-9]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(gramText)) !== null) {
    labels.add(m[2]!);
  }
  return labels;
}

function collectCellTypeLabels(gramText: string): string[] {
  const out: string[] = [];
  const cellRe = /\(cell-[^:]+:([A-Za-z][A-Za-z0-9]*)\s*\{\s*location:/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(gramText)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function collectItemTypeLabels(gramText: string): Set<string> {
  const labels = new Set<string>();
  const defRe = /\([^:]+:ItemType:([A-Za-z][A-Za-z0-9]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(gramText)) !== null) {
    labels.add(m[1]!);
  }
  return labels;
}

function collectItemInstanceLabels(gramText: string): string[] {
  const out: string[] = [];
  const instRe = /\(item-[^:]+:([A-Za-z][A-Za-z0-9]*)\s*\{\s*location:/g;
  let m: RegExpExecArray | null;
  while ((m = instRe.exec(gramText)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

describe("freeplay.map.gram", () => {
  it("parses with Gram.parse", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const exit = await Effect.runPromiseExit(Gram.parse(text));
    expect(exit._tag).toBe("Success");
  });

  it("every location is valid H3 res 15", async () => {
    const text = await readFile(freeplayGram, "utf8");
    for (const loc of collectLocations(text)) {
      expect(isValidCell(loc), loc).toBe(true);
      expect(getResolution(loc), loc).toBe(15);
    }
  });

  it("cell types reference defined TileTypes", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const defs = collectTileTypeLabels(text);
    for (const label of collectCellTypeLabels(text)) {
      expect(defs.has(label), `missing TileType for ${label}`).toBe(true);
    }
  });

  it("item instances reference defined ItemTypes", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const defs = collectItemTypeLabels(text);
    for (const label of collectItemInstanceLabels(text)) {
      expect(defs.has(label), `missing ItemType for ${label}`).toBe(true);
    }
  });

  it("ItemType definitions match sidecar itemClass values", async () => {
    const text = await readFile(freeplayGram, "utf8");
    const sidecar = JSON.parse(await readFile(freeplayItemsPath, "utf8")) as Record<string, { itemClass: string }>;
    const sidecarClasses = new Set(Object.values(sidecar).map((e) => e.itemClass));
    const gramItemTypes = collectItemTypeLabels(text);
    for (const c of sidecarClasses) {
      expect(gramItemTypes.has(c), `gram missing ItemType for class ${c}`).toBe(true);
    }
  });
});
