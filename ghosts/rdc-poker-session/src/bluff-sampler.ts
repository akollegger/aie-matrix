/**
 * Bluff sampler — Eagle-tier-only.
 *
 * Before the LLM picks an action, samples whether this spot should
 * be a bluff according to:
 *   - persona.bluffFrequency      (how often this player bluffs at all)
 *   - estimated fold equity        (how often a bet here will fold villains)
 *   - position / street            (only bluff in spots where it makes sense)
 *
 * If sampling says BLUFF, the sampler returns a hint that forces a
 * raise even though the equity-vs-pot-odds rule said fold. This is
 * how a Lion (high bluffFrequency) actually attempts bluffs in
 * marginal spots instead of always folding to the math.
 *
 * Veteran and below do NOT sample — Eagle is the only tier that
 * explicitly models its own bluff frequency. Lower-tier ghosts may
 * still bluff via animal bias (Jackal's bluff escalation), but
 * without a sampler the frequency is implicit.
 *
 * Pure function. Seedable PRNG for tests. PR-portable.
 */

import type { GamePhase } from "@aie-matrix/ghost-rdc-poker";
import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { PokerAction } from "./school-rules.js";

export interface BluffSample {
  /** Did we choose to bluff this turn? */
  readonly bluff: boolean;
  /** Probability used for the sample (0..1) — for the prompt and the trace. */
  readonly probability: number;
  /** Action the sampler would force when bluff = true. */
  readonly forcedAction: PokerAction | null;
  /** Human-readable explanation line. */
  readonly reason: string;
}

export interface BluffRequest {
  readonly tier: SkillTier | undefined;
  readonly bluffFrequency: number; // persona param 0..1
  readonly equity: number;         // current hand equity 0..1
  readonly phase: GamePhase;
  /** Approximate fold equity 0..1 (rough table-shape signal). */
  readonly foldEquity: number;
  /** Whether `raise` is currently legal (post-tier-prune). */
  readonly canRaise: boolean;
  /** Seedable PRNG. */
  readonly rng?: () => number;
}

/**
 * Sample. The sampler is conservative — it requires:
 *   - tier = Eagle
 *   - phase is turn or river (no preflop / flop "barreling" yet)
 *   - equity < 50% (otherwise it's value, not bluff)
 *   - fold equity > 35% (no point bluffing into stations)
 *   - raise is legal
 *
 * When all gates pass, samples on persona.bluffFrequency. A Lion at
 * 30% bluffFrequency will fire roughly 1-in-3 qualifying spots.
 */
export function sampleBluff(req: BluffRequest): BluffSample {
  const rng = req.rng ?? Math.random;

  if (req.tier !== "Eagle") {
    return {
      bluff: false,
      probability: 0,
      forcedAction: null,
      reason: "Bluff sampler off (tier < Eagle).",
    };
  }
  if (!req.canRaise) {
    return {
      bluff: false,
      probability: 0,
      forcedAction: null,
      reason: "Bluff skipped: raise isn't legal.",
    };
  }
  if (req.phase !== "turn" && req.phase !== "river") {
    return {
      bluff: false,
      probability: 0,
      forcedAction: null,
      reason: "Bluff skipped: only turn/river bluffs in v1.",
    };
  }
  if (req.equity >= 0.5) {
    return {
      bluff: false,
      probability: 0,
      forcedAction: null,
      reason: "Bluff skipped: equity ≥ 50% is value, not bluff.",
    };
  }
  if (req.foldEquity < 0.35) {
    return {
      bluff: false,
      probability: 0,
      forcedAction: null,
      reason: "Bluff skipped: not enough fold equity.",
    };
  }

  // Effective probability = configured frequency scaled by fold equity.
  // A 30% bluff frequency with 70% fold equity → ~21% effective.
  const probability = clamp01(req.bluffFrequency * req.foldEquity);
  const roll = rng();
  const bluff = roll < probability;

  return {
    bluff,
    probability,
    forcedAction: bluff ? "raise" : null,
    reason: bluff
      ? `Bluff fires: rolled ${(roll * 100).toFixed(0)}% < ${(probability * 100).toFixed(0)}%.`
      : `Bluff declined: rolled ${(roll * 100).toFixed(0)}% ≥ ${(probability * 100).toFixed(0)}%.`,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
