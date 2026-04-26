import { readFile } from "node:fs/promises";
import { localIjToCell } from "h3-js";
import type { MapContext } from "./map-context.js";
import type { TmjDocument, TmjLayer } from "./parse-tmj.js";
import type { TilesetSlice } from "./parse-tsx.js";
import { resolveGidToTypeLabel } from "./parse-tsx.js";

const LAYER_CLASS_ITEM_PLACEMENT = "item-placement";

export interface ItemTypeEntry {
  readonly typeId: string;
  readonly label: string;
  readonly name: string;
  readonly glyph?: string;
  readonly color?: string;
}

export interface ItemInstanceEmission {
  readonly id: string;
  readonly typeLabel: string;
  readonly itemRef: string;
  readonly h3Index: string;
}

export type ItemSidecar = Record<
  string,
  {
    readonly name: string;
    readonly itemClass: string;
    readonly carriable: boolean;
    readonly capacityCost: number;
    readonly glyph?: string;
    readonly color?: string;
    readonly description?: string;
    readonly attrs?: Record<string, unknown>;
  }
>;

function isDataTileLayer(l: TmjLayer): boolean {
  if (!Array.isArray(l.data) || l.data.length === 0) {
    return false;
  }
  return l.type === undefined || l.type === "tilelayer";
}

function collectItemPlacementLayers(layers: TmjLayer[] | undefined): TmjLayer[] {
  const out: TmjLayer[] = [];
  for (const l of layers ?? []) {
    if (l.class === LAYER_CLASS_ITEM_PLACEMENT && isDataTileLayer(l)) {
      out.push(l);
    }
  }
  return out;
}

function gidAt(layer: TmjLayer, col: number, row: number): number {
  return layer.data![row * layer.width + col]!;
}

export async function loadItemSidecar(tmjPath: string): Promise<ItemSidecar | undefined> {
  const sidePath = tmjPath.replace(/\.tmj$/i, ".items.json");
  try {
    const raw = await readFile(sidePath, "utf8");
    return JSON.parse(raw) as ItemSidecar;
  } catch {
    return undefined;
  }
}

function itemTypeEntriesFromSidecar(sidecar: ItemSidecar | undefined): ItemTypeEntry[] {
  if (!sidecar) {
    return [];
  }
  const keys = Object.keys(sidecar).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.map((key) => {
    const def = sidecar[key]!;
    return {
      typeId: key,
      label: def.itemClass,
      name: def.name,
      glyph: def.glyph,
      color: def.color,
    };
  });
}

export function emitItemInstances(
  tmj: TmjDocument,
  ctx: MapContext,
  tilesets: readonly TilesetSlice[],
  sidecar: ItemSidecar | undefined,
  layoutH3: ReadonlySet<string>,
  warn: (msg: string) => void,
): ItemInstanceEmission[] {
  if (!sidecar) {
    return [];
  }
  const layers = collectItemPlacementLayers(tmj.layers);
  const out: ItemInstanceEmission[] = [];

  for (const placementLayer of layers) {
    if (placementLayer.width !== tmj.width || placementLayer.height !== tmj.height) {
      warn(
        `[warn] item-placement layer "${placementLayer.name ?? "?"}" size ${placementLayer.width}x${placementLayer.height} does not match map — skipping layer`,
      );
      continue;
    }
    for (let row = 0; row < tmj.height; row++) {
      for (let col = 0; col < tmj.width; col++) {
        const gid = gidAt(placementLayer, col, row);
        if (gid === 0) {
          continue;
        }
        const info = resolveGidToTypeLabel(tilesets, gid);
        if (!info) {
          continue;
        }
        const itemRef = info.typeLabel;
        const def = sidecar[itemRef];
        if (!def) {
          const layerLabel = placementLayer.name ?? "item-placement";
          warn(
            `[warn] item-placement layer "${layerLabel}" references itemRef "${itemRef}" which is not in the items sidecar — skipping`,
          );
          continue;
        }
        let h3Index: string;
        try {
          h3Index = localIjToCell(ctx.h3Anchor, { i: col, j: row });
        } catch {
          continue;
        }
        if (!layoutH3.has(h3Index)) {
          continue;
        }
        out.push({
          id: `item-${h3Index}-${itemRef}`,
          typeLabel: def.itemClass,
          itemRef,
          h3Index,
        });
      }
    }
  }

  out.sort((a, b) => {
    const rc = a.itemRef < b.itemRef ? -1 : a.itemRef > b.itemRef ? 1 : 0;
    if (rc !== 0) {
      return rc;
    }
    return a.h3Index < b.h3Index ? -1 : a.h3Index > b.h3Index ? 1 : 0;
  });

  return dedupeInstances(out);
}

function dedupeInstances(items: ItemInstanceEmission[]): ItemInstanceEmission[] {
  const seen = new Set<string>();
  const out: ItemInstanceEmission[] = [];
  for (const it of items) {
    const k = `${it.itemRef}\0${it.h3Index}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function buildItemTypeEntries(sidecar: ItemSidecar | undefined): ItemTypeEntry[] {
  return itemTypeEntriesFromSidecar(sidecar);
}
