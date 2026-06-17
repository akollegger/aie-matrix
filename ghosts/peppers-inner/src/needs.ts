/**
 * Primal corporeal needs — Maslow tier 1.
 *
 * Backed by the generic `Slider` component. Each need is a `Slider`
 * instance with its own `SliderConfig` — Fuel uses sigmoid math with
 * a mobile setpoint (binge → tolerance → satiety drift); Coherence
 * and Rest still use linear math with locked setpoints because
 * nothing wants them to habituate yet.
 *
 * `NeedState.display` is kept as a derived field for the dozens of
 * existing read-sites that pattern `profile.Fuel.display`. The
 * canonical state is `slider`. Anything new (failure curves,
 * setpoint-aware drives, distance-based token caps) reads `slider`
 * via the helpers re-exported below.
 *
 *   - Fuel       — token / compute budget the ghost can spend
 *                  (sigmoid; satiety setpoint drifts with bingeing)
 *   - Coherence  — working context the ghost is currently grounded in
 *   - Rest       — memory consolidation / personality drift capacity
 */

import {
  applyEvent,
  display as sliderDisplay,
  distanceFromSetpoint as sliderDistanceFromSetpoint,
  incrementTolerance as incrementSliderTolerance,
  makeSlider,
  setpointDisplay as sliderSetpointDisplay,
  sliderFromDisplay,
  type Slider,
  type SliderConfig,
} from "./slider/index.js";
import { DISPLAY_MAX, DISPLAY_MIDPOINT, DISPLAY_MIN } from "./sliders.js";

/** The three primal needs. Order is stable for reproducible logs. */
export type NeedName = "Fuel" | "Coherence" | "Rest";

export const STARTER_NEEDS: readonly NeedName[] = [
  "Fuel",
  "Coherence",
  "Rest",
] as const;

/**
 * Per-need slider configuration.
 *
 * Fuel is the only sigmoid-with-tolerance slider today. Coherence and
 * Rest stay linear with locked setpoints — their existing wiring
 * (history depth, drift damping) is fine and there's no addictive
 * loop we want them to express yet.
 *
 * Fuel tolerance tuning:
 *  - `toleranceStep: 0.4` logit per binge episode. Six episodes
 *    raise the setpoint by 2.4 logit, which lifts display 5 →
 *    ~9.2 — meaningful habituation.
 *  - `toleranceMax: 6` caps the drift so the setpoint can't run
 *    off the top of the sigmoid.
 */
export const NEED_CONFIGS: Readonly<Record<NeedName, SliderConfig>> = {
  Fuel: {
    mode: "sigmoid",
    toleranceStep: 0.4,
    toleranceMax: 6,
    baseSetpoint: 0,
    // eventScale 1.0 with logistic-growth math: a +1 unit bite
    // moves display by (10−d)/10 — 0.8 at Fuel=2, 0.5 at Fuel=5,
    // 0.2 at Fuel=8. A starving ghost gets a much bigger return on
    // each bite than a satiated one. Depletion is symmetric the
    // other way: depleting at Fuel=8 → loss 0.8 × rate; at Fuel=2 →
    // loss 0.2 × rate. The slider asymptotes at both bounds.
    eventScale: 1,
  },
  Coherence: {
    mode: "linear",
    toleranceStep: 0,
    toleranceMax: 0,
    baseSetpoint: 0,
    eventScale: 0,
  },
  Rest: {
    // Same Slider component as Fuel, sigmoid mode: exhaustion bites
    // harder the more depleted you are, and rest restores more when
    // you're well-rested — symmetric logistic dynamics. No tolerance
    // drift (Rest has no binge/habituation analogue).
    mode: "sigmoid",
    toleranceStep: 0,
    toleranceMax: 0,
    baseSetpoint: 0,
    eventScale: 1,
  },
};

/** A single need's state. `display` is derived from `slider`; kept
 *  for back-compat with the many read-sites that pattern
 *  `profile.X.display`. New code should prefer `slider`. */
export interface NeedState {
  readonly display: number;
  readonly slider: Slider;
}

/** A ghost's full primal need state — one NeedState per active need. */
export type NeedProfile = Readonly<Record<NeedName, NeedState>>;

