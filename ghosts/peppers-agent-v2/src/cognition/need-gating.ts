/**
 * Need-state gating on the cascade's mechanical affordances.
 *
 * Two layers:
 *   - **Fuel critical** (Fuel display ≤ `FUEL_CRITICAL_DISPLAY`):
 *     the menu narrows to the corporeal essentials AND the upstream
 *     Id pipeline short-circuits facets + convergence (handled in
 *     `reason-id.ts`). A starving ghost doesn't deliberate.
 *   - **Binge episode active**: the eating tools (`consume`/`take`)
 *     are temporarily withdrawn — the body forces a pause to digest.
 *     Episode latching lives in `run-house.ts`; this module just
 *     reads the flag. After the episode resolves, the run-loop
 *     increments Fuel's tolerance counter (satiety setpoint rises),
 *     which is how addiction-shaped dynamics emerge: each cycle the
 *     ghost needs MORE food to feel sated.
 *
 * Coherence / Rest already shape memory depth and drift damping
 * inside the run-loop; their tool-menu effect can land in a later
 * pass when there's a clear affordance to drop.
 */

import {
  needDistanceFromSetpoint,
  type NeedProfile,
} from "@aie-matrix/ghost-peppers-inner";

import type { ToolSchema } from "../llm-client.js";

/** Fuel display ≤ this → "starving" — body screams, menu narrows,
 *  pipeline collapses to the corporeal essentials. */
export const FUEL_CRITICAL_DISPLAY = 1.5;

/** Distance at which the token / temperature curves hit their
 *  endpoints. Beyond this, the floor / peak takes over. */
export const TOKEN_CAP_ZERO_DISTANCE = 4.5;

/**
 * Id synthesis token cap — aggressive quadratic glide with a tiny
 * floor. A starving or stuffed ghost gets the inner monologue cut
 * to a fragment, which is the "they can't deliberate, they can't
 * decide effectively" property. Synthesis output feeds the action
 * picker downstream; less narrative → simpler action choices.
 *
 *   - distance 0      → 800 tokens (full reign)
 *   - distance 2      → ~247
 *   - distance 3.5    → ~39
 *   - distance ≥ 4.5  → 10 (floor)
 */
export const SYNTHESIS_TOKEN_BASELINE = 800;
export const SYNTHESIS_TOKEN_FLOOR = 10;

export function synthesisTokenCap(needs: NeedProfile): number {
  const distance = Math.abs(needDistanceFromSetpoint(needs, "Fuel"));
  if (distance >= TOKEN_CAP_ZERO_DISTANCE) return SYNTHESIS_TOKEN_FLOOR;
  const t = 1 - distance / TOKEN_CAP_ZERO_DISTANCE;
  return Math.max(
    SYNTHESIS_TOKEN_FLOOR,
    Math.round(SYNTHESIS_TOKEN_BASELINE * t * t),
  );
}

/**
 * Surface speech token cap — gentler linear glide with a moderate
 * floor. A starving ghost should still be able to talk — they
 * shouldn't go silent. The point is for them to become erratic,
 * not absent. Combined with the temperature ramp below, low Fuel
 * produces jagged, terse, less-controlled speech rather than no
 * speech at all.
 *
 *   - distance 0      → 400 tokens
 *   - distance 2      → ~222
 *   - distance 3.5    → ~89
 *   - distance ≥ 4.5  → 80 (floor — enough for a short, fragmentary line)
 */
export const SURFACE_TOKEN_BASELINE = 400;
export const SURFACE_TOKEN_FLOOR = 80;

export function surfaceTokenCap(needs: NeedProfile): number {
  const distance = Math.abs(needDistanceFromSetpoint(needs, "Fuel"));
  if (distance >= TOKEN_CAP_ZERO_DISTANCE) return SURFACE_TOKEN_FLOOR;
  const t = 1 - distance / TOKEN_CAP_ZERO_DISTANCE;
  return Math.max(
    SURFACE_TOKEN_FLOOR,
    Math.round(SURFACE_TOKEN_BASELINE * t),
  );
}

