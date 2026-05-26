/**
 * Tier-gated action-menu pruner.
 *
 * Takes the raw legal AvailableActions, a SchoolDecision, and a
 * SkillTier — returns the AvailableActions that should actually be
 * offered to the LLM brain.
 *
 *   Greenhorn  : no pruning. School block is NOT shown (handled at
 *                the prompt-builder layer, not here). LLM picks
 *                freely from the legal menu. Plays on vibes.
 *
 *   Journeyman : no pruning. School block IS shown as advice. LLM
 *                picks freely; may follow the advice or not.
 *
 *   Veteran    : MECHANICAL PRUNE. Any action in `forbidden` is
 *                stripped from AvailableActions before the LLM sees
 *                it. The LLM can no longer make a clearly -EV call
 *                or fold a clearly +EV spot.
 *
 *   Eagle      : MECHANICAL PRUNE (same as Veteran). Equity narrowing
 *                and bluff sampling happen upstream in the brain
 *                builder, not here.
 *
 * Pure function. No Effect, no LLM. PR-portable.
 */

import type { AvailableActions } from "@aie-matrix/ghost-rdc-poker";
import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { PokerAction, SchoolDecision } from "./school-rules.js";

export interface PrunedActions {
  /** What the LLM should be shown — never empty (we always leave a fallback). */
  readonly actions: AvailableActions;
  /** Actions actually removed by the pruner this turn (for logs/overlay). */
  readonly removed: ReadonlyArray<PokerAction>;
  /** Did the tier rule actually engage? */
  readonly pruned: boolean;
}

/**
 * Apply the tier rule to the school's verdict.
 *
 * Safety: pruning never removes EVERY action. If the school forbids
 * the entire legal set (a bug or a degenerate spot), we fall back to
 * the original AvailableActions and flag it. The brain can still
 * pick something legal — no deadlock.
 *
 * Safety 2: if `forbidden` is empty, no work — return as-is so the
 * caller doesn't have to remember to check.
 */
export function pruneByTier(
  available: AvailableActions,
  decision: SchoolDecision,
  tier: SkillTier | undefined,
): PrunedActions {
  // Greenhorn + Journeyman never prune; school is advisory only.
  if (tier === "Greenhorn" || tier === "Journeyman" || tier === undefined) {
    return { actions: available, removed: [], pruned: false };
  }
  if (decision.forbidden.size === 0) {
    return { actions: available, removed: [], pruned: false };
  }

  const candidate: AvailableActions = {
    canFold: available.canFold && !decision.forbidden.has("fold"),
    canCheck: available.canCheck && !decision.forbidden.has("check"),
    canCall: available.canCall && !decision.forbidden.has("call"),
    canRaise: available.canRaise && !decision.forbidden.has("raise"),
    canAllIn: available.canAllIn && !decision.forbidden.has("all-in"),
    callAmount: available.callAmount,
    minRaise: available.minRaise,
    maxRaise: available.maxRaise,
    allInAmount: available.allInAmount,
  };

  const remaining = countLegal(candidate);
  if (remaining === 0) {
    // Degenerate: school forbade everything. Fall back so the game
    // can progress. Surface the situation in `removed = []` + `pruned: false`
    // so callers know nothing actually changed.
    return { actions: available, removed: [], pruned: false };
  }

  const removed = diffRemoved(available, candidate);
  return { actions: candidate, removed, pruned: removed.length > 0 };
}

function countLegal(a: AvailableActions): number {
  let n = 0;
  if (a.canFold) n++;
  if (a.canCheck) n++;
  if (a.canCall) n++;
  if (a.canRaise) n++;
  if (a.canAllIn) n++;
  return n;
}

function diffRemoved(
  before: AvailableActions,
  after: AvailableActions,
): PokerAction[] {
  const out: PokerAction[] = [];
  if (before.canFold && !after.canFold) out.push("fold");
  if (before.canCheck && !after.canCheck) out.push("check");
  if (before.canCall && !after.canCall) out.push("call");
  if (before.canRaise && !after.canRaise) out.push("raise");
  if (before.canAllIn && !after.canAllIn) out.push("all-in");
  return out;
}