function makeNeed(name: NeedName, atDisplay?: number): NeedState {
  const slider =
    atDisplay !== undefined
      ? sliderFromDisplay(atDisplay, NEED_CONFIGS[name])
      : makeSlider(NEED_CONFIGS[name]);
  return { slider, display: sliderDisplay(slider) };
}

/** Need profile with every need at its config-derived setpoint
 *  (display 5 for all current needs). Healthy starting state. */
export function midpointNeeds(): NeedProfile {
  const entries = STARTER_NEEDS.map((name) => [name, makeNeed(name)] as const);
  return Object.fromEntries(entries) as NeedProfile;
}

/**
 * Per-cascade depletion rates, in DISPLAY units per cascade.
 *
 * Fuel's nominal depletion is 0.05 / cascade unscaled; under
 * `PEPPERS_NEEDS_RUSH=15` (demo time-compression), 0.75 / cascade.
 * In Stage 3 the run-loop swaps this flat rate for a token-burn
 * proportional rate — the constant below is now a *fallback* for
 * callers that don't track token usage.
 */
export const DEFAULT_NEED_DEPLETION: Readonly<Record<NeedName, number>> = {
  Fuel: 0.05,
  Coherence: 0,
  Rest: 0.02,
};

/** Apply one cascade of depletion to a need profile, passing through
 *  the per-need slider math. */
export function applyCascadeDepletion(
  profile: NeedProfile,
  rates: Readonly<Record<NeedName, number>> = DEFAULT_NEED_DEPLETION,
): NeedProfile {
  const next = { ...profile } as { -readonly [K in NeedName]: NeedState };
  for (const name of STARTER_NEEDS) {
    const rate = rates[name];
    if (rate <= 0) continue;
    const config = NEED_CONFIGS[name];
    const slider = applyEvent(profile[name].slider, -rate, config);
    next[name] = { slider, display: sliderDisplay(slider) };
  }
  return next as NeedProfile;
}

/** Apply a single explicit adjustment to one need (e.g. restoration
 *  from eating). Passes through the per-need slider math — sigmoid
 *  for Fuel (replenishment compresses near satiety), linear for
 *  Coherence/Rest. */
export type Direction = "up" | "down";

export function adjustNeed(
  profile: NeedProfile,
  need: NeedName,
  direction: Direction,
  delta: number,
): NeedProfile {
  if (!Number.isFinite(delta) || delta <= 0) return profile;
  const config = NEED_CONFIGS[need];
  const signed = direction === "up" ? delta : -delta;
  const slider = applyEvent(profile[need].slider, signed, config);
  return {
    ...profile,
    [need]: { slider, display: sliderDisplay(slider) },
  } as NeedProfile;
}

/** Adjust a need by an EXACT number of DISPLAY units, bypassing the
 *  per-need sigmoid compression (forces linear event math). `delta`
 *  display units are added/removed verbatim, clamped to the open
 *  interval; the slider's setpoint and tolerance are preserved. Used by
 *  effects that must land a precise display delta — e.g. a sugar crash
 *  that removes exactly "what the food gave, plus one" rather than a
 *  sigmoid-compressed amount. */
export function adjustNeedDisplay(
  profile: NeedProfile,
  need: NeedName,
  direction: Direction,
  delta: number,
): NeedProfile {
  if (!Number.isFinite(delta) || delta <= 0) return profile;
  const signed = direction === "up" ? delta : -delta;
  const linearConfig = { ...NEED_CONFIGS[need], mode: "linear" as const };
  const slider = applyEvent(profile[need].slider, signed, linearConfig);
  return {
    ...profile,
    [need]: { slider, display: sliderDisplay(slider) },
  } as NeedProfile;
}

/** Increment a need's tolerance on episode completion. `direction`
 *  is "high" for over-side episodes (e.g., a Fuel binge) and "low"
 *  for under-side episodes. No-op for needs whose config has
 *  `toleranceStep = 0`. */
export function incrementNeedTolerance(
  profile: NeedProfile,
  need: NeedName,
  direction: "high" | "low",
): NeedProfile {
  const config = NEED_CONFIGS[need];
  const before = profile[need].slider;
  const slider = incrementSliderTolerance(before, direction, config);
  if (slider === before) return profile;
  return {
    ...profile,
    [need]: { slider, display: sliderDisplay(slider) },
  } as NeedProfile;
}

