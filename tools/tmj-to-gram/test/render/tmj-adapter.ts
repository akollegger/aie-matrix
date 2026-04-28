import { dirname, isAbsolute, join } from "node:path";
import { hexRenderParams, makeTileToH3 } from "../../src/converter/tiled-hex-grid.js";
import { emitLayoutCells } from "../../src/converter/cell-emission.js";
import { extractMapContext } from "../../src/converter/map-context.js";
import { emitItemInstances, loadItemSidecar, type ItemSidecar } from "../../src/converter/item-emission.js";
import { parseTmjFile, type TmjDocument, type TmjLayer } from "../../src/converter/parse-tmj.js";
import { parseTsxFile, resolveGidToTypeLabel, type TilesetSlice } from "../../src/converter/parse-tsx.js";
import { buildTileAreas, type TileAreaPolygon } from "../../src/converter/tile-area.js";
import type { HexMapFrame, ParityItemInstance, ParityRenderModel } from "./render-model.js";

function isDataTileLayer(l: TmjLayer): boolean {
  if (!Array.isArray(l.data) || l.data.length === 0) {
    return false;
  }
  return l.type === undefined || l.type === "tilelayer";
}

function collectLayoutLayer(layers: TmjLayer[] | undefined): TmjLayer | undefined {
  const found = (layers ?? []).filter((l) => l.class === "layout" && isDataTileLayer(l));
  return found[0];
}

function gidAt(layer: TmjLayer, col: number, row: number): number {
  return layer.data![row * layer.width + col]!;
}

function resolveTilesetPath(tmjDir: string, source: string): string {
  return isAbsolute(source) ? source : join(tmjDir, source);
}

/**
 * Full TMJ layout merge: polygon shape (`layoutShapeHexes`: fill ∪ vertices) first, then explicit layout cells (overrides).
 * Matches committed gram semantics (shape-implied hexes have no `cell-*` node; TMJ is unchanged).
 */
export function mergeTerrainFromTmj(
  tmj: TmjDocument,
  ctx: HexMapFrame["ctx"],
  tilesets: readonly TilesetSlice[],
  tileAreas: readonly TileAreaPolygon[],
  warn: (m: string) => void,
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const area of tileAreas) {
    for (const h of area.layoutShapeHexes) {
      merged.set(h, area.typeLabel);
    }
  }
  const layer = collectLayoutLayer(tmj.layers);
  if (!layer) {
    throw new Error("No layout tile layer found");
  }
  const hexP = hexRenderParams(ctx.tilewidth, ctx.tileheight, ctx.hexsidelength, ctx.staggeraxis, ctx.staggerindex);
  if (!hexP) throw new Error(`Unsupported staggeraxis "${ctx.staggeraxis}"`);
  const tileToH3 = makeTileToH3(hexP, ctx.h3Anchor, tmj.width, tmj.height);
  for (let row = 0; row < tmj.height; row++) {
    for (let col = 0; col < tmj.width; col++) {
      const gid = gidAt(layer, col, row);
      if (gid === 0) {
        continue;
      }
      const info = resolveGidToTypeLabel(tilesets, gid);
      if (!info) {
        warn(`[warn] layout unknown gid ${gid} at (${col},${row}) — skipped in parity merge`);
        continue;
      }
      const h3 = tileToH3(col, row);
      if (h3 === null) continue;
      merged.set(h3, info.typeLabel);
    }
  }
  return merged;
}

export async function tmjPathToRenderModel(tmjPath: string): Promise<ParityRenderModel> {
  const tmj = await parseTmjFile(tmjPath);
  const ctxResult = extractMapContext(tmj, tmjPath);
  if (!ctxResult.ok) {
    throw new Error(`Map context invalid for ${tmjPath}`);
  }
  const ctx = ctxResult.ctx;
  const frame: HexMapFrame = {
    ctx,
    mapWidth: tmj.width,
    mapHeight: tmj.height,
  };

  const tmjDir = dirname(tmjPath);
  const slices: TilesetSlice[] = [];
  for (const ref of tmj.tilesets ?? []) {
    const p = resolveTilesetPath(tmjDir, ref.source);
    slices.push({ firstgid: ref.firstgid, sourcePath: p, tiles: await parseTsxFile(p) });
  }

  const warns: string[] = [];
  const warn = (m: string) => {
    warns.push(m);
  };

  const tileAreasResult = buildTileAreas(tmj, ctx, slices, warn);
  if (tileAreasResult._tag === "err") {
    throw new Error(tileAreasResult.message);
  }
  const terrain = mergeTerrainFromTmj(tmj, ctx, slices, tileAreasResult.areas, warn);

  const cells = emitLayoutCells(tmj, ctx, slices, warn, tileAreasResult.areas);
  const layoutH3 = new Set(cells.map((c) => c.h3Index));
  let sidecar: ItemSidecar | undefined;
  try {
    sidecar = await loadItemSidecar(tmjPath);
  } catch {
    sidecar = undefined;
  }
  const itemEmissions = emitItemInstances(tmj, ctx, slices, sidecar, layoutH3, warn);
  const items: ParityItemInstance[] = itemEmissions.map((e) => ({
    h3: e.h3Index,
    itemClass: e.typeLabel,
  }));

  return { frame, terrain, items };
}
