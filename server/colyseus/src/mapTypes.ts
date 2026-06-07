import type { Compass } from "@aie-matrix/shared-types";
import type { ItemTypeDef, ParsedItemPlacement, ParsedPortal, SpawnGrant } from "@aie-matrix/map-gram";

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
  /** itemRefs from tile layer(s) with Tiled class `item-placement` (tile `type` = itemRef); runtime may hold multiple. */
  initialItemRefs: string[];
}

export interface LoadedMap {
  width: number;
  height: number;
  /** H3 index of the map origin cell. */
  anchorH3: string;
  /** Populated navigable cells only, keyed by `h3Index`. */
  cells: Map<CellId, CellRecord>;
  /** Item definitions keyed by itemRef / ItemType typeName. */
  itemSidecar: Map<string, ItemTypeDef>;
  /** Non-adjacent traversal links. Populated from gram Portal elements. */
  portals?: ParsedPortal[];
  /** Raw item placements from the map, used to derive ItemSeed[] for ledger.init(). */
  itemPlacements?: ParsedItemPlacement[];
  /** Spawn grants keyed by role, used at ghost first-connect. */
  spawnGrants?: SpawnGrant[];
}
