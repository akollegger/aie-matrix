import type { CellId, LoadedMap } from "@aie-matrix/server-colyseus";
import type { Compass, GoFailure, GoSuccess } from "@aie-matrix/shared-types";

/**
 * PoC movement ruleset: permissive no-op over class pairs (RFC-0001).
 * Capacity / occupancy are intentionally not enforced here.
 */
export function rulesetAllowsMove(
  _fromClass: string,
  _toClass: string,
): boolean {
  return true;
}

export function resolveNeighbor(
  map: LoadedMap,
  fromCell: CellId,
  toward: Compass,
): CellId | undefined {
  const cell = map.cells.get(fromCell);
  return cell?.neighbors[toward];
}

export function evaluateGo(
  map: LoadedMap,
  fromCell: CellId,
  toward: Compass,
): GoSuccess | GoFailure {
  const cell = map.cells.get(fromCell);
  if (!cell) {
    return { ok: false, reason: "Ghost is not on a known map cell", code: "UNKNOWN_CELL" };
  }
  const dest = resolveNeighbor(map, fromCell, toward);
  if (!dest) {
    return { ok: false, reason: "No traversable neighbor in that direction", code: "NO_NEIGHBOR" };
  }
  const destRecord = map.cells.get(dest);
  if (!destRecord) {
    return { ok: false, reason: "Neighbor cell missing from map graph", code: "MAP_INTEGRITY" };
  }
  if (!rulesetAllowsMove(cell.tileClass, destRecord.tileClass)) {
    return { ok: false, reason: "Movement blocked by world ruleset", code: "RULESET_DENY" };
  }
  return { ok: true, tileId: dest };
}
