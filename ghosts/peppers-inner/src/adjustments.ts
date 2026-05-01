/**
 * Adjustment value types for the Id pipeline.
 *
 * The original strict validator (≥1 up + ≥1 down per cascade, with a
 * 2-up/2-down budget) was retired with the modular Id pipeline — each
 * facet agent now owns its own slider and decides independently, so
 * there's no global balance to enforce. What's left here is the
 * minimal data shape: what an adjustment is, and what an applied one
 * carries for logging.
 *
 * Apply via `applyDelta` (sliders.ts) per facet — see
 * `peppers-house/src/run-loop.ts` for the per-facet apply loop.
 */

import type { Direction } from "./sliders.js";
import type { Axis, FacetName } from "./facets.js";

/** A proposed single adjustment — facet × axis × direction. */
export interface Adjustment {
  readonly facet: FacetName;
  readonly axis: Axis;
  readonly direction: Direction;
}

/** Record of an applied adjustment with its before/after display values. */
export interface AppliedAdjustment extends Adjustment {
  readonly beforeDisplay: number;
  readonly afterDisplay: number;
}
