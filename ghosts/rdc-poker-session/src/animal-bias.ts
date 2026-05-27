/**
 * Animal temperament bias.
 *
 * Sits between the tier pruner and the LLM. Given the school's
 * recommendation and the LLM's animal type (Mouse/Lion/Jackal/
 * Elephant/Eagle), returns a *steering hint* — a preferred action
 * + a short reason. The LLM is still the action picker, but the
 * hint sits in the prompt as a temperament nudge.
 *
 * Why a hint and not a hard override: in spots where the menu is
 * NOT mechanically pruned (Greenhorn / Journeyman, or close spots
 * at Veteran+), the LLM has discretion. The animal bias is how
 * "same school, same equity, different temperament" produces
 * different play. A Lion sees borderline-call as "raise"; a Mouse
 * sees the same spot as "fold".
 *
 * Pure function. PR-portable.
 */

import type { AnimalType } from "./hellmuth-profile.js";
import type { PokerAction } from "./school-rules.js";

export interface AnimalSteer {
  /** The action the animal would lean toward, given the school rec. */
  readonly preferred: PokerAction;
  /** One-line explanation for the prompt. */
  readonly reason: string;
  /** Did the animal actually change the school's preference? */
  readonly diverged: boolean;
}

export interface AnimalSteerRequest {
  readonly animal: AnimalType | undefined;
  /** The school's preferred action this turn. */
  readonly schoolRecommendation: PokerAction;
  /**
   * Margin of equity over required equity (-1..+1). Used to determine
   * whether the animal's bias should fire at all — a Lion doesn't
   * blast off when the math is overwhelmingly bad, a Mouse doesn't
   * fold an obvious value spot just to be tight.
   */
  readonly equityMargin: number;
  /** Available actions after tier pruning — animal can't pick illegal. */
  readonly canRaise: boolean;
  readonly canCall: boolean;
  readonly canFold: boolean;
  readonly canCheck: boolean;
}

/**
 * Decide the animal's steer. Logic:
 *
 *   Lion (LAG)        : in marginal/borderline spots, lean to raise.
 *                       In coin-flips, escalate from call → raise.
 *   Jackal (Maniac)   : like Lion but stronger; even slightly -EV
 *                       spots can become raise/all-in (bluff energy).
 *   Mouse (TAG/Rock)  : in marginal spots, lean to fold. Won't
 *                       overcall on coin flips.
 *   Elephant (Station): never raises on hints; if school says raise
 *                       in a coin flip, downshift to call. Never folds
 *                       when calling is legal and equity isn't dire.
 *   Eagle             : no bias — adaptive, defers to school + reads.
 *   undefined         : no bias (legacy/unassigned).
 */
export function steerByAnimal(req: AnimalSteerRequest): AnimalSteer {
  const { animal, schoolRecommendation: rec, equityMargin: m } = req;

  if (!animal || animal === "eagle") {
    return {
      preferred: rec,
      reason: animal === "eagle"
        ? "Eagle: adaptive — follow the school's read."
        : "No animal bias.",
      diverged: false,
    };
  }

  const inMarginal = Math.abs(m) <= 0.1; // close spot
  const slightPlus = m > 0 && m <= 0.15;
  const slightMinus = m < 0 && m >= -0.1;

  switch (animal) {
    case "lion": {
      // In marginal-or-better spots, prefer raise. Won't escalate
      // crushed spots (margin very negative).
      if (req.canRaise && (rec === "call" || (rec === "check" && slightPlus))) {
        return {
          preferred: "raise",
          reason: "Lion: pressure on a playable spot.",
          diverged: true,
        };
      }
      return { preferred: rec, reason: "Lion: school rec already aggressive.", diverged: false };
    }
    case "jackal": {
      // Like Lion but will also bluff/escalate slightly -EV spots.
      if (req.canRaise && (rec === "call" || rec === "check" || (rec === "fold" && slightMinus))) {
        // The condition above already excludes rec === "raise", so this
        // branch always diverges from the school recommendation.
        return {
          preferred: "raise",
          reason: "Jackal: bluff-pressure even on close-loss spots.",
          diverged: true,
        };
      }
      return { preferred: rec, reason: "Jackal: school rec already aggressive.", diverged: false };
    }
    case "mouse": {
      // In coin flips, fold instead of call. Don't override clear value spots.
      if (rec === "call" && inMarginal && req.canFold) {
        return {
          preferred: "fold",
          reason: "Mouse: not paying off a coin flip.",
          diverged: true,
        };
      }
      // In free-check spots with no big edge, just check instead of raise.
      if (rec === "raise" && m < 0.2 && req.canCheck) {
        return {
          preferred: "check",
          reason: "Mouse: no need to put chips out with a marginal edge.",
          diverged: true,
        };
      }
      return { preferred: rec, reason: "Mouse: school rec is conservative enough.", diverged: false };
    }
    case "elephant": {
      // Never fold when calling is legal and equity isn't dire.
      if (rec === "fold" && req.canCall && m > -0.2) {
        return {
          preferred: "call",
          reason: "Elephant: calls light, doesn't fold to pressure.",
          diverged: true,
        };
      }
      // Downshift raises to calls in marginal spots.
      if (rec === "raise" && inMarginal && req.canCall) {
        return {
          preferred: "call",
          reason: "Elephant: calls instead of putting chips at risk.",
          diverged: true,
        };
      }
      return { preferred: rec, reason: "Elephant: school rec acceptable.", diverged: false };
    }
  }
}
