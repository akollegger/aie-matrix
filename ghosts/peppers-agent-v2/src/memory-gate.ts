/**
 * Substrate gate on memory recall.
 *
 * Step 4 of the v2 surgical roadmap. Memory is not a flat pull-from-store —
 * what the ghost can actually reach is shaped by its current cognitive
 * state. The principle is mechanical: prompts never see "you are tired",
 * they see (a) a *truncated* result set the substrate decided was
 * reachable, and (b) a felt-vocabulary *fog* string describing how the
 * unreachable part feels from the inside.
 *
 * Current rules (extend as new needs / pathologies wire in):
 *   - Fuel low (depleted)    → recency horizon shrinks; older items drop
 *                              off first. Fog: sluggish thoughts.
 *   - Fuel critical          → only the very recent is reachable.
 *   - Rest low (depleted)    → some moments slip; depth reduced by 1.
 *   - Rest critical          → episodic blackout; nothing reachable.
 *   - Coherence (rate is 0 today; placeholder for cross-reference
 *     blocking when that mechanic comes online).
 *
 * The gate computes an EFFECTIVE depth at the call site, then the caller
 * slices the result. We do NOT muck with the memory store itself — the
 * substrate decides what's reachable; the store still has everything.
 *
 * Numbers stop at this boundary too (per `feedback_dont_strap_llm_to_calculator`).
 * The Surface gets the truncated result + the fog string; no
 * "fuel=2.1" raw numbers in the prompt.
 */

import type { NeedProfile } from "@aie-matrix/ghost-peppers-inner";

/**
 * Felt-vocabulary description of how unreachable memory feels.
 * Multiple causes (Fuel + Rest both low) get joined by "; ".
 */
export type MemoryFog = string;

export interface GatedDepth {
  /** The depth the caller should actually slice the result to. */
  readonly effective: number;
  /** Felt phrase describing why the horizon shrank, or null if it didn't. */
  readonly fog: MemoryFog | null;
}

/** Below this Fuel display value, the recency horizon starts shrinking. */
const FUEL_SLUGGISH = 3;
/** Below this Fuel display value, only the very recent is reachable. */
const FUEL_CRITICAL = 1.5;
/** Below this Rest display value, the substrate drops one memory item. */
const REST_FRAYED = 2;
/** Below this Rest display value, the recent past is unreachable. */
const REST_BLACKOUT = 1;

/**
 * Gate a depth-based fetch (recent cascades, recent dialogue depth,
 * recent action digest depth). Returns the effective depth the caller
 * should ACTUALLY request / slice, plus an optional fog phrase.
 *
 * Severity stacks. Fuel and Rest can both contribute fog; we return
 * the joined string. Effective depth takes the minimum across rules.
 */
export function gateRecencyDepth(
  needs: NeedProfile,
  requested: number,
): GatedDepth {
  if (requested <= 0) return { effective: 0, fog: null };
  const fuel = needs.Fuel.display;
  const rest = needs.Rest.display;

  let effective = requested;
  const fogParts: string[] = [];

  // Rest blackout dominates everything else — exhaustion eats memory wholesale.
  if (rest < REST_BLACKOUT) {
    return {
      effective: 0,
      fog: "you've been awake too long — the recent past feels hazy, just out of reach",
    };
  }

  if (fuel < FUEL_CRITICAL) {
    effective = Math.min(effective, 1);
    fogParts.push(
      "you can barely think past this moment — earlier impressions slip away",
    );
  } else if (fuel < FUEL_SLUGGISH) {
    // Shrink horizon proportionally to how depleted fuel is.
    // At fuel = FUEL_SLUGGISH (3) → full requested; at fuel = FUEL_CRITICAL (1.5) → half.
    const ratio = (fuel - FUEL_CRITICAL) / (FUEL_SLUGGISH - FUEL_CRITICAL);
    const shrunk = Math.max(1, Math.floor(requested * (0.5 + 0.5 * ratio)));
    effective = Math.min(effective, shrunk);
    fogParts.push("your thoughts feel sluggish, the older the harder to reach");
  }

  if (rest < REST_FRAYED) {
    effective = Math.max(0, effective - 1);
    fogParts.push("you're frayed; a moment or two slips through the cracks");
  }

  return {
    effective,
    fog: fogParts.length === 0 ? null : fogParts.join("; "),
  };
}

/**
 * Gate impression access (the per-occupant impressions map). Today
 * this is binary — either you can recall how this ghost felt, or you
 * can't. Critical Rest blocks; everything else passes.
 */
export interface GatedAccess {
  readonly accessible: boolean;
  readonly fog: MemoryFog | null;
}

export function gateOccupantImpressions(needs: NeedProfile): GatedAccess {
  if (needs.Rest.display < REST_BLACKOUT) {
    return {
      accessible: false,
      fog: "the faces around you blur — you can't quite recall what they've felt like",
    };
  }
  return { accessible: true, fog: null };
}

/**
 * Merge multiple fog strings into one (deduped, preserving order).
 * Used by the run-loop to fold the four fetches' individual fogs into
 * a single "memory feels" line for the prompt.
 */
export function mergeFog(parts: ReadonlyArray<MemoryFog | null>): MemoryFog | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (p === null) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length === 0 ? null : out.join("; ");
}
