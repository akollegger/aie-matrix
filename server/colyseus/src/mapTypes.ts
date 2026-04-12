import type { Compass } from "@aie-matrix/shared-types";

/** Stable cell id for APIs (`col,row` in map space). */
export type CellId = `${number},${number}`;

export function makeCellId(col: number, row: number): CellId {
  return `${col},${row}`;
}

export interface CellRecord {
  col: number;
  row: number;
  tileClass: string;
  /** Neighbor cell id reachable via each compass face (omitted = void / off-map). */
  neighbors: Partial<Record<Compass, CellId>>;
}

export interface LoadedMap {
  width: number;
  height: number;
  /** Populated navigable cells only (gid != 0). */
  cells: Map<CellId, CellRecord>;
}
