import { readFile } from "node:fs/promises";
import { cellToLatLng, polygonToCells } from "h3-js";
import { Gram, Pattern, Subject } from "@relateby/pattern";
import { Effect, HashMap, Option, pipe } from "effect";
import type { HexMapFrame, ParityItemInstance, ParityRenderModel } from "./render-model.js";

function stringProp(s: Subject, key: string): string | undefined {
  return pipe(
    HashMap.get(s.properties, key),
    Option.flatMap((v) => (v._tag === "StringVal" ? Option.some(v.value) : Option.none())),
    Option.getOrUndefined,
  );
}

function latLngRing(vertexCells: readonly string[]): [number, number][] {
  return vertexCells.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return [lat, lng] as [number, number];
  });
}

function stripHPrefix(token: string): string {
  return token.startsWith("h") ? token.slice(1) : token;
}

function isPolygonSubject(s: Subject): boolean {
  return [...s.labels].includes("Polygon");
}

function isTileTypeDef(s: Subject): boolean {
  return [...s.labels].includes("TileType");
}

function polygonTypeLabel(s: Subject): string | undefined {
  const labs = [...s.labels].filter((l) => l !== "Polygon");
  return labs[0];
}

function tileTypeLabelFromDef(s: Subject): string | undefined {
  const labs = [...s.labels].filter((l) => l !== "TileType");
  return labs[0];
}

function cellTileLabel(s: Subject): string | undefined {
  const labs = [...s.labels];
  return labs[0];
}

function itemInstanceClass(s: Subject): string | undefined {
  const labs = [...s.labels];
  return labs[0];
}

function walkSubjects(patterns: ReadonlyArray<Pattern<Subject>>, fn: (s: Subject) => void): void {
  const visit = (p: Pattern<Subject>): void => {
    const v = p.value;
    if (v instanceof Subject) {
      fn(v);
    }
    for (const e of p.elements) {
      visit(e);
    }
  };
  for (const p of patterns) {
    visit(p);
  }
}

/**
 * Parses committed `.map.gram` text and builds the same logical terrain + items as {@link tmjPathToRenderModel},
 * using `frame` from the sibling `.tmj` for H3 projection (the gram file does not embed `h3_anchor`).
 */
export async function gramTextToRenderModel(gramText: string, frame: HexMapFrame): Promise<ParityRenderModel> {
  const patterns = await Effect.runPromise(Gram.parse(gramText));

  const tileColorsFromGram = new Map<string, string>();
  walkSubjects(patterns, (s) => {
    if (!isTileTypeDef(s)) {
      return;
    }
    const lab = tileTypeLabelFromDef(s);
    if (lab === undefined) {
      return;
    }
    const c = stringProp(s, "color");
    if (c !== undefined && c.length > 0) {
      tileColorsFromGram.set(lab, c);
    }
  });

  const merged = new Map<string, string>();

  for (const p of patterns) {
    if (!(p.value instanceof Subject)) {
      continue;
    }
    const root = p.value;
    if (isPolygonSubject(root)) {
      const typeLabel = polygonTypeLabel(root);
      if (typeLabel === undefined || typeLabel.length === 0) {
        continue;
      }
      const verts: string[] = [];
      for (const el of p.elements) {
        if (!(el.value instanceof Subject)) {
          continue;
        }
        verts.push(stripHPrefix(el.value.identity));
      }
      if (verts.length < 3) {
        continue;
      }
      let interior: Set<string>;
      try {
        interior = new Set(polygonToCells(latLngRing(verts), 15));
      } catch {
        continue;
      }
      for (const h of interior) {
        merged.set(h, typeLabel);
      }
    }
  }

  const items: ParityItemInstance[] = [];

  for (const p of patterns) {
    if (!p.isAtomic || !(p.value instanceof Subject)) {
      continue;
    }
    const s = p.value;
    const loc = stringProp(s, "location");
    if (loc === undefined) {
      continue;
    }
    if (s.identity.startsWith("cell-")) {
      const lab = cellTileLabel(s);
      if (lab !== undefined) {
        merged.set(loc, lab);
      }
      continue;
    }
    if (s.identity.startsWith("item-")) {
      const ic = itemInstanceClass(s);
      if (ic !== undefined) {
        items.push({ h3: loc, itemClass: ic });
      }
    }
  }

  return {
    frame,
    terrain: merged,
    items,
    tileColorsFromGram,
  };
}

export async function gramPathToRenderModel(gramPath: string, frame: HexMapFrame): Promise<ParityRenderModel> {
  const text = await readFile(gramPath, "utf8");
  return gramTextToRenderModel(text, frame);
}
