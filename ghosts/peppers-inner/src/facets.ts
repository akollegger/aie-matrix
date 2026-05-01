/**
 * Starter 8-facet active set for v1 per RFC-0007. Names are axis-neutral
 * — each (Internal, External) pair can sit anywhere on its axis, and
 * balanced positions `(N, N)` are coherent personalities at that level
 * of the trait regardless of N.
 */

import {
  DEFAULT_DELTA,
  DISPLAY_MAX,
  DISPLAY_MIDPOINT,
  DISPLAY_MIN,
  fromDisplay,
  midpoint,
  type Axis,
  type SliderValue,
} from "./sliders.js";

export type FacetName =
  | "Ideas"
  | "Deliberation"
  | "Assertiveness"
  | "Warmth"
  | "Trust"
  | "Altruism"
  | "Stability"
  | "Self-Monitoring";

/**
 * Ordered starter set. Order is stable so callers can use index-based
 * iteration for reproducible logs and snapshot diffs.
 */
export const STARTER_FACETS: readonly FacetName[] = [
  "Ideas",
  "Deliberation",
  "Assertiveness",
  "Warmth",
  "Trust",
  "Altruism",
  "Stability",
  "Self-Monitoring",
] as const;

/** A single trait's 2D state: one slider per axis. */
export interface TraitState {
  readonly internal: SliderValue;
  readonly external: SliderValue;
}

/** A ghost's full active personality: one TraitState per active facet. */
export type PersonalityState = Readonly<Record<FacetName, TraitState>>;

/** Personality with every facet at the ataraxic midpoint (5, 5). */
export function midpointPersonality(): PersonalityState {
  const entries = STARTER_FACETS.map((facet) => [
    facet,
    { internal: midpoint(), external: midpoint() } satisfies TraitState,
  ] as const);
  return Object.fromEntries(entries) as PersonalityState;
}

/** Deterministic 32-bit PRNG (Mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform: standard normal from two uniforms in (0, 1). */
function standardNormal(rand: () => number): number {
  // Reject 0 to avoid log(0); the closed-open interval [0, 1) of mulberry32
  // is an issue only at exactly 0, which has measure zero in practice.
  let u1 = rand();
  while (u1 === 0) u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Configuration for sampling a birth personality. */
export interface BirthConfig {
  /**
   * Standard deviation of each (Internal, External) pair in display
   * units, around the midpoint. Default 1.5. Sampled values are
   * clamped to the open interval (DISPLAY_MIN, DISPLAY_MAX).
   */
  readonly stddev?: number;
  /** PRNG seed for reproducibility. Default: Math.random-derived. */
  readonly seed?: number;
}

/** Clamp a display value into the open interval (DISPLAY_MIN, DISPLAY_MAX). */
function clampDisplay(x: number): number {
  const epsilon = 1e-6;
  if (x <= DISPLAY_MIN) return DISPLAY_MIN + epsilon;
  if (x >= DISPLAY_MAX) return DISPLAY_MAX - epsilon;
  return x;
}

/**
 * Sample a starter personality with each (Internal, External) slider
 * drawn independently from N(midpoint, stddev), clamped into the open
 * display interval.
 */
export function samplePersonality(config: BirthConfig = {}): PersonalityState {
  const stddev = config.stddev ?? 1.5;
  if (!Number.isFinite(stddev) || stddev <= 0) {
    throw new RangeError(`stddev must be a positive finite number; got ${stddev}`);
  }
  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = mulberry32(seed);

  const sample = (): SliderValue => {
    const raw = DISPLAY_MIDPOINT + standardNormal(rand) * stddev;
    return fromDisplay(clampDisplay(raw));
  };

  const entries = STARTER_FACETS.map((facet) => [
    facet,
    { internal: sample(), external: sample() } satisfies TraitState,
  ] as const);
  return Object.fromEntries(entries) as PersonalityState;
}

// Re-export axis-related types so consumers of facets don't need to
// import from both modules for common usage.
export type { Axis, SliderValue };
export { DEFAULT_DELTA, DISPLAY_MAX, DISPLAY_MIDPOINT, DISPLAY_MIN };