/**
 * Surface temperature ramp — rises with Fuel distance. Calm at the
 * setpoint, more erratic the further out the body is. Default
 * temperature in this codebase is 0.7 (set in llm-client); we ramp
 * to 1.5 at the far end of the distance band, which puts word
 * choice in jagged territory without falling off into pure noise.
 *
 *   - distance 0      → 0.7  (matches the codebase default, fully controlled)
 *   - distance 2      → ~1.05
 *   - distance 3.5    → ~1.32
 *   - distance ≥ 4.5  → 1.5  (peak — noticeably erratic word choice)
 */
export const SURFACE_TEMP_BASELINE = 0.7;
export const SURFACE_TEMP_PEAK = 1.5;

export function surfaceTemperature(needs: NeedProfile): number {
  const distance = Math.abs(needDistanceFromSetpoint(needs, "Fuel"));
  const t = Math.min(1, distance / TOKEN_CAP_ZERO_DISTANCE);
  return SURFACE_TEMP_BASELINE + t * (SURFACE_TEMP_PEAK - SURFACE_TEMP_BASELINE);
}

/** World tools we keep when Fuel is critical. Everything else is
 *  pruned. The whitelist names what the body still cares about:
 *  perceive, FIND food, move to it, BUY it, grab it, eat it, declare.
 *  Conversational ritual, introspection, exploration get dropped —
 *  luxuries when the body is screaming.
 *
 *  CRITICAL: `nearest` (locate a food vendor) and `request` (buy from
 *  it) MUST stay. Food is sold at vendors (RFC-0029), not free on the
 *  ground — pruning these left a starving ghost unable to acquire food
 *  at all, so the Fuel drive was unsatisfiable and every fuel-critical
 *  life ended in starvation (and the inherited "find food → buy → eat"
 *  karmic skill was unexecutable the instant its trigger fired).
 *  Degradation narrows OTHER reach; it never removes the path to the
 *  very thing the body is dying for. */
const FUEL_CRITICAL_KEEP = new Set([
  "say",
  "go",
  "nearest",
  "request",
  "look",
  "take",
  "consume",
  "eat",
  "drop",
  "inventory",
]);

/** Tools dropped while a binge episode is active. The body has just
 *  glutted itself and is forcing a pause — eating is unavailable
 *  until the episode resolves. NOT a state-based filter on every
 *  cascade above some Fuel level; it's an event latch managed by
 *  the run-house and threaded into this gate via `bingeActive`. */
const BINGE_EPISODE_DROP = new Set(["consume", "eat", "take"]);

export interface NeedGatingDecision {
  /** Tool list to expose to the SDK Agent this cascade. */
  readonly tools: ReadonlyArray<ToolSchema>;
  /** True when the Id should skip facet + convergence stages and
   *  route the primal drive directly into synthesis. Fires at the
   *  same Fuel-critical threshold the menu narrows at. */
  readonly skipFacets: boolean;
  /** Short human-readable summary of which gates fired, for logs. */
  readonly note: string | null;
}

export interface NeedGatingOptions {
  /** True when a binge episode is currently in progress for this
   *  ghost. The run-house latches this on Fuel-crosses-high and
   *  releases it on Fuel-falls-below-low. */
  readonly bingeActive?: boolean;
}

export function gateForNeeds(
  tools: ReadonlyArray<ToolSchema>,
  needs: NeedProfile,
  opts: NeedGatingOptions = {},
): NeedGatingDecision {
  const fuel = needs.Fuel.display;
  const notes: string[] = [];
  let active = tools;
  let skipFacets = false;

  if (fuel <= FUEL_CRITICAL_DISPLAY) {
    const filtered = active.filter((t) => FUEL_CRITICAL_KEEP.has(t.name));
    if (filtered.length > 0) active = filtered;
    skipFacets = true;
    notes.push(
      `fuel-critical (${fuel.toFixed(2)}/10) — menu narrowed to ${active
        .map((t) => t.name)
        .join(", ")}, facets skipped`,
    );
  }

  if (opts.bingeActive === true) {
    const filtered = active.filter((t) => !BINGE_EPISODE_DROP.has(t.name));
    if (filtered.length > 0) active = filtered;
    notes.push(
      `binge-episode active (Fuel=${fuel.toFixed(2)}/10) — feeding tools withdrawn while body digests`,
    );
  }

  return {
    tools: active,
    skipFacets,
    note: notes.length > 0 ? notes.join(" · ") : null,
  };
}
