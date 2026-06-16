/**
 * Pick which facets get a voice on this cascade — instead of asking
 * the ghost to embody all 8, only the ones whose sliders are
 * actively moving on the relevant axis get to express. The static
 * facets stay quiet.
 *
 * "Movement" on a cascade has two sources:
 *   1. Facet adjustments emitted by the facet agents (applied to
 *      the slider via `applyDelta`), recorded as
 *      `AppliedAdjustment` with `before/afterDisplay`.
 *   2. Primal-need-driven drift from the substrate's
 *      primal→personality wiring, recorded as `PrimalForce` with a
 *      `logitDelta`.
 *
 * We sum the absolute movement per facet on the requested axis,
 * sort, and take the top K. When fewer than K facets moved last
 * cascade (typical: cascade 1, or any cascade where the personality
 * was static), we fall back to "top K by distance from the
 * midpoint on this axis" — the most distinctive facets of the
 * ghost's standing personality.
 */

import {
  STARTER_FACETS,
  toDisplay,
  type AppliedAdjustment,
  type Axis,
  type FacetName,
  type PersonalityState,
} from "@aie-matrix/ghost-peppers-inner";

/** Compact summary the run-loop captures so the next cascade can
 *  pick its active facets. */
export interface RecentMovement {
  readonly applied: ReadonlyArray<AppliedAdjustment>;
  readonly primalForces: ReadonlyArray<{
    readonly edge: { readonly targetFacet: FacetName; readonly targetAxis: Axis };
    readonly logitDelta: number;
  }>;
}

/** Sum |movement| per facet on the given axis from a prior cascade's
 *  applied adjustments + primal forces. Returns a map; absent facets
 *  did not move. */
export function priorMovementByFacet(
  prior: RecentMovement | undefined,
  axis: Axis,
): ReadonlyMap<FacetName, number> {
  const m = new Map<FacetName, number>();
  if (!prior) return m;
  for (const a of prior.applied) {
    if (a.axis !== axis) continue;
    const delta = Math.abs(a.afterDisplay - a.beforeDisplay);
    if (delta === 0) continue;
    m.set(a.facet, (m.get(a.facet) ?? 0) + delta);
  }
  for (const f of prior.primalForces) {
    if (f.edge.targetAxis !== axis) continue;
    const delta = Math.abs(f.logitDelta);
    if (delta === 0) continue;
    m.set(f.edge.targetFacet, (m.get(f.edge.targetFacet) ?? 0) + delta);
  }
  return m;
}

/**
 * Pick K facets to give a voice this cascade. Top by prior-cascade
 * movement on the given axis; pad with most-extreme-from-midpoint
 * when fewer than K moved.
 */
export function selectActiveFacets(
  movementByFacet: ReadonlyMap<FacetName, number>,
  personality: PersonalityState,
  axis: Axis,
  k = 2,
): ReadonlyArray<FacetName> {
  const moved = Array.from(movementByFacet.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f)
    .slice(0, k);
  if (moved.length >= k) return moved;
  // Pad with the facets standing furthest from the midpoint on this
  // axis (the ghost's most distinctive standing traits).
  const remaining = STARTER_FACETS.filter((f) => !moved.includes(f))
    .map((f) => ({
      f,
      distance: Math.abs(toDisplay(personality[f][axis]) - 5),
    }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, k - moved.length)
    .map((x) => x.f);
  return [...moved, ...remaining];
}
