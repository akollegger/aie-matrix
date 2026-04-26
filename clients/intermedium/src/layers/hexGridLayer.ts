import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { WorldTile } from "../types/worldTile.js";

const VOID_TILE = "void" as const;

function tileTypeColor(tileType: string): [number, number, number, number] {
  if (tileType === VOID_TILE) {
    return [0, 0, 0, 0] as [number, number, number, number];
  }
  let h = 0;
  for (let i = 0; i < tileType.length; i++) {
    h = (h * 31 + tileType.charCodeAt(i)) | 0;
  }
  const r = 40 + (h & 0x4f);
  const g = 80 + ((h >> 6) & 0x4f);
  const b = 120 + ((h >> 12) & 0x4f);
  return [r, g, b, 160];
}

function lineColor(tileType: string): [number, number, number, number] {
  if (tileType === VOID_TILE) {
    return [100, 140, 200, 160] as [number, number, number, number];
  }
  const [r, g, b, _] = tileTypeColor(tileType);
  return [Math.min(255, r + 60), Math.min(255, g + 60), Math.min(255, b + 80), 255];
}

/** “Freeplay”-like area: steel blue field, one red focus hex (matrix-editor-style emphasis). */
function areaPalette(
  d: WorldTile,
  op: number,
  areaFocusH3: string,
): { fill: [number, number, number, number]; line: [number, number, number, number] } {
  if (d.h3Index === areaFocusH3) {
    return {
      fill: [200, 55, 60, Math.floor(245 * op)] as [number, number, number, number],
      line: [255, 200, 200, Math.floor(255 * op)] as [number, number, number, number],
    };
  }
  return {
    fill: [60, 95, 150, Math.floor(210 * op)] as [number, number, number, number],
    line: [110, 150, 200, Math.floor(255 * op)] as [number, number, number, number],
  };
}

/**
 * Filled H3 layer for `WorldTile` data. `areaFocusH3` forces area-scale palette (blue field + red focus).
 */
export function createHexGridLayer(
  tiles: ReadonlyMap<string, WorldTile> | WorldTile[],
  options: {
    readonly pickable?: boolean;
    readonly id?: string;
    readonly opacity?: number;
    /** When set, area-scale coloring (red focus cell, blueish peers). */
    readonly areaFocusH3?: string;
    /** Flat backdrop for world context (no per-tile hash) — “faint” plate under area/neighbor. */
    readonly uniformBackdrop?: { r: number; g: number; b: number; a: number };
  } = {},
): H3HexagonLayer<WorldTile> {
  const data = Array.isArray(tiles) ? tiles : Array.from(tiles.values());
  const op = options.opacity ?? 1;
  const areaFocusH3 = options.areaFocusH3;
  const backdrop = options.uniformBackdrop;
  return new H3HexagonLayer<WorldTile>({
    id: options.id ?? "hex-grid",
    data,
    pickable: options.pickable ?? true,
    highPrecision: true,
    coverage: 1,
    extruded: false,
    getHexagon: (d) => d.h3Index,
    stroked: true,
    filled: true,
    getFillColor: (d) => {
      if (backdrop !== undefined) {
        return [
          backdrop.r,
          backdrop.g,
          backdrop.b,
          Math.floor(backdrop.a * 255 * op),
        ] as [number, number, number, number];
      }
      if (areaFocusH3 !== undefined) {
        return areaPalette(d, op, areaFocusH3).fill;
      }
      const [r, g, b, a0] = tileTypeColor(d.tileType);
      return [r, g, b, Math.floor(a0 * op)] as [number, number, number, number];
    },
    getLineColor: (d) => {
      if (backdrop !== undefined) {
        return [
          Math.min(255, backdrop.r + 40),
          Math.min(255, backdrop.g + 40),
          Math.min(255, backdrop.b + 50),
          Math.floor(200 * op),
        ] as [number, number, number, number];
      }
      if (areaFocusH3 !== undefined) {
        return areaPalette(d, op, areaFocusH3).line;
      }
      const [r, g, b, a0] = lineColor(d.tileType);
      return [r, g, b, Math.floor(a0 * op)] as [number, number, number, number];
    },
    getLineWidth: 1,
    lineWidthMinPixels: 1,
  });
}

/** Wireframe H3 cells with no `WorldTile` (open stroke, no fill) — e.g. implied grid in “map” scale. */
export function createH3WireframeLayer(
  h3List: readonly string[],
  id: string,
  pickable = false,
  opacity = 0.5,
): H3HexagonLayer<WorldTile> {
  const data: WorldTile[] = h3List.map((h3) => {
    const empty: readonly string[] = Object.freeze([] as string[]);
    return {
      h3Index: h3,
      tileType: VOID_TILE,
      items: empty,
      neighbors: empty,
    } satisfies WorldTile;
  });
  return new H3HexagonLayer<WorldTile>({
    id,
    data,
    pickable,
    highPrecision: true,
    coverage: 1,
    extruded: false,
    getHexagon: (d) => d.h3Index,
    filled: false,
    stroked: true,
    getLineColor: [100, 140, 195, Math.floor(255 * opacity)] as [number, number, number, number],
    getLineWidth: 1.2,
    lineWidthMinPixels: 1,
  });
}
