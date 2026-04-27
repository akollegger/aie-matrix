import { fitBounds } from "@math.gl/web-mercator";
import {
  type H3IndexInput,
  cellToLatLng,
  latLngToCell,
  getHexagonEdgeLengthAvg,
  getResolution,
  isValidCell,
  gridDisk,
} from "h3-js";
import type { CameraStop } from "../types/viewState.js";
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
 * Camera pitch (deck.gl degrees) per stop (FR-027).
 * Personal stop is R3F and does not use this value.
 */
export const STOP_PITCH: Readonly<Record<CameraStop, number>> = {
  global: 0,
  regional: 0,
  neighborhood: 45,
  plan: 0,
  room: 0,
  situational: 45,
  personal: 80, // reference only; Personal stop uses R3F, not deck.gl
};

/**
 * “Global” stop: board visible as a tiny landmark; zoom fixed to show ~earth scale.
 * Center on the board's geographic centroid (FR-026).
 */
export function globalView(
  tiles: ReadonlyMap<string, WorldTile>,
): MapViewport {
  const center = tileCentroid(tiles);
  return { longitude: center[1], latitude: center[0], zoom: 2 };
}

/**
 * “Regional” stop: board visible as a small rectangle; zoom targets R4–R5 cell scale
 * so surrounding context cells are legible (FR-026).
 */
export function regionalView(
  tiles: ReadonlyMap<string, WorldTile>,
): MapViewport {
  const center = tileCentroid(tiles);
  return { longitude: center[1], latitude: center[0], zoom: 7 };
}

/** Mean lat/lng of all tile centroids. Falls back to (0,0) for empty maps. */
function tileCentroid(tiles: ReadonlyMap<string, WorldTile>): [number, number] {
  if (tiles.size === 0) return [0, 0];
  let sumLat = 0;
  let sumLng = 0;
  for (const t of tiles.values()) {
    const [la, lo] = cellToLatLng(t.h3Index);
    sumLat += la;
    sumLng += lo;
  }
  return [sumLat / tiles.size, sumLng / tiles.size];
}

/**
 * “Plan” stop (was “Map” scale): fit full tile set in the window, then clamp zoom to CPV
 * bounds; plan is always at least `MAP_VS_AREA_CPV ×` as wide in cell count as Room.
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
  const fit = fitBounds({
    width: w,
    height: h,
    bounds: b,
    padding: 20,
    maxZoom: 24,
  });
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
 * “Room” stop (was “Area” scale): fixed CPV on the focused H3, overhead.
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
 * “Situational” stop (was “Neighbor” scale): tighter fixed CPV on the ghost’s cell.
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
 * Floor platter cells: a disk centred on the map's geographic centroid, excluding
 * the tiles already in the map. Radius = estimated map radius + 3 rings of margin.
 * Used as the wireframe ground plane for exterior and plan stops (FR-026).
 */
export function voidNeighborH3s(tiles: ReadonlyMap<string, WorldTile>): string[] {
  if (tiles.size === 0) return [];

  const [lat, lng] = tileCentroid(tiles);
  const centerH3 = latLngToCell(lat, lng, 15);
  if (!isValidCell(centerH3)) return [];

  // Estimated radius in H3 steps from a circle of area = tiles.size cells.
  const mapRadius = Math.ceil(Math.sqrt(tiles.size / Math.PI));
  const platterRadius = mapRadius + 3;

  const tileSet = new Set(tiles.keys());
  return gridDisk(centerH3, platterRadius).filter((h) => !tileSet.has(h));
}
