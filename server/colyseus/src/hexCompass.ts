import type { Compass } from "@aie-matrix/shared-types";

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
