import type { Compass, ItemDefinition } from "@aie-matrix/shared-types";

/**
 * Canonical cell id for APIs: H3 res-15 index from the map loader.
 * Plain `string` so test maps may use simpler keys.
 */
export type CellId = string;

/** @deprecated Legacy helper for unit tests — production maps use H3 indices as keys. */
export function makeCellId(col: number, row: number): CellId {
  return `${col},${row}`;
}

export interface CellRecord {
  col: number;
  row: number;
  /** H3 res-15 index — canonical identity; matches the key in {@link LoadedMap.cells}. */
  h3Index: string;
  tileClass: string;
  /** Neighbor cell ids (H3 index strings) reachable via each compass face. */
  neighbors: Partial<Record<Compass, CellId>>;
  /** Tile capacity (from tileset `capacity` property). Absent = unbounded. */
  capacity?: number;
  /** itemRefs declared via tile-class `items` property + `item-placement` layer. */
  initialItemRefs: string[];
}

export interface LoadedMap {
  width: number;
  height: number;
  /** H3 index of Tiled cell (col=0, row=0); used to derive all cell indices. */
  anchorH3: string;
  /** Populated navigable cells only (gid != 0), keyed by `h3Index`. */
  cells: Map<CellId, CellRecord>;
  /** Item definitions keyed by itemRef. Empty map when no sidecar present. */
  itemSidecar: Map<string, ItemDefinition>;
}
