/**
 * Generic slider — value + setpoint + tolerance + sigmoid math.
 *
 * One component, many instances. Personality facets are sliders with
 * a locked setpoint. Needs (Fuel today, eventually Coherence/Rest)
 * are sliders with a mobile setpoint that drifts when the ghost
 * over- or under-uses the thing the slider tracks. The same shape
 * will eventually carry drug tolerance, identity-stability tolerance,
 * anything else that has "this is where I feel right" + "I can move
 * that line by repeated exposure."
 *
 * Storage is in logit space (unbounded). Display is the sigmoid map
 * onto (0, 10) — same math as `sliders.ts` so the existing personality
 * code is mechanically equivalent. The new pieces are:
 *
 *   - `setpoint` (logit) — where the slider "wants" to be. Distance
 *     from setpoint is what the substrate measures for failure curves,
 *     drive emission, etc. Default setpoint = 0 (display 5), matching
 *     the historical hard-coded midpoint.
 *
 *   - `tolerance` (counter) — how many times this slider has been
 *     pushed past its setpoint and recovered. Each tolerance unit
 *     shifts the setpoint by `toleranceStep` in the direction of
 *     past excess. The ghost ends up needing more of whatever this
 *     slider tracks to feel "right" — addiction, habituation,
 *     identity drift, the same shape across domains.
 *
 * Replenishment math has two modes:
 *
 *   - `"sigmoid"` — logistic-growth: events in the direction of
 *     motion are scaled by remaining headroom in that direction.
 *     `displayDelta = event × eventScale × headroom / 10`, where
 *     `headroom = 10 − display` for positive events (room to grow)
 *     and `display` for negative events (room to fall). A bite at
 *     Fuel 2 → headroom 8, big gain; same bite at Fuel 8 → headroom 2,
 *     small gain. Symmetrically: depletion at Fuel 8 → big loss,
 *     depletion at Fuel 2 → small loss (asymptotes near zero).
 *
 *   - `"linear"` — display += event verbatim, clamped to (ε, 10−ε).
 *     For sliders whose semantics really is "a counter" with no
 *     diminishing returns near the edges. We don't use this for any
 *     wired slider today but it's there for things like a memory
 *     counter or a debt ledger if those ever migrate.
 *
 * The module is intentionally pure functions over plain data — no
 * classes, no shared state. Callers hold the `Slider` value and pass
 * it through `applyEvent` / `incrementTolerance` each cascade.
 */

/** Open-interval display bounds. Matches `sliders.ts`. */
export const DISPLAY_MIN = 0;
export const DISPLAY_MAX = 10;
export const DISPLAY_MIDPOINT = 5;

/** Tiny epsilon used to keep display values strictly inside (0, 10). */
const DISPLAY_EPSILON = 1e-6;

export interface Slider {
  /** Canonical storage in logit space. */
  readonly value: number;
  /** Where this slider "wants" to be, in logit space. Default 0 (display 5). */
  readonly setpoint: number;
  /** Signed counter of completed over/under episodes. Positive when the
   *  ghost has repeatedly overshot the high side, negative when they
   *  have repeatedly undershot. Each unit shifts `setpoint` by
   *  `toleranceStep` in the direction of past excess. */
  readonly tolerance: number;
}

export interface SliderConfig {
  readonly mode: "sigmoid" | "linear";
  /** Logit-space shift per unit of `tolerance`. Default 0 means the
   *  setpoint is locked — the slider behaves like a personality
   *  facet. Set positive on sliders that should habituate. */
  readonly toleranceStep: number;
  /** Hard cap on |tolerance| so the setpoint can't drift off the
   *  sigmoid. With step 0.4 and max 8, the setpoint can shift at
   *  most 3.2 logit units (≈ display 4 → 8.5). */
  readonly toleranceMax: number;
  /** Base setpoint at zero tolerance, in logit space. Default 0
   *  (display 5). Some sliders may want a non-midpoint baseline
   *  (e.g., a positive default for an inherently "good" mood). */
  readonly baseSetpoint: number;
  /** Sigmoid mode only. Multiplier applied to event magnitudes
   *  before the headroom factor. Default 1 — a `+1` event with
   *  headroom 1.0 moves display by 1.0; with headroom 0.5 moves by
   *  0.5. Tune lower for sliders where each event should feel
   *  gentler overall. Ignored in linear mode. */
  readonly eventScale: number;
}

export const DEFAULT_SLIDER_CONFIG: SliderConfig = {
  mode: "sigmoid",
  toleranceStep: 0,
  toleranceMax: 0,
  baseSetpoint: 0,
  eventScale: 1,
};

