import { cellToLatLng, localIjToCell, polygonToCells } from "h3-js";
import type { MapContext } from "./map-context.js";
import type { TmjDocument, TmjLayer, TmjObject } from "./parse-tmj.js";
import type { TilesetSlice } from "./parse-tsx.js";
import { hexRenderParams, resolvePixelToColRow } from "./tiled-hex-grid.js";

const TILE_AREA_CLASS = "tile-area";

export interface TileAreaPolygon {
  readonly id: number;
  readonly name: string;
  readonly typeLabel: string;
  readonly vertexCells: readonly string[];
  readonly interior: ReadonlySet<string>;
}

export type TileAreaPipelineResult =
  | { readonly _tag: "ok"; readonly areas: readonly TileAreaPolygon[] }
  | { readonly _tag: "err"; readonly message: string };

function collectTileAreaLayerObjects(layers: TmjLayer[] | undefined): TmjObject[] {
  const out: TmjObject[] = [];
  for (const layer of layers ?? []) {
    if (layer.class !== TILE_AREA_CLASS) {
      continue;
    }
    for (const obj of layer.objects ?? []) {
      out.push(obj);
    }
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function typeKnownInTilesets(slices: readonly TilesetSlice[], typeLabel: string): boolean {
  for (const s of slices) {
    for (const t of s.tiles.values()) {
      if (t.typeLabel === typeLabel) {
        return true;
      }
    }
  }
  return false;
}

function buildVertexPixels(obj: TmjObject): { pixels: Array<{ x: number; y: number }>; err?: string } {
  if (obj.ellipse === true) {
    return {
      pixels: [],
      err: `[error] tile-area object id=${obj.id} name=${obj.name ?? ""} is an ellipse. Ellipses are not supported. Remove or replace with a polygon.`,
    };
  }
  if (obj.polygon !== undefined && obj.polygon.length > 0) {
    if (obj.polygon.length < 3) {
      return {
        pixels: [],
        err: `[error] tile-area object id=${obj.id} name=${obj.name ?? ""} has fewer than 3 polygon vertices.`,
      };
    }
    const pixels = obj.polygon.map((pt) => ({ x: obj.x + pt.x, y: obj.y + pt.y }));
    return { pixels };
  }
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  if (!(w > 0 && h > 0)) {
    return {
      pixels: [],
      err: `[error] tile-area object id=${obj.id} name=${obj.name ?? ""} is not a valid rectangle (width/height must be > 0) or polygon.`,
    };
  }
  const { x, y } = obj;
  const pixels = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return { pixels };
}

function latLngRing(vertexCells: readonly string[]): [number, number][] {
  return vertexCells.map((h) => {
    const [lat, lng] = cellToLatLng(h);
    return [lat, lng] as [number, number];
  });
}

/**
 * Gram `@relateby/pattern` requires polygon vertex tokens to be identifiers (must not start with a digit).
 * H3 indexes are hex strings; prefix `h` is a stable, reversible encoding (`h` + canonical cell id).
 */
export function formatPolygonGramLine(area: TileAreaPolygon): string {
  const verts = area.vertexCells.map((h) => `h${h}`).join(", ");
  return `[poly-${area.id}:Polygon:${area.typeLabel} | ${verts}]`;
}

export function buildTileAreas(
  tmj: TmjDocument,
  ctx: MapContext,
  slices: readonly TilesetSlice[],
  logWarn: (msg: string) => void,
): TileAreaPipelineResult {
  if (ctx.staggeraxis !== "x") {
    return {
      _tag: "err",
      message: `[error] Only staggeraxis "x" is supported for tile-area conversion (got "${ctx.staggeraxis}").`,
    };
  }

  const p = hexRenderParams(ctx.tilewidth, ctx.tileheight, ctx.hexsidelength, ctx.staggeraxis, ctx.staggerindex);
  if (p === undefined) {
    return { _tag: "err", message: `[error] Invalid hex map dimensions for tile-area conversion.` };
  }

  const objects = collectTileAreaLayerObjects(tmj.layers);
  const areas: TileAreaPolygon[] = [];

  for (const obj of objects) {
    const typeLabel = obj.type ?? "";
    if (typeLabel.length > 0 && !typeKnownInTilesets(slices, typeLabel)) {
      logWarn(
        `[warn] tile-area object id=${obj.id} name=${obj.name ?? ""} has unknown type "${typeLabel}" (not found in any .tsx tileset).`,
      );
    }

    const built = buildVertexPixels(obj);
    if (built.err !== undefined) {
      return { _tag: "err", message: built.err };
    }

    const vertexCells: string[] = [];
    for (let vi = 0; vi < built.pixels.length; vi++) {
      const { x: px, y: py } = built.pixels[vi]!;
      const ij = resolvePixelToColRow(px, py, tmj.width, tmj.height, p);
      if (ij === "gutter") {
        return {
          _tag: "err",
          message: `[error] tile-area object id=${obj.id} vertex ${vi} at pixel (${px},${py}) falls in the gutter between hexes.`,
        };
      }
      if (ij.col < 0 || ij.row < 0 || ij.col >= tmj.width || ij.row >= tmj.height) {
        return {
          _tag: "err",
          message: `[error] tile-area object id=${obj.id} vertex ${vi} at pixel (${px},${py}) maps outside the map grid.`,
        };
      }
      let h3: string;
      try {
        h3 = localIjToCell(ctx.h3Anchor, { i: ij.col, j: ij.row });
      } catch {
        return {
          _tag: "err",
          message: `[error] tile-area object id=${obj.id} vertex ${vi} at pixel (${px},${py}) could not be projected to H3.`,
        };
      }
      vertexCells.push(h3);
    }

    let interior: Set<string>;
    try {
      interior = new Set(polygonToCells(latLngRing(vertexCells), 15));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        _tag: "err",
        message: `[error] tile-area object id=${obj.id} name=${obj.name ?? ""}: polygonToCells failed: ${detail}`,
      };
    }

    areas.push({
      id: obj.id,
      name: obj.name ?? "",
      typeLabel,
      vertexCells,
      interior,
    });
  }

  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i]!;
      const b = areas[j]!;
      let overlap = 0;
      const smaller = a.interior.size <= b.interior.size ? a.interior : b.interior;
      const other = a.interior.size <= b.interior.size ? b.interior : a.interior;
      for (const cell of smaller) {
        if (other.has(cell)) {
          overlap++;
        }
      }
      if (overlap > 0) {
        return {
          _tag: "err",
          message: `[error] tile-area overlap detected: object id=${a.id} and id=${b.id} share ${overlap} cell(s). Non-overlapping areas are required.`,
        };
      }
    }
  }

  return { _tag: "ok", areas };
}
