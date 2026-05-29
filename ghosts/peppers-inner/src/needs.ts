/**
 * Primal corporeal needs — Maslow tier 1.
 *
 * Needs use **linear** math on display values 0..10, distinct from the
 * sigmoid-bounded slider math used for personality feelings. The
 * earlier shared-slider design was wrong: sigmoid is essential for
 * feelings (otherwise everyone caricatures at the extremes — a Warmth
 * of 9.99 should not behave wildly different from 9.9), but a need
 * is a counter. Food adds to it, time subtracts from it. If you eat 1
 * unit of food when you have 1.82, you have 2.82. No diminishing
 * returns, no asymptotic clamp beyond the natural 0..10 bound.
 *
 * The three primal needs map cleanly to LLM physiological substrate:
 *   - Fuel       — token / compute budget the ghost can spend
 *   - Coherence  — working context the ghost is currently grounded in
 *   - Rest       — memory consolidation / personality drift capacity
 *
 * These are the LLM's literal corporeal substrate, not metaphors.
 * Depleting them produces real degradation in LLM call parameters
 * (max_tokens, model tier, pipeline stage count, memory writes),
 * giving genuine Darwinian survival pressure.
 */

import { DISPLAY_MAX, DISPLAY_MIDPOINT, DISPLAY_MIN } from "./sliders.js";

/** The three primal needs. Order is stable for reproducible logs. */
export type NeedName = "Fuel" | "Coherence" | "Rest";

export const STARTER_NEEDS: readonly NeedName[] = [
  "Fuel",
  "Coherence",
  "Rest",
] as const;

/** A single need's state — a plain counter on the display interval
 *  0..10, NOT a sigmoid-bounded slider. Eating +X moves it by exactly
 *  +X; time -X moves it by exactly -X. Clamped at the bounds. */
export interface NeedState {
  readonly display: number;
}

/** A ghost's full primal need state — one NeedState per active need. */
export type NeedProfile = Readonly<Record<NeedName, NeedState>>;

/** Need profile with every need at the satiated midpoint (5).
 *  Healthy starting state — neither depleted nor oversaturated. */
export function midpointNeeds(): NeedProfile {
  const entries = STARTER_NEEDS.map((need) => [
    need,
    { display: DISPLAY_MIDPOINT } satisfies NeedState,
  ] as const);
  return Object.fromEntries(entries) as NeedProfile;
}

/**
 * Per-cascade depletion rates, in DISPLAY units per cascade.
 *
 *   - Fuel: 0.05 → from midpoint 5 to mortality 1, ~80 cascades
 *     unscaled. With PEPPERS_NEEDS_RUSH=15 (demo time-compression),
 *     0.75/cascade → ~5 cascades to mortality.
 *   - Coherence: temporarily 0 while we revisit what Coherence should
 *     actually model (the Maslow-tier-1 mapping was always shaky).
 *   - Rest: 0.02 → ~200 cascades unscaled.
 *
 * Rates can be amplified per-cascade based on what the cascade
 * contained (e.g. larger Fuel depletion when more pipeline stages ran).
 */
export const DEFAULT_NEED_DEPLETION: Readonly<Record<NeedName, number>> = {
  Fuel: 0.05,
  Coherence: 0,
  Rest: 0.02,
};

/**
 * Apply one cascade of depletion to a need profile — `display = max(0,
 * display - rate)` for each need with rate > 0. Returns a new
 * NeedProfile; the input is unchanged.
 */
export function applyCascadeDepletion(
  profile: NeedProfile,
  rates: Readonly<Record<NeedName, number>> = DEFAULT_NEED_DEPLETION,
): NeedProfile {
  const next = { ...profile } as { -readonly [K in NeedName]: NeedState };
  for (const need of STARTER_NEEDS) {
    const rate = rates[need];
    if (rate <= 0) continue;
    next[need] = {
      display: Math.max(DISPLAY_MIN, profile[need].display - rate),
    };
  }
  return next as NeedProfile;
}