/** Setpoint of a need in display units. Mobile for Fuel (via
 *  tolerance); locked at 5 for Coherence/Rest. */
export function needSetpointDisplay(profile: NeedProfile, need: NeedName): number {
  return sliderSetpointDisplay(profile[need].slider);
}

/** Signed distance below/above setpoint, in display units.
 *  Negative = depleted, positive = oversaturated. */
export function needDistanceFromSetpoint(
  profile: NeedProfile,
  need: NeedName,
): number {
  return sliderDistanceFromSetpoint(profile[need].slider);
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
// Reads the current need profile, picks the need furthest from its
// (now-mobile, for Fuel) setpoint, and emits a drive string the
// brain can act on. Returns null when every need is within the
// healthy band of its OWN setpoint — at that point the surface
// objective alone governs behaviour.

export type PrimalDirection = "depleted" | "oversaturated";

export interface PrimalDrive {
  readonly need: NeedName;
  readonly direction: PrimalDirection;
  /** Distance from setpoint in display units (0..5). Larger = more urgent. */
  readonly urgency: number;
  /** Current display value of the underlying need counter. */
  readonly currentDisplay: number;
  /** Current setpoint, in display units. */
  readonly setpointDisplay: number;
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
      "you are full — your body is asking you to stop eating, sit with what you have",
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
 * Felt-vocabulary fullness signal. Fires when Fuel sits at or above
 * the setpoint, before the urgency-driven primal drive kicks in.
 * Without this, the substrate silently knows the body is full but
 * the brain has no cue — it keeps eating and accidentally trips
 * into binge territory. The signal is a single short phrase the
 * caller injects into the synthesis (and optionally impulse)
 * prompt as felt vocabulary, not a drive override.
 *
 *   distance ≥ +2.5 → "stuffed; your body feels heavy"
 *   distance ≥ +1.5 → the drive itself fires (caller picks drive text)
 *   distance ≥ +0.5 → "comfortably full; you do not need to eat"
 *   distance < +0.5 → null (no extra felt signal needed)
 *
 * Returning null in the band keeps the synthesis prompt clean when
 * nothing wants the brain's attention. The depleted side already
 * has the drive text and primal-stimulus pathways; a parallel
 * "hint of hunger" line could be added later if useful, but for
 * now we only emit the high-side signal — the one binge mechanics
 * depend on.
 */
export function fullnessFelt(profile: NeedProfile): string | null {
  const distance = needDistanceFromSetpoint(profile, "Fuel");
  if (distance >= 2.5) {
    return "your body feels stuffed and heavy";
  }
  if (distance >= 1.5) {
    return "your body is asking you to stop eating now";
  }
  if (distance >= 0.5) {
    return "your body feels comfortably full; you do not need to eat";
  }
  return null;
}

/** Strongest current primal drive, or null if every need is inside
 *  the healthy ±1.5 band of its OWN setpoint. Ties broken by need
 *  order (Fuel > Coherence > Rest). */
export function selectPrimalDrive(profile: NeedProfile): PrimalDrive | null {
  let strongest: PrimalDrive | null = null;
  for (const name of STARTER_NEEDS) {
    const slider = profile[name].slider;
    const currentDisplay = sliderDisplay(slider);
    const setDisplay = sliderSetpointDisplay(slider);
    const distance = currentDisplay - setDisplay;
    const magnitude = Math.abs(distance);
    if (magnitude < 1.5) continue; // healthy band — no drive
    const direction: PrimalDirection = distance < 0 ? "depleted" : "oversaturated";
    const candidate: PrimalDrive = {
      need: name,
      direction,
      urgency: magnitude,
      currentDisplay,
      setpointDisplay: setDisplay,
      drive: PRIMAL_DRIVE_TEXT[name][direction],
    };
    if (strongest === null || candidate.urgency > strongest.urgency) {
      strongest = candidate;
    }
  }
  return strongest;
}

// Re-exports so consumers of needs.ts don't need to also import sliders.
export { DISPLAY_MAX, DISPLAY_MIDPOINT, DISPLAY_MIN };
