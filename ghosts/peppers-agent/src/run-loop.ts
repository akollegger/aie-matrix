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
  type Commitment,
  type CommitmentLedger,
  type FacetName,
  type PersonalityState,
  type Stimulus,
  type SurfaceAction,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

import {
  fetchRecentCascades,
  persistCascade,
  persistCommitmentEvaluation,
  type MemoryClientHandle,
} from "@aie-matrix/ghost-peppers-mem";

import { invokeCommitment, type CommitmentEvaluation } from "./reason-id-commitment.js";
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
  /** Commitment evaluator output for this cascade — may be null when
   *  the evaluator was skipped (e.g. dry-run or disabled). */
  readonly commitment: CommitmentEvaluation | null;
  /** Ledger snapshot AFTER this cascade — satisfied items removed,
   *  newly minted items appended, expired items pruned. */
  readonly nextLedger: CommitmentLedger;
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
  /** Persistent display name (e.g. "Django Decypher"). Threaded into
   *  Synthesis + Surface prompts so the LLM has the ghost's actual
   *  identity anchored. Without this, the cascade reaches for whatever
   *  ghost_<prefix> drifts in from a stimulus. */
  readonly selfDisplayName?: string;
  /** Last N super-objectives from prior cascades — passed into the
   *  Id's convergence stage so committed plans persist across ticks. */
  readonly recentSuperObjectives?: ReadonlyArray<string>;
  /** Authoritative tool menu, discovered via `mcp.listTools()` at
   *  runHouse startup. Passed straight to Surface — the LLM picks
   *  from this real menu, not a prompt-curated list. */
  readonly tools: ReadonlyArray<import("./llm-client.js").ToolSchema>;
  /** Current open commitments. Surfaced into the Surface prompt as
   *  "debts to yourself" and forwarded to the commitment evaluator
   *  for satisfaction checks. Defaults to empty. */
  readonly commitmentLedger?: CommitmentLedger;
  /** Monotonic cascade counter — stamped onto new commitments and
   *  used to expire stale ones. Required when `commitmentLedger`
   *  evaluation is active. */
  readonly cascadeIndex?: number;
  /** Maximum cascades a commitment may live unsatisfied before being
   *  auto-expired. Default 10. */
  readonly commitmentMaxAge?: number;
}

/**
 * Apply each facet's optional delta to its own slider. Replacement for
 * the inner package's `applyAdjustments`, which enforces the global
 * ≥1-up + ≥1-down rule that doesn't fit the modular Id pipeline (each
 * facet agent decides independently for its own slider).
 */
export function applyAdjustmentsPerFacet(
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
  const ledgerIn: CommitmentLedger = req.commitmentLedger ?? [];
  const cascadeIndex = req.cascadeIndex ?? 0;
  const maxAge = req.commitmentMaxAge ?? 10;

  // 1. Pull recent reasoning context for the Id.
  const recentCascades = await fetchRecentCascades(memoryHandle.client, ghostId, historyDepth);

  // 2. Id composes monologue + adjustments.
  const id = await invokeId({
    personality: state,
    stimulus,
    recentCascades,
    worldContext: req.worldContext,
    objective: req.objective,
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
    ...(req.recentSuperObjectives && req.recentSuperObjectives.length > 0
      ? { recentSuperObjectives: req.recentSuperObjectives }
      : {}),
  });

  // 3. Surface picks a tool from the live MCP menu using OpenAI's
  //    tool-calling API. No curated action list — the LLM sees the
  //    actual tools the world exposes.
  const surface = await invokeSurface({
    monologue: id.monologue,
    stimulus,
    worldContext: req.worldContext,
    objective: req.objective,
    tools: req.tools,
    commitments: ledgerIn,
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
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

  // 8. Commitment evaluation — runs AFTER the cascade is recorded so
  //    the ledger reflects what actually happened. The evaluator reads
  //    the monologue (private intent) and compares to the surface
  //    action (public behavior); commitments form only when the inner
  //    voice meant it, never from social-lubricant speech alone.
  let commitment: CommitmentEvaluation | null = null;
  let nextLedger: CommitmentLedger = ledgerIn;
  try {
    commitment = await invokeCommitment({
      monologue: id.monologue,
      action: surface.action,
      actionSucceeded: outcome.ok,
      ledger: ledgerIn,
      cascadeIndex,
      ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
    });
    nextLedger = reconcileLedger(
      ledgerIn,
      commitment.satisfiedIds,
      commitment.newCommitments,
      cascadeIndex,
      maxAge,
    );
    // Mirror the evaluation into the graph so a later cascade can
    // Cypher-query a ghost's commitment history. Satisfied entries
    // carry the original `owed` text so a query doesn't need a join.
    const satisfiedSet = new Set(commitment.satisfiedIds);
    const satisfiedDetails = ledgerIn
      .filter((c) => satisfiedSet.has(c.id))
      .map((c) => ({ id: c.id, owed: c.owed }));
    await persistCommitmentEvaluation(
      memoryHandle.client,
      ghostId,
      cascadeIndex,
      satisfiedDetails,
      commitment.newCommitments,
    );
  } catch (err) {
    // Evaluator failure must not crash the cascade — the ghost just
    // keeps the prior ledger and tries again next turn. The error
    // surfaces in the returned `commitment: null` so the runtime can
    // log it.
    void err;
    commitment = null;
    nextLedger = expireStaleCommitments(ledgerIn, cascadeIndex, maxAge);
  }

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
    commitment,
    nextLedger,
  };
}

/**
 * Apply this cascade's satisfactions, then drop expired entries, then
 * append the freshly minted commitments. Order matters: a commitment
 * minted THIS cascade can't be both satisfied AND new in the same
 * step (the evaluator only checks `satisfiedIds` against the ledger
 * snapshot that was passed in).
 *
 * Exported so the test suite can verify the reconciliation rules
 * without standing up the full cascade.
 */
export function reconcileLedger(
  prior: CommitmentLedger,
  satisfiedIds: ReadonlyArray<string>,
  newCommitments: ReadonlyArray<Commitment>,
  cascadeIndex: number,
  maxAge: number,
): CommitmentLedger {
  const satisfiedSet = new Set(satisfiedIds);
  const survived = prior.filter((c) => !satisfiedSet.has(c.id));
  const unexpired = survived.filter(
    (c) => cascadeIndex - c.bornAtCascade <= maxAge,
  );
  return [...unexpired, ...newCommitments];
}

function expireStaleCommitments(
  prior: CommitmentLedger,
  cascadeIndex: number,
  maxAge: number,
): CommitmentLedger {
  return prior.filter((c) => cascadeIndex - c.bornAtCascade <= maxAge);
}
