import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { gridDistance } from "h3-js";
import type { WorldTile } from "../types/worldTile.js";
import type { TileTypeStyles } from "../services/gramParser.js";

const VOID_TILE = "void" as const;

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function tileTypeColor(tileType: string, tileStyles?: TileTypeStyles): [number, number, number, number] {
  if (tileType === VOID_TILE) return [0, 0, 0, 0];
  const hex = tileStyles?.get(tileType);
  if (hex) return hexToRgba(hex, 200);
  let h = 0;
  for (let i = 0; i < tileType.length; i++) {
    h = (h * 31 + tileType.charCodeAt(i)) | 0;
  }
  const r = 40 + (h & 0x4f);
  const g = 80 + ((h >> 6) & 0x4f);
  const b = 120 + ((h >> 12) & 0x4f);
  return [r, g, b, 160];
}

function lineColor(tileType: string, tileStyles?: TileTypeStyles): [number, number, number, number] {
  if (tileType === VOID_TILE) return [100, 140, 200, 160];
  const [r, g, b] = tileTypeColor(tileType, tileStyles);
  return [Math.min(255, r + 60), Math.min(255, g + 60), Math.min(255, b + 80), 255];
}

/** "Freeplay"-like area: steel blue field, one red focus hex. */
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
 * Filled H3 layer for `WorldTile` data.
 *
 * - `extruded: true` — exterior stops (Global/Regional/Neighborhood). Renders 3-D prisms.
 * - `extruded: false` (default) — interior stops (Plan/Room/Situational). Flat tiles with strokes.
 */
export function createHexGridLayer(
  tiles: ReadonlyMap<string, WorldTile> | WorldTile[],
  options: {
    readonly pickable?: boolean;
    readonly id?: string;
    readonly opacity?: number;
    /** Exterior-stop mode: extruded 3-D prisms (FR-026). */
    readonly extruded?: boolean;
    /** Elevation in metres for extruded mode (FR-026). Default: 10. */
    readonly elevation?: number;
    /** When set, area-scale coloring (red focus cell, blueish peers). */
    readonly areaFocusH3?: string;
    /** Flat backdrop for world context — "faint" plate under room/situational. */
    readonly uniformBackdrop?: { r: number; g: number; b: number; a: number };
    /** Color map from gram style field; overrides hash-based fallback. */
    readonly tileStyles?: TileTypeStyles;
    /** Fade alpha to 0 approaching outerK; full opacity within innerK rings of focusH3. */
    readonly distanceFade?: { focusH3: string; innerK: number; outerK: number };
  } = {},
): H3HexagonLayer<WorldTile> {
  const data = Array.isArray(tiles) ? tiles : Array.from(tiles.values());
  const op = options.opacity ?? 1;
  const isExtruded = options.extruded ?? false;
  const elevation = options.elevation ?? 10;
  const areaFocusH3 = options.areaFocusH3;
  const backdrop = options.uniformBackdrop;
  const tileStyles = options.tileStyles;
  const fade = options.distanceFade;

  function fadeOpacity(h3: string): number {
    if (!fade) return 1;
    let dist = 0;
    try { dist = gridDistance(h3, fade.focusH3); } catch { dist = fade.outerK; }
    return Math.max(0, 1 - Math.max(0, dist - fade.innerK) / (fade.outerK - fade.innerK));
  }

  if (isExtruded) {
    return new H3HexagonLayer<WorldTile>({
      id: options.id ?? "hex-grid",
      data,
      pickable: options.pickable ?? true,
      highPrecision: true,
      coverage: 1,
      extruded: true,
      wireframe: true,
      lineWidthUnits: "pixels",
      getHexagon: (d) => d.h3Index,
      filled: true,
      elevationScale: 1,
      getElevation: () => elevation,
      getFillColor: (d) => {
        if (backdrop !== undefined) {
          return [backdrop.r, backdrop.g, backdrop.b, Math.floor(backdrop.a * 255 * op)] as [number, number, number, number];
        }
        if (areaFocusH3 !== undefined) {
          return areaPalette(d, op, areaFocusH3).fill;
        }
        const [r, g, b, a0] = tileTypeColor(d.tileType, tileStyles);
        return [r, g, b, Math.floor(a0 * op)] as [number, number, number, number];
      },
      getLineColor: () => [80, 120, 180, Math.floor(200 * op)] as [number, number, number, number],
    });
  }

  // Flat (interior) mode
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
      const fop = fadeOpacity(d.h3Index) * op;
      if (backdrop !== undefined) {
        return [backdrop.r, backdrop.g, backdrop.b, Math.floor(backdrop.a * 255 * fop)] as [number, number, number, number];
      }
      if (areaFocusH3 !== undefined) {
        const c = areaPalette(d, op, areaFocusH3).fill;
        return [c[0], c[1], c[2], Math.floor(c[3] * fadeOpacity(d.h3Index))] as [number, number, number, number];
      }
      const [r, g, b, a0] = tileTypeColor(d.tileType, tileStyles);
      return [r, g, b, Math.floor(a0 * fop)] as [number, number, number, number];
    },
    getLineColor: (d) => {
      const fop = fadeOpacity(d.h3Index) * op;
      if (backdrop !== undefined) {
        return [
          Math.min(255, backdrop.r + 40),
          Math.min(255, backdrop.g + 40),
          Math.min(255, backdrop.b + 50),
          Math.floor(200 * fop),
        ] as [number, number, number, number];
      }
      if (areaFocusH3 !== undefined) {
        const c = areaPalette(d, op, areaFocusH3).line;
        return [c[0], c[1], c[2], Math.floor(c[3] * fadeOpacity(d.h3Index))] as [number, number, number, number];
      }
      const [r, g, b, a0] = lineColor(d.tileType, tileStyles);
      return [r, g, b, Math.floor(a0 * fop)] as [number, number, number, number];
    },
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    lineWidthMinPixels: 1,
    updateTriggers: {
      getFillColor: fade?.focusH3,
      getLineColor: fade?.focusH3,
    },
  });
}

/** Wireframe H3 cells with no `WorldTile` (open stroke, no fill) — floor platter and void grid. */
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
    filled: true,
    stroked: true,
    getFillColor: [20, 25, 35, Math.floor(255 * 0.6)] as [number, number, number, number],
    getLineColor: [100, 140, 195, Math.floor(255 * opacity)] as [number, number, number, number],
    lineWidthUnits: "pixels",
    getLineWidth: 1.2,
    lineWidthMinPixels: 1,
  });
}
