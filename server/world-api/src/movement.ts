import type { CellId, LoadedMap } from "@aie-matrix/server-colyseus";
import type { Compass, GoFailure, GoSuccess, TraverseFailure, TraverseSuccess } from "@aie-matrix/shared-types";
import { goStepPermittedByRules } from "./rules/match-go.js";
import type { ParsedRuleset } from "./rules/movement-rules-service.js";
import { tileLabelsFromClass } from "./rules/tile-labels.js";

export interface GhostMoveContext {
  /** Labels or roles used by `ghostClass` constraints on `GO` edges; may be empty. */
  readonly ghostLabels: ReadonlySet<string>;
}

export function resolveNeighbor(
  map: LoadedMap,
  fromCell: CellId,
  toward: Compass,
): CellId | undefined {
  const cell = map.cells.get(fromCell);
  return cell?.neighbors[toward];
}

/**
 * Evaluate an adjacent `go` step: geometry first, then rules (allow-list when authored).
 */
export function evaluateGo(
  map: LoadedMap,
  fromCell: CellId,
  toward: Compass,
  rules: ParsedRuleset,
  ghostContext: GhostMoveContext = { ghostLabels: new Set() },
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

  if (rules.mode === "permissive") {
    return { ok: true, tileId: dest };
  }

  const originLabels = tileLabelsFromClass(cell.tileClass);
  const destLabels = tileLabelsFromClass(destRecord.tileClass);
  const permitted = goStepPermittedByRules(rules.ruleGraph, originLabels, destLabels, toward, ghostContext.ghostLabels);
  if (!permitted) {
    return {
      ok: false,
      reason: "Movement blocked by world ruleset",
      code: "RULESET_DENY",
    };
  }
  return { ok: true, tileId: dest };
}

export type TraverseTargetLookup = (fromH3: string, via: string) => Promise<string | undefined>;

/**
 * Non-adjacent traversal (elevators / portals) backed by Neo4j `ELEVATOR` and `PORTAL` edges (IC-007).
 */
export async function evaluateTraverse(
  map: LoadedMap,
  fromH3: CellId,
  via: string,
  lookup: TraverseTargetLookup | undefined,
): Promise<TraverseSuccess | TraverseFailure> {
  const trimmedVia = via.trim();
  if (trimmedVia === "") {
    return { ok: false, code: "NO_EXIT", reason: "Exit name is empty" };
  }
  const fromCell = map.cells.get(fromH3);
  if (!fromCell) {
    return { ok: false, code: "UNKNOWN_CELL", reason: "Ghost is not on a known map cell" };
  }
  if (!lookup) {
    return { ok: false, code: "NO_EXIT", reason: "Non-adjacent exits are not available (Neo4j not configured)" };
  }
  const to = await lookup(fromH3, trimmedVia);
  if (!to) {
    return { ok: false, code: "NO_EXIT", reason: `No non-adjacent exit named ${trimmedVia}` };
  }
  const dest = map.cells.get(to);
  const tileClass = dest?.tileClass ?? "Portal";
  return { ok: true, via: trimmedVia, from: fromH3, to, tileClass };
}

