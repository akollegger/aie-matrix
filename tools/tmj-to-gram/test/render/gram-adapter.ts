import { readFile } from "node:fs/promises";
import { cellToLatLng, polygonToCells } from "h3-js";
import { Gram, Pattern, Subject } from "@relateby/pattern";
import type { Value } from "@relateby/pattern";
import { Effect, HashMap, Option, pipe } from "effect";
import type { HexMapFrame, ParityItemInstance, ParityRenderModel } from "./render-model.js";

function stringProp(s: Subject, key: string): string | undefined {
  return pipe(
    HashMap.get(s.properties, key),
    Option.flatMap((v) => (v._tag === "StringVal" ? Option.some(v.value) : Option.none())),
    Option.getOrUndefined,
  );
}

/** Resolves `location` from `h3\`…\`` (TaggedStringVal) or legacy quoted string. */
function h3IndexFromLocationValue(val: Value | undefined): string | undefined {
  if (val === undefined) {
    return undefined;
  }
  if (val._tag === "TaggedStringVal" && val.tag === "h3") {
    const c = val.content.trim();
    const hex = c.startsWith("0x") || c.startsWith("0X") ? c.slice(2) : c;
    return hex.toLowerCase();
  }
  if (val._tag === "StringVal") {
    const s = val.value.trim();
    const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
    return hex.toLowerCase();
  }
  return undefined;
}

function locationH3(s: Subject): string | undefined {
  return pipe(HashMap.get(s.properties, "location"), Option.getOrUndefined, h3IndexFromLocationValue);
}

function latLngRing(vertexCells: readonly string[]): [number, number][] {
  return vertexCells.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return [lat, lng] as [number, number];
  });
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

  const identityToH3 = new Map<string, string>();
  for (const p of patterns) {
    if (!p.isAtomic || !(p.value instanceof Subject)) {
      continue;
    }
    const s = p.value;
    const h3 = locationH3(s);
    if (h3 !== undefined && s.identity.length > 0) {
      identityToH3.set(s.identity, h3);
    }
  }

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
        const id = el.value.identity;
        const h3 = identityToH3.get(id);
        if (h3 !== undefined) {
          verts.push(h3);
        }
      }
      if (verts.length < 3) {
        continue;
      }
      let shapeHexes: Set<string>;
      try {
        shapeHexes = new Set(polygonToCells(latLngRing(verts), 15));
      } catch {
        continue;
      }
      for (const h of verts) {
        shapeHexes.add(h);
      }
      for (const h of shapeHexes) {
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
    const loc = locationH3(s);
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
