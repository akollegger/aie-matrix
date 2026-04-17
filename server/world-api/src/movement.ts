import type { CellId, LoadedMap } from "@aie-matrix/server-colyseus";
import type { Compass, GoFailure, GoSuccess } from "@aie-matrix/shared-types";
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
