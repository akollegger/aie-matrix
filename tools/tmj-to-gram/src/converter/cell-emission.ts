import type { MapContext } from "./map-context.js";
import type { TmjDocument, TmjLayer } from "./parse-tmj.js";
import type { TilesetSlice } from "./parse-tsx.js";
import { resolveGidToTypeLabel } from "./parse-tsx.js";
import type { TileAreaPolygon } from "./tile-area.js";
import { hexRenderParams, makeTileToH3 } from "./tiled-hex-grid.js";

const LAYER_CLASS_LAYOUT = "layout";

export interface CellEmission {
  readonly id: string;
  readonly typeLabel: string;
  readonly h3Index: string;
}

function isDataTileLayer(l: TmjLayer): boolean {
  if (!Array.isArray(l.data) || l.data.length === 0) {
    return false;
  }
  return l.type === undefined || l.type === "tilelayer";
}

function collectLayoutLayer(layers: TmjLayer[] | undefined): TmjLayer | undefined {
  const found = (layers ?? []).filter((l) => l.class === LAYER_CLASS_LAYOUT && isDataTileLayer(l));
  return found[0];
}

function gidAt(layer: TmjLayer, col: number, row: number): number {
  return layer.data![row * layer.width + col]!;
}

export function emitLayoutCells(
  tmj: TmjDocument,
  ctx: MapContext,
  tilesets: readonly TilesetSlice[],
  warn: (msg: string) => void,
  tileAreas: readonly TileAreaPolygon[] = [],
): CellEmission[] {
  const layer = collectLayoutLayer(tmj.layers);
  if (!layer) {
    throw new Error("No layout tile layer found");
  }
  if (layer.width !== tmj.width || layer.height !== tmj.height) {
    throw new Error("Layout layer size does not match map dimensions");
  }

  const hexP = hexRenderParams(ctx.tilewidth, ctx.tileheight, ctx.hexsidelength, ctx.staggeraxis, ctx.staggerindex);
  if (hexP === undefined) {
    throw new Error(`Unsupported staggeraxis "${ctx.staggeraxis}" — only "x" is supported`);
  }
  const tileToH3 = makeTileToH3(hexP, ctx.h3Anchor, tmj.width, tmj.height);
  const staged: { h3: string; typeLabel: string }[] = [];

  for (let row = 0; row < tmj.height; row++) {
    for (let col = 0; col < tmj.width; col++) {
      const gid = gidAt(layer, col, row);
      if (gid === 0) {
        continue;
      }
      const info = resolveGidToTypeLabel(tilesets, gid);
      if (!info) {
        warn(`[warn] layout layer cell at (${col},${row}) uses unknown gid ${gid} — skipping cell`);
        continue;
      }
      const typeLabel = info.typeLabel;
      const h3 = tileToH3(col, row);
      if (h3 === null) {
        warn(`[warn] layout layer cell at (${col},${row}) could not be projected to H3 — skipping`);
        continue;
      }
      let impliedByPolygonShape = false;
      for (const area of tileAreas) {
        if (area.layoutShapeHexes.has(h3) && area.typeLabel === typeLabel) {
          impliedByPolygonShape = true;
          break;
        }
      }
      if (impliedByPolygonShape) {
        continue;
      }
      staged.push({ h3, typeLabel });
    }
  }

  staged.sort((a, b) => (a.h3 < b.h3 ? -1 : a.h3 > b.h3 ? 1 : 0));

  return staged.map((s) => ({
    id: `cell-${s.h3}`,
    typeLabel: s.typeLabel,
    h3Index: s.h3,
  }));
}

/**
 * Tile type labels in first-encounter order: layout cells by ascending H3, then `tile-area` object
 * types in ascending Tiled object id (IC-001 determinism).
 */
export function tileTypeEncounterOrder(
  cells: readonly CellEmission[],
  tileAreaTypeLabelsInIdOrder: readonly string[] = [],
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    if (!seen.has(c.typeLabel)) {
      seen.add(c.typeLabel);
      order.push(c.typeLabel);
    }
  }
  for (const label of tileAreaTypeLabelsInIdOrder) {
    if (label.length > 0 && !seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order;
}