/**
 * Apply a single explicit adjustment to one need (e.g. restoration
 * from eating). `up` adds delta to display, `down` subtracts. Clamped
 * to [0, 10]. Linear — no sigmoid, no asymptote.
 */
export type Direction = "up" | "down";

export function adjustNeed(
  profile: NeedProfile,
  need: NeedName,
  direction: Direction,
  delta: number,
): NeedProfile {
  const current = profile[need].display;
  const next =
    direction === "up"
      ? Math.min(DISPLAY_MAX, current + delta)
      : Math.max(DISPLAY_MIN, current - delta);
  return {
    ...profile,
    [need]: { display: next },
  } as NeedProfile;
}

/**
 * Sample a "displaced" starting need profile — useful for spawning
 * ghosts at varied need states for testing. Each need lands within
 * ±stddev (in display units) of the midpoint. Defaults to no spread.
 */
export interface NeedBirthConfig {
  readonly stddev?: number;
  readonly seed?: number;
}

// All ghosts start satiated for now; spawn-variance is a follow-up.
export function startingNeeds(_config: NeedBirthConfig = {}): NeedProfile {
  return midpointNeeds();
}

// ─── Primal drive emission ───────────────────────────────────────────────────
//
// The lizard. Reads the current need profile, picks the need furthest
// from its sweet spot, and emits a drive string the brain can act on.
// Returns null when every need is within the healthy band — at that
// point the surface objective alone governs behaviour.
//
// "Sweet spot" is display 5. The healthy band is ±1.5 from there.
// Outside the band, the need's distance from sweet spot is its
// urgency, and the most-urgent need's drive overrides the surface
// objective in the downstream prompts.

export type PrimalDirection = "depleted" | "oversaturated";

export interface PrimalDrive {
  readonly need: NeedName;
  readonly direction: PrimalDirection;
  /** Distance from sweet spot in display units (0..5). Larger = more urgent. */
  readonly urgency: number;
  /** Current display value of the underlying need counter. */
  readonly currentDisplay: number;
  /** Human-readable drive text the prompt injects. First-person, imperative. */
  readonly drive: string;
}

const PRIMAL_DRIVE_TEXT: Readonly<
  Record<NeedName, Readonly<Record<PrimalDirection, string>>>
> = {
  Fuel: {
    depleted:
      "you are starving — your body needs sustenance, find something to consume",
    oversaturated:
      "you are overstuffed — slow down, your body cannot process more",
  },
  Coherence: {
    depleted:
      "you are unmoored — ground yourself by observing the world, by being addressed, by witnessing what is",
    oversaturated:
      "your attention is overloaded — withdraw, let things settle",
  },
  Rest: {
    depleted:
      "you are exhausted — find solitude, be still, let activity quiet",
    oversaturated:
      "you have been still too long — engage with the world, do something",
  },
};

/**
 * Select the strongest current primal drive, or null if every need is
 * inside the healthy band (display 3.5..6.5). "Strongest" = largest
 * distance from the sweet spot at 5.
 *
 * Ties broken by need order (Fuel > Coherence > Rest) — matches the
 * Maslow-style priority where corporeal sustenance dominates.
 */
export function selectPrimalDrive(profile: NeedProfile): PrimalDrive | null {
  let strongest: PrimalDrive | null = null;
  for (const need of STARTER_NEEDS) {
    const currentDisplay = profile[need].display;
    const distance = Math.abs(currentDisplay - DISPLAY_MIDPOINT);
    if (distance < 1.5) continue; // healthy band — no drive
    const direction: PrimalDirection =
      currentDisplay < DISPLAY_MIDPOINT ? "depleted" : "oversaturated";
    const candidate: PrimalDrive = {
      need,
      direction,
      urgency: distance,
      currentDisplay,
      drive: PRIMAL_DRIVE_TEXT[need][direction],
    };
    if (strongest === null || candidate.urgency > strongest.urgency) {
      strongest = candidate;
    }
  }
  return strongest;
}

// Re-exports so consumers of needs.ts don't need to also import sliders.
export { DISPLAY_MAX, DISPLAY_MIDPOINT, DISPLAY_MIN };
