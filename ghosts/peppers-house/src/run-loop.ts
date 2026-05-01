/**
 * One-stimulus interaction loop: stimulus → Id → Surface → mocked
 * world reply → cascade build & persist → updated state.
 *
 * This is the smallest end-to-end behavior unit. It assumes a single
 * ghost, a stimulus already framed as a `Stimulus` value, and a live
 * Agent Memory MCP connection. Multi-ghost dynamics, the real world
 * API, and Aura-Agents-hosted reasoning are later milestones.
 */

import {
  CascadeBuilder,
  DEFAULT_DELTA,
  applyDelta,
  createExternalStimulusEvent,
  toDisplay,
  type ActionOutcome,
  type Adjustment,
  type AppliedAdjustment,
  type CascadeTrace,
  type FacetName,
  type PersonalityState,
  type Stimulus,
  type SurfaceAction,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

import {
  fetchRecentCascades,
  persistCascade,
  type MemoryClientHandle,
} from "@aie-matrix/ghost-peppers-mem";

import { invokeId, type IdReasoning } from "./reason-id.js";
import { invokeSurface, type SurfaceReasoning, type WorldContext } from "./reason-surface.js";

/**
 * Executes a Surface action against the world (real MCP, mock, or
 * any other adapter that returns an `ActionOutcome`). Allowed to be
 * sync or async.
 */
export type ExecuteAction = (action: SurfaceAction) => Promise<ActionOutcome> | ActionOutcome;

/** Aggregated debug record of one interaction step. */
export interface RunRecord {
  readonly ghostId: string;
  readonly stimulus: Stimulus;
  readonly id: IdReasoning;
  readonly surface: SurfaceReasoning;
  readonly action: SurfaceAction;
  readonly outcome: ActionOutcome;
  readonly applied: readonly AppliedAdjustment[];
  readonly nextState: PersonalityState;
  readonly trace: CascadeTrace;
}

/** Inputs to one interaction step. */
export interface RunOneStimulusRequest {
  readonly memoryHandle: MemoryClientHandle;
  readonly ghostId: string;
  readonly state: PersonalityState;
  readonly stimulus: Stimulus;
  /** Adapter that runs the chosen Surface action against the world. */
  readonly executeAction: ExecuteAction;
  /** Optional world snapshot passed to the Surface for grounded action choice. */
  readonly worldContext?: WorldContext;
  /** What the ghost is in the world to do. Forwarded to both Id and Surface. */
  readonly objective?: string;
  /** How many recent cascades to pass into the Id as context. Default 3. */
  readonly historyDepth?: number;
}

/**
 * Apply each facet's optional delta to its own slider. Replacement for
 * the inner package's `applyAdjustments`, which enforces the global
 * ≥1-up + ≥1-down rule that doesn't fit the modular Id pipeline (each
 * facet agent decides independently for its own slider).
 */
function applyAdjustmentsPerFacet(
  state: PersonalityState,
  adjustments: readonly Adjustment[],
): { state: PersonalityState; applied: readonly AppliedAdjustment[] } {
  const next: Record<FacetName, TraitState> = { ...state };
  const applied: AppliedAdjustment[] = [];
  for (const a of adjustments) {
    const trait = next[a.facet];
    const beforeValue = trait[a.axis];
    const afterValue = applyDelta(beforeValue, a.direction, DEFAULT_DELTA);
    next[a.facet] = { ...trait, [a.axis]: afterValue };
    applied.push({
      ...a,
      beforeDisplay: toDisplay(beforeValue),
      afterDisplay: toDisplay(afterValue),
    });
  }
  return { state: next, applied };
}

export async function runOneStimulus(req: RunOneStimulusRequest): Promise<RunRecord> {
  const { memoryHandle, ghostId, state, stimulus, executeAction } = req;
  // Default depth=3 — the modular Id pipeline pulls *trigger* strings
  // from these cascades (not monologues) and feeds them to each facet
  // agent as trajectory. Three steps gives a feel for direction
  // without overwhelming.
  const historyDepth = req.historyDepth ?? 3;

  // 1. Pull recent reasoning context for the Id.
  const recentCascades = await fetchRecentCascades(memoryHandle.client, ghostId, historyDepth);

  // 2. Id composes monologue + adjustments.
  const id = await invokeId({
    personality: state,
    stimulus,
    recentCascades,
    worldContext: req.worldContext,
    objective: req.objective,
  });

  // 3. Surface picks an action from the monologue + raw stimulus + world context.
  const surface = await invokeSurface({
    monologue: id.monologue,
    stimulus,
    worldContext: req.worldContext,
    objective: req.objective,
  });

  // 4. Execute the action against the world.
  const outcome = await executeAction(surface.action);

  // 5. Apply slider adjustments — one per facet at most. The legacy
  // ≥1-up + ≥1-down rule no longer applies: each facet agent owns its
  // own slider and decides independently, so no global balance is
  // enforced. Empty adjustment lists and same-direction-only batches
  // are valid; the personality just doesn't move (or moves uniformly)
  // this cascade.
  const { state: nextState, applied } = applyAdjustmentsPerFacet(state, id.adjustments);

  // 6. Build the cascade record.
  const trigger = createExternalStimulusEvent(stimulus);
  const builder = new CascadeBuilder(ghostId, trigger);

  builder.addThought({ role: "monologue", content: id.monologue });
  builder.addSurfaceAction(surface.action, outcome);
  for (const a of applied) {
    builder.addAdjustment(a);
  }
  const trace = builder.complete();

  // 7. Persist to Agent Memory (event substrate + reasoning tier).
  await persistCascade(memoryHandle.client, trace);

  return {
    ghostId,
    stimulus,
    id,
    surface,
    action: surface.action,
    outcome,
    applied,
    nextState,
    trace,
  };
}
