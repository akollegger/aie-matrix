/**
 * Wiring from primal needs (Fuel, eventually Coherence + Rest) into
 * the personality (feeling) sliders.
 *
 * The mechanism is **dynamics-driven**, NOT position-driven. A ghost
 * sitting stably at any Fuel level emits no signal. What pushes
 * personality is *direction of motion in Fuel*: sustained net gain
 * pushes affected traits up, sustained net loss pushes them down.
 * This is the mechanism by which a rich-and-stable ghost and a
 * poor-and-stable ghost can both have cold personalities without the
 * system encoding "scarcity → cold" as a stereotype.
 *
 * Per cascade, per `(primal, target_slider)` edge:
 *
 *   1. net_flux       = Fuel.display(now) − Fuel.display(prev-cascade)
 *   2. event_sign     = sign(net_flux)                  // +1 or −1; never 0
 *   3. streak update:
 *        if streak × event_sign < 0:                    // event opposes streak
 *          streak += event_sign × recovery_multiplier   // escape velocity
 *        else:
 *          streak += event_sign                          // compound
 *   4. force_logit    = streak × |net_flux| × base_step × edge_direction
 *   5. slider.logit  += force_logit                      // sigmoid resists naturally
 *
 * The recovery multiplier (default 2) means a ghost stuck at streak
 * −10 needs only 5 sustained `+` cascades to reach 0, not 10. This
 * captures the asymmetry between getting deep into stress (slow,
 * compounding) and reactively recovering (faster). Note that the
 * STREAK resets faster than the SLIDER POSITION — a slider that has
 * cumulatively drifted to a sigmoid extreme stays there even after
 * the streak has reset, which is how "stuck ghosts" naturally emerge.
 *
 * `base_step` is the tuning knob for cumulative drift speed (how
 * easily ghosts reach pinned positions). `recovery_multiplier` tunes
 * how easily ghosts can shake off accumulated stress.
 *
 * Edges are NOT one-to-one. One primal can influence multiple
 * personality sliders; one slider can receive contributions from
 * multiple primals (when Coherence + Rest are added). The shape is
 * a graph, configured here as an array.
 */

import type { Axis } from "./sliders.js";
import type { FacetName } from "./facets.js";
import type { NeedName } from "./needs.js";

/** A single edge from a primal source to a personality slider. */
export interface PrimalPersonalityEdge {
  readonly source: NeedName;
  readonly targetFacet: FacetName;
  readonly targetAxis: Axis;
  /**
   * +1 = "follows" — trait moves the same direction as the primal's
   * dynamic sign (sustained gain pushes up, sustained loss pushes
   * down).
   * −1 = "opposes" — trait moves opposite to the primal's dynamic
   * sign. Reserved for edges where this makes specific biological
   * sense; default for new edges should be +1.
   */
  readonly direction: 1 | -1;
}

/** Stringified edge key used by the streak state map. */
export function primalEdgeKey(edge: PrimalPersonalityEdge): string {
  return `${edge.source}:${edge.targetFacet}.${edge.targetAxis}`;
}

/** Per-ghost streak state: signed integer per edge key. */
export type PrimalPersonalityStreaks = Readonly<Record<string, number>>;

/**
 * Default edges from Fuel. Coherence and Rest get their own edges
 * later when their designs are settled. Each edge is "follows" — the
 * direction comes from the streak's sign, not from any positional
 * assumption. The cultural-bias resolution lives upstream in the
 * dynamics-based trigger; nothing here encodes "hungry = cold."
 */
export const DEFAULT_PRIMAL_PERSONALITY_EDGES: ReadonlyArray<PrimalPersonalityEdge> = [
  { source: "Fuel", targetFacet: "Warmth", targetAxis: "internal", direction: 1 },
  { source: "Fuel", targetFacet: "Trust", targetAxis: "internal", direction: 1 },
  { source: "Fuel", targetFacet: "Altruism", targetAxis: "external", direction: 1 },
  { source: "Fuel", targetFacet: "Stability", targetAxis: "internal", direction: 1 },
];

