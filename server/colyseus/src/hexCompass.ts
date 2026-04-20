import type { Compass } from "@aie-matrix/shared-types";
import { COMPASS_DIRECTIONS } from "@aie-matrix/shared-types";
import { cellToLatLng, gridDisk } from "h3-js";

/**
 * Odd-q offset layout (flat-top, column stagger) — matches Tiled `staggeraxis: x`
 * for the sandbox map. Axial (q,r) with q = column.
 */
export function oddqOffsetToAxial(col: number, row: number): { q: number; r: number } {
  return { q: col, r: row - (col - (col & 1)) / 2 };
}

export function axialToOddqOffset(q: number, r: number): { col: number; row: number } {
  return { col: q, row: r + (q - (q & 1)) / 2 };
}

/** Axial neighbor deltas for the six compass labels (see server/world-api/README.md). */
export const COMPASS_AXIAL_DELTA: Record<
  Compass,
  { dq: number; dr: number }
> = {
  ne: { dq: 1, dr: 0 },
  n: { dq: 1, dr: -1 },
  nw: { dq: 0, dr: -1 },
  sw: { dq: -1, dr: 0 },
  s: { dq: -1, dr: 1 },
  se: { dq: 0, dr: 1 },
};

export function neighborOddq(
  col: number,
  row: number,
  compass: Compass,
): { col: number; row: number } {
  const { q, r } = oddqOffsetToAxial(col, row);
  const d = COMPASS_AXIAL_DELTA[compass];
  return axialToOddqOffset(q + d.dq, r + d.dr);
}

/** Clockwise from north: n, ne, se, s, sw, nw — centers at 0°, 60°, … */
const SECTOR_COMPASS: Compass[] = ["n", "ne", "se", "s", "sw", "nw"];

function bearingDegrees(lat0: number, lng0: number, lat1: number, lng1: number): number {
  const φ1 = (lat0 * Math.PI) / 180;
  const φ2 = (lat1 * Math.PI) / 180;
  const Δλ = ((lng1 - lng0) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  deg = (deg + 360) % 360;
  return deg;
}

function angularDistanceToSectorCenter(deg: number, sectorIdx: number): number {
  const center = (sectorIdx * 60) % 360;
  const d = Math.abs(deg - center);
  return Math.min(d, 360 - d);
}

/**
 * For an H3 cell, map each topological neighbor (from `gridDisk` ring 1) to the nearest
 * 60° compass sector using geographic bearing between cell centers.
 */
export function assignCompassToNeighbors(cell: string): Partial<Record<Compass, string>> {
  const origin = cellToLatLng(cell);
  const ring = gridDisk(cell, 1);
  const best = new Map<Compass, { h3: string; dist: number }>();

  for (const nh3 of ring) {
    if (nh3 === cell) {
      continue;
    }
    const dest = cellToLatLng(nh3);
    const bearing = bearingDegrees(origin[0], origin[1], dest[0], dest[1]);
    const sectorIdx = Math.floor(((bearing + 30) % 360) / 60) % 6;
    const compass = SECTOR_COMPASS[sectorIdx]!;
    const dist = angularDistanceToSectorCenter(bearing, sectorIdx);
    const cur = best.get(compass);
    if (!cur || dist < cur.dist) {
      best.set(compass, { h3: nh3, dist });
    }
  }

  const out: Partial<Record<Compass, string>> = {};
  for (const dir of COMPASS_DIRECTIONS) {
    const b = best.get(dir);
    if (b) {
      out[dir] = b.h3;
    }
  }
  return out;
}
