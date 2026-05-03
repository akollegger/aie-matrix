/**
 * 2D emotional slider math per RFC-0007.
 *
 * Values are stored in unbounded logit space and displayed as sigmoid-
 * normalized reals in the open interval (0, 10). A fixed `±δ` step in
 * logit space produces naturally diminishing returns near saturation,
 * without any explicit clamping. Sliders never reach 0 or 10 — they
 * asymptote.
 */

/** Which axis of a two-slider trait a value belongs to. */
export type Axis = "internal" | "external";

/** Either direction of a binary Id-adjustment. */
export type Direction = "up" | "down";

/**
 * Opaque slider value. The `logit` field is the canonical storage;
 * display conversion is always through {@link toDisplay}.
 */
export interface SliderValue {
  readonly logit: number;
}

/** Lower bound of the displayed range. Sliders asymptote to but never reach 0. */
export const DISPLAY_MIN = 0;
/** Upper bound of the displayed range. Sliders asymptote to but never reach 10. */
export const DISPLAY_MAX = 10;
/** Midpoint of the displayed range; logit 0. */
export const DISPLAY_MIDPOINT = 5;
/** Default adjustment magnitude in logit space. */
export const DEFAULT_DELTA = 0.5;

/**
 * The midpoint slider: display 5.0, logit 0. This is the ataraxic
 * baseline — neither high nor low, just extant.
 */
export function midpoint(): SliderValue {
  return { logit: 0 };
}

/**
 * Convert a display value in the open interval (0, 10) to its
 * logit-space representation.
 *
 * @throws RangeError if `display` is not in the open interval (0, 10).
 */
export function fromDisplay(display: number): SliderValue {
  if (!Number.isFinite(display) || display <= DISPLAY_MIN || display >= DISPLAY_MAX) {
    throw new RangeError(
      `display must be in open interval (${DISPLAY_MIN}, ${DISPLAY_MAX}); got ${display}`,
    );
  }
  const p = display / DISPLAY_MAX;
  return { logit: Math.log(p / (1 - p)) };
}

/** Convert a slider value to its display representation in (0, 10). */
export function toDisplay(value: SliderValue): number {
  return DISPLAY_MAX / (1 + Math.exp(-value.logit));
}

/**
 * Apply a single Id-adjustment: a fixed ±δ step in logit space.
 * Returns a new slider; the input is unchanged.
 */
export function applyDelta(
  value: SliderValue,
  direction: Direction,
  delta: number = DEFAULT_DELTA,
): SliderValue {
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new RangeError(`delta must be a positive finite number; got ${delta}`);
  }
  const step = direction === "up" ? delta : -delta;
  return { logit: value.logit + step };
}