/**
 * Default base-step coefficient: how many logit-units of slider force
 * one (streak × magnitude × 1) unit produces. Small so a single
 * cascade barely registers; sustained streaks accumulate cumulatively.
 *
 * With NEEDS_RUSH=15, typical Fuel magnitudes are ~0.75 (depletion
 * without eating) or ~0.25 (one bite covers depletion plus a small
 * surplus). At streak=5 and magnitude=0.75: force = 5×0.75×0.01 =
 * 0.0375 logit per cascade. Five cascades like that = 0.1875 logit
 * cumulative — noticeable on the overlay but not transformative.
 */
export const DEFAULT_PRIMAL_BASE_STEP = 0.01;

/**
 * Recovery multiplier — how much faster a streak unwinds when an
 * opposing event arrives, vs. how slowly it built up. Default 2:
 * a ghost at streak −10 needs only 5 sustained `+` cascades to
 * reach 0.
 */
export const DEFAULT_PRIMAL_RECOVERY_MULTIPLIER = 2;

/**
 * Empty streak state — all edges at 0. Use at ghost birth or when
 * resetting.
 */
export function emptyPrimalStreaks(
  edges: ReadonlyArray<PrimalPersonalityEdge> = DEFAULT_PRIMAL_PERSONALITY_EDGES,
): PrimalPersonalityStreaks {
  const out: Record<string, number> = {};
  for (const edge of edges) out[primalEdgeKey(edge)] = 0;
  return out;
}

/**
 * Per-cascade flux from each primal. Currently Fuel only; extend
 * when Coherence and Rest dynamic-wiring lands.
 */
export interface PrimalFlux {
  readonly Fuel: number;
}

/**
 * Compute one cascade's streak update for every edge whose `source`
 * has a non-zero entry in `flux`. Edges whose source is missing or
 * exactly zero are skipped (no event fires).
 *
 * The compounding-vs-recovery asymmetry is the only nuance:
 *   - When the event matches the current streak's sign (or streak is
 *     0): `streak += event_sign`. Linear compound.
 *   - When the event opposes: `streak += event_sign × recovery`.
 *     Faster unwind.
 */
export function updateStreaks(
  prev: PrimalPersonalityStreaks,
  flux: PrimalFlux,
  edges: ReadonlyArray<PrimalPersonalityEdge> = DEFAULT_PRIMAL_PERSONALITY_EDGES,
  recoveryMultiplier: number = DEFAULT_PRIMAL_RECOVERY_MULTIPLIER,
): PrimalPersonalityStreaks {
  const out: Record<string, number> = { ...prev };
  for (const edge of edges) {
    const f = flux[edge.source as keyof PrimalFlux];
    if (f === undefined || f === 0) continue;
    const eventSign = f > 0 ? 1 : -1;
    const key = primalEdgeKey(edge);
    const cur = out[key] ?? 0;
    if (cur * eventSign < 0) {
      out[key] = cur + eventSign * recoveryMultiplier;
    } else {
      out[key] = cur + eventSign;
    }
  }
  return out;
}

/**
 * Single force entry — the cascade-final logit delta for one edge.
 * Sign carries direction (push up vs push down). Magnitude reflects
 * `streak × |flux| × base_step × edge_direction`.
 */
export interface PrimalForce {
  readonly edge: PrimalPersonalityEdge;
  readonly logitDelta: number;
}

/**
 * For each edge, compute the per-cascade logit force to apply to its
 * target slider. Edges with streak=0 or |flux|=0 contribute nothing
 * (filtered out). Apply the resulting deltas to the personality
 * sliders via `applyDelta` or the equivalent.
 */
export function computePrimalForces(
  streaks: PrimalPersonalityStreaks,
  flux: PrimalFlux,
  edges: ReadonlyArray<PrimalPersonalityEdge> = DEFAULT_PRIMAL_PERSONALITY_EDGES,
  baseStep: number = DEFAULT_PRIMAL_BASE_STEP,
): ReadonlyArray<PrimalForce> {
  const out: PrimalForce[] = [];
  for (const edge of edges) {
    const f = flux[edge.source as keyof PrimalFlux];
    if (f === undefined || f === 0) continue;
    const streak = streaks[primalEdgeKey(edge)] ?? 0;
    if (streak === 0) continue;
    const magnitude = Math.abs(f);
    const logitDelta = streak * magnitude * baseStep * edge.direction;
    if (logitDelta !== 0) out.push({ edge, logitDelta });
  }
  return out;
}
