import { cellToLatLng, polygonToCells } from "h3-js";
import type { MapContext } from "./map-context.js";
import type { TmjDocument, TmjLayer, TmjObject } from "./parse-tmj.js";
import type { TilesetSlice } from "./parse-tsx.js";
import { hexRenderParams, makeTileToH3, resolvePixelToColRow } from "./tiled-hex-grid.js";

const TILE_AREA_CLASS = "tile-area";

export interface TileAreaPolygon {
  readonly id: number;
  readonly name: string;
  readonly typeLabel: string;
  readonly vertexCells: readonly string[];
  /** Strict `polygonToCells` fill — used for cross-area overlap checks only. */
  readonly interior: ReadonlySet<string>;
  /** `interior` plus every vertex hex: where matching layout paint is implied by the polygon shape (no redundant `cell-*`). */
  readonly layoutShapeHexes: ReadonlySet<string>;
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
 * Polygon vertex list: comma-separated **identifiers** that must be defined as tile-instance subjects
 * elsewhere in the document (typically `cell-<h3>` or `poly-<areaId>-v<i>` stubs when layout does not emit that hex).
 */
export function formatPolygonGramLine(area: TileAreaPolygon, vertexIdentifiers: readonly string[]): string {
  return `[poly-${area.id}:Polygon:${area.typeLabel} | ${vertexIdentifiers.join(", ")}]`;
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
  const tileToH3 = makeTileToH3(p, ctx.h3Anchor, tmj.width, tmj.height);

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
      const h3 = tileToH3(ij.col, ij.row);
      if (h3 === null) {
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

    const layoutShapeHexes = new Set<string>(interior);
    for (const h of vertexCells) {
      layoutShapeHexes.add(h);
    }

    areas.push({
      id: obj.id,
      name: obj.name ?? "",
      typeLabel,
      vertexCells,
      interior,
      layoutShapeHexes,
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
