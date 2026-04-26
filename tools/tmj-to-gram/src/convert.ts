import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isValidCell, getResolution } from "h3-js";
import type { TmjLayer } from "./converter/parse-tmj.js";
import { parseTmjFile } from "./converter/parse-tmj.js";
import { parseTsxFile, type TilesetSlice } from "./converter/parse-tsx.js";
import { extractMapContext } from "./converter/map-context.js";
import type { CellEmission } from "./converter/cell-emission.js";
import { emitLayoutCells, tileTypeEncounterOrder } from "./converter/cell-emission.js";
import { buildTileAreas, formatPolygonGramLine } from "./converter/tile-area.js";
import {
  buildItemTypeEntries,
  emitItemInstances,
  loadItemSidecar,
  type ItemSidecar,
} from "./converter/item-emission.js";
import { buildTileMetaFromSlices, serializeGram } from "./converter/serialize-gram.js";

export type ConvertExit = 0 | 1 | 2 | 3;

type PipelineOk = { readonly tag: "ok"; readonly text: string };
type PipelineErr = { readonly tag: "err"; readonly exit: ConvertExit };
type PipelineResult = PipelineOk | PipelineErr;

function warnPortalObjects(layers: TmjLayer[] | undefined, log: (m: string) => void): void {
  for (const layer of layers ?? []) {
    if (layer.type !== "objectgroup" || layer.class !== "portal") {
      continue;
    }
    for (const obj of layer.objects ?? []) {
      const id = obj.id;
      const name = obj.name ?? "";
      log(`[warn] Ignoring portal object id=${id} name=${name} at (${obj.x},${obj.y}) — portals are out of scope.`);
    }
  }
}

function resolveTilesetPath(tmjDir: string, source: string): string {
  return isAbsolute(source) ? source : join(tmjDir, source);
}

/**
 * Runs the TMJ → gram serialization pipeline without writing a file.
 * Used by determinism tests and any caller that needs stable UTF-8 output.
 */
export async function buildGramUtf8(
  tmjPath: string,
  logWarn: (m: string) => void = () => {},
): Promise<string> {
  const errors: string[] = [];
  const r = await runConvertPipeline(tmjPath, (m) => errors.push(m), logWarn);
  if (r.tag === "err") {
    throw new Error(errors.join("\n") || `convert failed with exit ${r.exit}`);
  }
  return r.text;
}

async function runConvertPipeline(
  tmjPath: string,
  logError: (m: string) => void,
  logWarn: (m: string) => void,
): Promise<PipelineResult> {
  let tmj;
  try {
    tmj = await parseTmjFile(tmjPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`[error] Could not read TMJ "${tmjPath}": ${msg}`);
    return { tag: "err", exit: 3 };
  }

  warnPortalObjects(tmj.layers, logWarn);

  const ctxResult = extractMapContext(tmj, tmjPath);
  if (!ctxResult.ok) {
    if (ctxResult.error._tag === "MissingH3Anchor") {
      logError(`[error] Missing required map property "h3_anchor" in ${tmjPath}.`);
      return { tag: "err", exit: 1 };
    }
    logError(`[error] h3_resolution must be 15, got ${ctxResult.error.value} in ${tmjPath}.`);
    return { tag: "err", exit: 1 };
  }
  const ctx = ctxResult.ctx;

  if (!isValidCell(ctx.h3Anchor) || getResolution(ctx.h3Anchor) !== 15) {
    logError(`[error] h3_anchor "${ctx.h3Anchor}" is not a valid resolution-15 cell in ${tmjPath}.`);
    return { tag: "err", exit: 1 };
  }

  const tmjDir = dirname(tmjPath);
  const refs = tmj.tilesets ?? [];
  const slices: TilesetSlice[] = [];
  for (const ref of refs) {
    const p = resolveTilesetPath(tmjDir, ref.source);
    let tiles;
    try {
      tiles = await parseTsxFile(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`[error] Tileset file "${p}" referenced in ${tmjPath} could not be read: ${msg}`);
      return { tag: "err", exit: 3 };
    }
    slices.push({ firstgid: ref.firstgid, sourcePath: p, tiles });
  }

  let sidecar: ItemSidecar | undefined;
  try {
    sidecar = await loadItemSidecar(tmjPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(`[error] Item sidecar for ${tmjPath} could not be read: ${msg}`);
    return { tag: "err", exit: 3 };
  }

  const tileAreasResult = buildTileAreas(tmj, ctx, slices, logWarn);
  if (tileAreasResult._tag === "err") {
    logError(tileAreasResult.message);
    return { tag: "err", exit: 2 };
  }
  const tileAreas = tileAreasResult.areas;

  const cells = emitLayoutCells(tmj, ctx, slices, logWarn, tileAreas);
  const layoutH3 = new Set(cells.map((c) => c.h3Index));
  const items = emitItemInstances(tmj, ctx, slices, sidecar, layoutH3, logWarn);
  const itemTypes = buildItemTypeEntries(sidecar);
  const tileAreaTypesInIdOrder = tileAreas.map((a) => a.typeLabel);
  const tileMeta = buildTileMetaFromSlices(slices);

  const cellByH3 = new Map(cells.map((c) => [c.h3Index, c] as const));
  const vertexStubs: CellEmission[] = [];
  const polygonLines: string[] = [];
  for (const area of tileAreas) {
    const vertexIds: string[] = [];
    area.vertexCells.forEach((h3, vi) => {
      if (cellByH3.has(h3)) {
        vertexIds.push(`cell-${h3}`);
        return;
      }
      const id = `poly-${area.id}-v${vi}`;
      vertexIds.push(id);
      vertexStubs.push({ id, typeLabel: area.typeLabel, h3Index: h3 });
    });
    polygonLines.push(formatPolygonGramLine(area, vertexIds));
  }

  const mergedCells = [...cells, ...vertexStubs].sort((a, b) =>
    a.h3Index < b.h3Index ? -1 : a.h3Index > b.h3Index ? 1 : a.id.localeCompare(b.id),
  );
  const tileOrder = tileTypeEncounterOrder(mergedCells, tileAreaTypesInIdOrder);

  const text = serializeGram({
    mapId: ctx.mapStem,
    elevation: ctx.elevation,
    tileTypeOrder: tileOrder,
    tileMeta,
    itemTypes,
    polygonLines,
    cells: mergedCells,
    items,
  });

  return { tag: "ok", text };
}

export interface ConvertOptions {
  readonly tmjPath: string;
  readonly outPath?: string;
  readonly logError: (m: string) => void;
  readonly logWarn: (m: string) => void;
}

export async function convertTmjToGram(opts: ConvertOptions): Promise<ConvertExit> {
  const r = await runConvertPipeline(opts.tmjPath, opts.logError, opts.logWarn);
  if (r.tag === "err") {
    return r.exit;
  }

  const outPath = opts.outPath ?? opts.tmjPath.replace(/\.tmj$/i, ".map.gram");

  try {
    await writeFile(outPath, r.text, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      opts.logError(`[error] Output path "${outPath}" parent directory does not exist.`);
      return 3;
    }
    const msg = e instanceof Error ? e.message : String(e);
    opts.logError(`[error] Output path "${outPath}" is not writable: ${msg}`);
    return 3;
  }

  return 0;
}
