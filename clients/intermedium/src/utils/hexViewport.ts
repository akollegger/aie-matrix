import { fitBounds } from "@math.gl/web-mercator";
import { type H3IndexInput, cellToLatLng, getHexagonEdgeLengthAvg, getResolution, isValidCell } from "h3-js";
import type { WorldTile } from "../types/worldTile.js";

/**
 * “Cells per viewport” targets (shorter of width/height). Tuned for res-15 gameplay cells.
 * (matrix-editor in another repo: keep constants here and document parity when known.)
 */
export const AREA_CPV = 7;
export const NEIGHBOR_CPV = 4;
export const MAP_VS_AREA_CPV = 2;
const MAP_CPV_MAX = 140;
const MAP_CPV_MIN = 28;

const EARTH_CIRCUMFERENCE_M = 40_075_016.68;

/**
 * @deck.gl Web Mercator: meters per pixel on the local parallel at `latitude` (y axis).
 * Uses a 512px world scale consistent with @math.gl/web-mercator / deck 9.
 */
function metersPerPixelY(latitude: number, zoom: number): number {
  const c = Math.cos((latitude * Math.PI) / 180);
  return (EARTH_CIRCUMFERENCE_M * c) / (512 * 2 ** zoom);
}

/**
 * Binary search zoom so the shorter viewport edge shows roughly `targetCpv` cells (flat estimate).
 */
export function zoomForCellsAcrossShortEdge(
  h3Index: H3IndexInput,
  targetCpv: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): number {
  if (targetCpv < 0.5 || !isValidCell(h3Index)) {
    return 12;
  }
  const r = getResolution(h3Index);
  const cellWidthM = getHexagonEdgeLengthAvg(r, "m") * 1.63299;
  const lat = cellToLatLng(h3Index)[0];
  const minPx = Math.max(64, Math.min(viewportWidthPx, viewportHeightPx));

  let lo = 0;
  let hi = 22;
  for (let i = 0; i < 28; i++) {
    const z = (lo + hi) / 2;
    const mpp = metersPerPixelY(lat, z);
    const cellsEst = (minPx * mpp) / cellWidthM;
    if (cellsEst > targetCpv) {
      lo = z;
    } else {
      hi = z;
    }
  }
  return Math.max(0, Math.min(22, (lo + hi) / 2));
}

export function tileBoundingLonLat(
  tiles: ReadonlyMap<string, WorldTile>,
  padDeg = 0.0001,
): [[number, number], [number, number]] | null {
  if (tiles.size === 0) {
    return null;
  }
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const t of tiles.values()) {
    const [la, lo] = cellToLatLng(t.h3Index);
    minLng = Math.min(minLng, lo);
    maxLng = Math.max(maxLng, lo);
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
  }
  return [
    [minLng - padDeg, minLat - padDeg],
    [maxLng + padDeg, maxLat + padDeg],
  ] as const;
}

export type MapViewport = {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
};

/**
 * “Map” scale: fit full tile set in the window, then clamp zoom to CPV bounds; map is always
 * at least `MAP_VS_AREA_CPV ×` as wide in cell count as the area scale (approximate).
 */
export function mapViewFromTileBounds(
  tiles: ReadonlyMap<string, WorldTile>,
  widthPx: number,
  heightPx: number,
): MapViewport | null {
  const b = tileBoundingLonLat(tiles, 0.000008);
  if (b === null) {
    return null;
  }
  const w = Math.max(64, widthPx);
  const h = Math.max(64, heightPx);
  const fit = fitBounds({ width: w, height: h, bounds: b, padding: 20, maxZoom: 24 });
  const f = tiles.values().next();
  const sampleH3 = f.done ? null : f.value.h3Index;
  if (!sampleH3) {
    return fit;
  }
  const areaCpv = AREA_CPV;
  const mapCpvMin = Math.max(MAP_CPV_MIN, Math.ceil(MAP_VS_AREA_CPV * areaCpv));
  const zFromMinCpv = zoomForCellsAcrossShortEdge(sampleH3, mapCpvMin, w, h);
  const zFromMaxCpv = zoomForCellsAcrossShortEdge(sampleH3, MAP_CPV_MAX, w, h);
  const zLo = Math.min(zFromMinCpv, zFromMaxCpv);
  const zHi = Math.max(zFromMinCpv, zFromMaxCpv);
  const z = Math.min(Math.max(fit.zoom, zLo), zHi);
  return { longitude: fit.longitude, latitude: fit.latitude, zoom: z };
}

/**
 * “Area” scale: fixed CPV on the focused H3, overhead.
 */
export function areaViewFromFocus(
  focusH3: string,
  widthPx: number,
  heightPx: number,
): MapViewport {
  const [la, lo] = cellToLatLng(focusH3);
  return {
    longitude: lo,
    latitude: la,
    zoom: zoomForCellsAcrossShortEdge(focusH3, AREA_CPV, widthPx, heightPx),
  };
}

/**
 * “Neighbor” scale: tighter fixed CPV on the ghost’s cell.
 */
export function neighborView(
  h3: string,
  widthPx: number,
  heightPx: number,
): MapViewport {
  const [la, lo] = cellToLatLng(h3);
  return {
    longitude: lo,
    latitude: la,
    zoom: zoomForCellsAcrossShortEdge(h3, NEIGHBOR_CPV, widthPx, heightPx),
  };
}

/**
 * H3 indices in `tiles` or referenced as a neighbor, minus covered tiles: implied void cells for a wire frame.
 */
export function voidNeighborH3s(tiles: ReadonlyMap<string, WorldTile>): string[] {
  const seen = new Set<string>();
  for (const t of tiles.values()) {
    seen.add(t.h3Index);
  }
  const out: string[] = [];
  for (const t of tiles.values()) {
    for (const n of t.neighbors) {
      if (!isValidCell(n) || seen.has(n)) {
        continue;
      }
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