/** Factory: a slider at its (config-derived) setpoint, zero tolerance. */
export function makeSlider(config: SliderConfig = DEFAULT_SLIDER_CONFIG): Slider {
  return { value: config.baseSetpoint, setpoint: config.baseSetpoint, tolerance: 0 };
}

/** Factory from an explicit starting display value (open-interval). */
export function sliderFromDisplay(
  display: number,
  config: SliderConfig = DEFAULT_SLIDER_CONFIG,
): Slider {
  return {
    value: displayToLogit(display),
    setpoint: config.baseSetpoint,
    tolerance: 0,
  };
}

export function logitToDisplay(logit: number): number {
  return DISPLAY_MAX / (1 + Math.exp(-logit));
}

export function displayToLogit(display: number): number {
  const clamped = Math.min(
    DISPLAY_MAX - DISPLAY_EPSILON,
    Math.max(DISPLAY_EPSILON, display),
  );
  const p = clamped / DISPLAY_MAX;
  return Math.log(p / (1 - p));
}

/** Read the slider as a display value strictly in (0, 10). The raw
 *  sigmoid can equal the bound at float precision once the logit is
 *  far enough from 0 (around ±37); we clamp so distance-from-setpoint
 *  and other consumers never see exactly 0 or 10. */
export function display(s: Slider): number {
  return clampDisplay(logitToDisplay(s.value));
}

/** Read the setpoint as a display value strictly in (0, 10). */
export function setpointDisplay(s: Slider): number {
  return clampDisplay(logitToDisplay(s.setpoint));
}

/** Signed distance below/above the current setpoint, in display units.
 *  Negative = below setpoint, positive = above. Used for failure
 *  curves and drive selection. */
export function distanceFromSetpoint(s: Slider): number {
  return display(s) - setpointDisplay(s);
}

/**
 * Apply an event to the slider.
 *
 * `deltaDisplay` is the SIGNED event magnitude in display units —
 * +2.0 for "eat two units of food", −0.5 for "an idle tick burns
 * half a unit". The math depends on `config.mode`:
 *
 *   - sigmoid: compute the would-be display after a linear add,
 *     then back-project to logit. Sigmoid compression happens
 *     naturally — a +1 event at display 8 lands closer to display
 *     8.6 than to 9; the same +1 event at display 2 lands closer
 *     to 3. The slider asymptotes to the bounds but never reaches
 *     them.
 *
 *   - linear: display += deltaDisplay verbatim, clamped to the
 *     open interval. Cheaper but no diminishing returns.
 */
export function applyEvent(
  s: Slider,
  event: number,
  config: SliderConfig = DEFAULT_SLIDER_CONFIG,
): Slider {
  if (!Number.isFinite(event) || event === 0) return s;
  if (config.mode === "linear") {
    // Linear: event is in display units, added directly. No
    // compression — the slider clamps at the open-interval bounds.
    const next = clampDisplay(display(s) + event);
    return { ...s, value: displayToLogit(next) };
  }
  // Sigmoid: logistic-growth. Scale the event by the headroom in
  // the direction of motion, so motion toward an edge slows as the
  // edge approaches, while motion away from an edge stays free.
  const cur = display(s);
  const headroom = event > 0 ? DISPLAY_MAX - cur : cur;
  const displayDelta = event * config.eventScale * (headroom / DISPLAY_MAX);
  const next = clampDisplay(cur + displayDelta);
  return { ...s, value: displayToLogit(next) };
}

/**
 * Tolerance update. `direction` says whether this is a "high-side"
 * episode (e.g., a binge) or a "low-side" one (e.g., a starvation
 * episode the ghost survived). The setpoint moves toward the side
 * of past excess by `toleranceStep` per unit, capped at
 * `toleranceMax`.
 *
 * High-side example (Fuel): each completed binge episode pushes
 * `tolerance += 1`, which pushes `setpoint` up by `toleranceStep`,
 * which means a previously-satiated Fuel level now reads as
 * hungry. That's the addiction loop.
 */
export function incrementTolerance(
  s: Slider,
  direction: "high" | "low",
  config: SliderConfig,
): Slider {
  if (config.toleranceStep <= 0 || config.toleranceMax <= 0) return s;
  const step = direction === "high" ? 1 : -1;
  const nextTolerance = clamp(
    s.tolerance + step,
    -config.toleranceMax,
    config.toleranceMax,
  );
  if (nextTolerance === s.tolerance) return s;
  const setpointShift = (nextTolerance - 0) * config.toleranceStep;
  return {
    ...s,
    tolerance: nextTolerance,
    setpoint: config.baseSetpoint + setpointShift,
  };
}

function clampDisplay(d: number): number {
  return Math.min(DISPLAY_MAX - DISPLAY_EPSILON, Math.max(DISPLAY_EPSILON, d));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
