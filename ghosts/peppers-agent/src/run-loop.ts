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
  DEFAULT_NEED_DEPLETION,
  DEFAULT_PRIMAL_PERSONALITY_EDGES,
  adjustNeed,
  applyCascadeDepletion,
  applyDelta,
  computePrimalForces,
  createExternalStimulusEvent,
  emptyPrimalStreaks,
  midpointNeeds,
  toDisplay,
  updateStreaks,
  type ActionOutcome,
  type Adjustment,
  type AppliedAdjustment,
  type CascadeTrace,
  type Commitment,
  type CommitmentLedger,
  type FacetName,
  type NeedName,
  type NeedProfile,
  type PersonalityState,
  type PrimalForce,
  type PrimalPersonalityEdge,
  type PrimalPersonalityStreaks,
  type Stimulus,
  type SurfaceAction,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

import {
  fetchOccupantImpressions,
  fetchRecentActionDigest,
  fetchRecentCascades,
  fetchRecentDialogueWith,
  persistCascade,
  persistCommitmentEvaluation,
  persistImpressions,
  type ActionDigestEntry,
  type CascadeReplay,
  type DialogueTurn,
  type ImpressionView,
  type MemoryClientHandle,
} from "@aie-matrix/ghost-peppers-mem";

function formatErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

import { invokeCommitment, type CommitmentEvaluation } from "./reason-id-commitment.js";
import { invokeId, type IdReasoning } from "./reason-id.js";
import { invokeSurface, type SurfaceReasoning, type WorldContext } from "./reason-surface.js";

/**
 * Debug-only time-compression for the primal-need dynamics.
 *
 * Set `PEPPERS_NEEDS_RUSH=N` to multiply every depletion AND
 * replenishment magnitude by N. The shape of the system is preserved
 * (idle ghosts still gain Rest faster than active ones lose it,
 * Fuel-only mortality still holds); only the time-to-observe is
 * compressed.
 *
 *   PEPPERS_NEEDS_RUSH=1   (default)  ~10 min to first decommission
 *   PEPPERS_NEEDS_RUSH=5             ~2 min — recommended debug speed
 *   PEPPERS_NEEDS_RUSH=10            ~1 min — quick smoke test
 *   PEPPERS_NEEDS_RUSH=20            ~30 sec — useful for cascade timing
 *
 * Values <= 0 or non-numeric reset to 1.
 */
const NEEDS_RUSH: number = (() => {
  const raw = process.env.PEPPERS_NEEDS_RUSH;
  if (!raw) return 1;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n !== 1) {
    console.info(
      `[peppers-run-loop] PEPPERS_NEEDS_RUSH=${n} — primal-need dynamics scaled ${n}×`,
    );
  }
  return n;
})();

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
  /** Primal need profile AFTER this cascade — per-cascade depletion
   *  has been applied. Callers thread this back into the next
   *  cascade's `needs` to keep depletion continuous. */
  readonly nextNeeds: NeedProfile;
  /** Primal-personality streak state AFTER this cascade. Threaded
   *  forward via `req.primalStreaks` on the next call so streaks
   *  compound across cascades and survive pause/resume. */
  readonly nextPrimalStreaks: PrimalPersonalityStreaks;
  /** Per-cascade flux per primal — the signed delta in display
   *  between this cascade's end-state and the previous one's. The
   *  trigger for the primal→personality wiring. */
  readonly primalFlux: { Fuel: number };
  /** The actual logit deltas applied to personality sliders this
   *  cascade by the primal wiring. Empty when nothing fired (e.g.
   *  zero flux, zero streak). Captured for inspection. */
  readonly primalForces: ReadonlyArray<PrimalForce>;
  /** Accumulated metabolic strain AFTER this cascade. State-based,
   *  not dynamic — ticks up while Fuel.display sits above the binge
   *  threshold (7) and decays slowly while below. When strain crosses
   *  `METABOLIC_STRAIN_DEATH_THRESHOLD` the caller decommissions the
   *  ghost with cause `metabolic-collapse` (separately from acute
   *  Fuel=0 starvation). Distinct from `nextPrimalStreaks` — strain
   *  measures the *state* of chronic harm, streaks measure the
   *  *dynamics* of changing fortune. Both can fire independently. */
  readonly nextMetabolicStrain: number;
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
  /** Primal need state at the START of this cascade. The cascade
   *  depletes the needs by the configured per-cascade rates and
   *  returns the post-depletion profile in `RunRecord.nextNeeds`.
   *  Defaults to midpoint (a fully satiated ghost) when omitted —
   *  callers that want continuity across cascades MUST pass the
   *  previous cascade's `nextNeeds` here. */
  readonly needs?: NeedProfile;
  /** Per-cascade depletion rates (logit-space). Defaults to
   *  `DEFAULT_NEED_DEPLETION` from peppers-inner. Exposed so callers
   *  can run hungrier ghosts (faster decay) for testing. */
  readonly needDepletion?: Readonly<Record<NeedName, number>>;
  /** Primal-personality streak state at the START of this cascade.
   *  Defaults to empty (zero per edge) when omitted. Callers that
   *  want streaks to compound across cascades MUST pass the previous
   *  cascade's `nextPrimalStreaks` here. */
  readonly primalStreaks?: PrimalPersonalityStreaks;
  /** Edges driving the primal→personality wiring. Defaults to
   *  `DEFAULT_PRIMAL_PERSONALITY_EDGES` (Fuel → 4 traits). */
  readonly primalEdges?: ReadonlyArray<PrimalPersonalityEdge>;
  /** Metabolic strain at the START of this cascade. Default: 0 (a
   *  fresh ghost). Threaded forward to persist across cascades and
   *  pause/resume. */
  readonly metabolicStrain?: number;
}

/**
 * Chronic-overeating wiring. Strain accumulates per cascade based on
 * how far Fuel.display is above the binge threshold (7), and decays
 * slowly per cascade below it. When strain crosses
 * `METABOLIC_STRAIN_DEATH_THRESHOLD`, the ghost decommissions with
 * cause "metabolic-collapse" — distinct from the acute "fuel-critical"
 * death at Fuel=0.
 *
 * This is a STATE-based mechanic, intentionally parallel to the
 * dynamics-based streak system. A ghost SITTING at Fuel=10 produces
 * flux=0 once the streak has saturated, but their *state* is still
 * binge — so strain accumulates regardless of whether the streak
 * compounds further.
 */
export const METABOLIC_BINGE_THRESHOLD = 7;
export const METABOLIC_STRAIN_PER_DISPLAY_PER_CASCADE = 1.0;
export const METABOLIC_STRAIN_RECOVERY_PER_CASCADE = 0.5;
// Tuned to fire within an observable window. Strain rate is 1.0 ×
// (Fuel.display − 7), so a ghost pegged at Fuel 10 gets 3/cascade and
// dies in ~10 cascades; at Fuel 8 they get 1/cascade and survive ~30.
// Bump higher (50–100) for slower, more chronic dynamics once the
// behaviour is confirmed.
export const METABOLIC_STRAIN_DEATH_THRESHOLD = 30;

/**
 * Apply each facet's optional delta to its own slider. Replacement for
 * the inner package's `applyAdjustments`, which enforces the global
 * ≥1-up + ≥1-down rule that doesn't fit the modular Id pipeline (each
 * facet agent decides independently for its own slider).
 *
 * `delta` defaults to `DEFAULT_DELTA` but can be scaled down by the
 * caller — the Rest primal need uses this to damp personality drift
 * when the ghost can't consolidate. At Rest display < 2 the caller
 * passes a small fraction so drift effectively stops.
 */
export function applyAdjustmentsPerFacet(
  state: PersonalityState,
  adjustments: readonly Adjustment[],
  delta: number = DEFAULT_DELTA,
): { state: PersonalityState; applied: readonly AppliedAdjustment[] } {
  const next: Record<FacetName, TraitState> = { ...state };
  const applied: AppliedAdjustment[] = [];
  for (const a of adjustments) {
    const trait = next[a.facet];
    const beforeValue = trait[a.axis];
    const afterValue = applyDelta(beforeValue, a.direction, delta);
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
  const needsIn: NeedProfile = req.needs ?? midpointNeeds();
  // Apply the debug-only rush multiplier to every default rate.
  // Explicit callers (e.g. testing) can pass their own untouched rates
  // via `req.needDepletion`.
  const depletionRates =
    req.needDepletion ??
    ({
      Fuel: DEFAULT_NEED_DEPLETION.Fuel * NEEDS_RUSH,
      Coherence: DEFAULT_NEED_DEPLETION.Coherence * NEEDS_RUSH,
      Rest: DEFAULT_NEED_DEPLETION.Rest * NEEDS_RUSH,
    } satisfies Record<NeedName, number>);

  // Coherence → historyDepth: scale the recent-cascade context the Id
  // gets to see. Stepped to avoid the previous formula's aggressive
  // tail — at display ≥ 3 the ghost gets full history (so a slightly
  // depleted Coherence doesn't already cause amnesia). Drops to 2 / 1
  // as it deepens; only bottoms to 0 at genuinely critical levels.
  const coherenceDisplay = needsIn.Coherence.display;
  let coherenceCap: number;
  if (coherenceDisplay >= 3) coherenceCap = historyDepth;
  else if (coherenceDisplay >= 2) coherenceCap = 2;
  else if (coherenceDisplay >= 1) coherenceCap = 1;
  else coherenceCap = 0;
  const effectiveHistoryDepth = Math.min(historyDepth, coherenceCap);

  // Rest → memory-write skip + slider-drift damping. Memory skip
  // threshold lifted from 2.0 → 1.0: only at genuinely critical Rest
  // does the ghost stop consolidating. The earlier 2.0 cutoff caused
  // a doom-spiral (memory skipped → next cascade has no context →
  // amnesia → ghosts lose social thread → talk-loops fail). Slider
  // drift damping is more forgiving and remains continuous.
  const restDisplay = needsIn.Rest.display;
  const memoryWritesEnabled = restDisplay >= 1.0;
  // Display 5 → 1.0× normal drift; display 1 → 0.2×; floor 0.1×.
  const driftMultiplier = Math.max(0.1, Math.min(1.0, restDisplay / 5));
  const driftDelta = DEFAULT_DELTA * driftMultiplier;

  // Surface depth: the dialogue / actions / impressions blocks share
  // Coherence's gate with the Id's cascade history. Low Coherence
  // shrinks both — distraction reads as a shorter memory horizon
  // everywhere, not just inside the inner monologue stage.
  const surfaceDialogueDepth = effectiveHistoryDepth;
  const surfaceActionDepth = effectiveHistoryDepth + 2;
  const nearbyForMemory = req.worldContext?.nearbyGhosts ?? [];

  // 1. Pull recent reasoning context for the Id and structured
  //    timeline context for the Surface in parallel. The Surface
  //    fetches are cheap (a handful of small Cypher queries) and
  //    independent of the Id fetch. Each is wrapped in a per-fetch
  //    catch so a single query failure degrades the cascade to
  //    "no memory context for this stage" rather than killing the
  //    cascade entirely — the previous Promise.all-all-or-nothing
  //    semantics caused the loop to spin at world-MCP latency when
  //    any one query rejected.
  const emptyDialogue: ReadonlyMap<string, ReadonlyArray<DialogueTurn>> = new Map();
  const emptyImpressions: ReadonlyMap<string, ImpressionView> = new Map();
  const emptyActions: ReadonlyArray<ActionDigestEntry> = [];
  const [
    recentCascades,
    recentDialogue,
    recentActions,
    clusterImpressions,
  ] = await Promise.all([
    fetchRecentCascades(memoryHandle.client, ghostId, effectiveHistoryDepth).catch(
      (err) => {
        console.warn(`[peppers] fetchRecentCascades failed: ${formatErr(err)}`);
        return [] as readonly CascadeReplay[];
      },
    ),
    nearbyForMemory.length > 0 && surfaceDialogueDepth > 0
      ? fetchRecentDialogueWith(memoryHandle.client, ghostId, nearbyForMemory, surfaceDialogueDepth).catch(
          (err) => {
            console.warn(`[peppers] fetchRecentDialogueWith failed: ${formatErr(err)}`);
            return emptyDialogue;
          },
        )
      : Promise.resolve(emptyDialogue),
    surfaceActionDepth > 0
      ? fetchRecentActionDigest(memoryHandle.client, ghostId, surfaceActionDepth).catch(
          (err) => {
            console.warn(`[peppers] fetchRecentActionDigest failed: ${formatErr(err)}`);
            return emptyActions;
          },
        )
      : Promise.resolve(emptyActions),
    nearbyForMemory.length > 0
      ? fetchOccupantImpressions(memoryHandle.client, ghostId, nearbyForMemory).catch(
          (err) => {
            console.warn(`[peppers] fetchOccupantImpressions failed: ${formatErr(err)}`);
            return emptyImpressions;
          },
        )
      : Promise.resolve(emptyImpressions),
  ]);

  // 2. Id composes monologue + adjustments. Pre-cascade needs are
  //    passed so synthesis can scale max_tokens against Fuel — the
  //    first wired primal-need consequence.
  const id = await invokeId({
    personality: state,
    stimulus,
    recentCascades,
    worldContext: req.worldContext,
    objective: req.objective,
    needs: needsIn,
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
    ...(req.recentSuperObjectives && req.recentSuperObjectives.length > 0
      ? { recentSuperObjectives: req.recentSuperObjectives }
      : {}),
  });

  // 3. Surface picks a tool from the live MCP menu using OpenAI's
  //    tool-calling API. No curated action list — the LLM sees the
  //    actual tools the world exposes. The primal drive (if any) is
  //    computed by the Id pipeline and threaded through so the Surface
  //    can let a screaming need override the surface objective. The
  //    memory timeline blocks pass through verbatim — the Surface
  //    renderer turns them into gap-aware prompt lines.
  const strainAtCascadeStart = req.metabolicStrain ?? 0;
  const surface = await invokeSurface({
    monologue: id.monologue,
    stimulus,
    worldContext: req.worldContext,
    objective: req.objective,
    tools: req.tools,
    commitments: ledgerIn,
    primalDrive: id.primalDrive,
    metabolicStrain: strainAtCascadeStart,
    currentCascadeIndex: cascadeIndex,
    recentDialogue,
    recentActions,
    clusterImpressions,
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
  });

  // 4. Execute the action against the world.
  const outcome = await executeAction(surface.action);

  // 5. Apply slider adjustments — one per facet at most. The legacy
  // ≥1-up + ≥1-down rule no longer applies: each facet agent owns its
  // own slider and decides independently, so no global balance is
  // enforced. The Rest need scales `driftDelta` — an unrested ghost's
  // personality barely budges this cascade.
  const { state: nextState, applied } = applyAdjustmentsPerFacet(
    state,
    id.adjustments,
    driftDelta,
  );

  // 6. Build the cascade record.
  const trigger = createExternalStimulusEvent(stimulus);
  const builder = new CascadeBuilder(ghostId, trigger);

  builder.addThought({ role: "monologue", content: id.monologue });
  builder.addSurfaceAction(surface.action, outcome);
  for (const a of applied) {
    builder.addAdjustment(a);
  }
  const trace = builder.complete();

  // 7. Persist to Agent Memory (event substrate + reasoning tier) —
  //    UNLESS Rest is critical, in which case the cascade evaporates
  //    and the ghost has no record of having lived this turn.
  if (memoryWritesEnabled) {
    await persistCascade(memoryHandle.client, trace, cascadeIndex);
    // Write this cascade's spatial impressions as Facts so future
    // cascades can read "I last saw Marmot on a Wall tile N cascades
    // ago" without re-deriving from the raw look JSON. Failure is
    // logged and swallowed — perception memory is desirable but never
    // load-bearing on the cascade running.
    const impressionsToWrite = req.worldContext?.impressions ?? [];
    if (impressionsToWrite.length > 0) {
      await persistImpressions(
        memoryHandle.client,
        ghostId,
        impressionsToWrite,
        cascadeIndex,
      ).catch((err) => {
        console.warn(`[peppers] persistImpressions failed: ${formatErr(err)}`);
      });
    }
  }

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

  // Apply per-cascade primal-need depletion. Done at the END of the
  // cascade so the LLM calls in this turn ran against the PRE-cascade
  // need state — the depletion reflects the cost of having just done
  // all this work.
  let nextNeeds = applyCascadeDepletion(needsIn, depletionRates);

  // Stimulus-driven replenishment. These are the placeholder
  // restoration mechanisms — minimal, lets the system actually
  // observe non-monotonic need trajectories without requiring world
  // design first.
  //
  //   idle stimulus      → Rest restored (the ghost is genuinely
  //                        not doing anything; this is the closest
  //                        analogue to sleep we have today)
  //   incoming utterance → Coherence restored (being addressed by
  //                        another ghost grounds you in the present
  //                        moment, refreshes situational awareness)
  //
  // Fuel replenishes when the ghost successfully consumes an item via
  // the world's `consume` MCP tool. The world reports `consumed` (the
  // actual token count transferred from the item to this ghost), which
  // the substrate maps to a logit-space Fuel delta via
  // `TOKENS_TO_LOGIT_FUEL`. No substrate-side magic constants for
  // "how much one bite is worth"; the food carries its own energy.
  if (stimulus.kind === "idle") {
    nextNeeds = adjustNeed(nextNeeds, "Rest", "up", 0.08 * NEEDS_RUSH);
  }
  if (stimulus.kind === "utterance") {
    nextNeeds = adjustNeed(nextNeeds, "Coherence", "up", 0.05 * NEEDS_RUSH);
  }
  if (surface.action.kind === "consume" && outcome.ok === true) {
    // The food's `tokens` value is a slider input in DISPLAY units.
    // `adjustNeed` now does linear math on display directly: a crumb
    // with `tokens: 1` moves Fuel display by +1.0 (1.82 → 2.82); a
    // partial bite of 0.5 moves it by +0.5. Clamped to [0, 10].
    //
    // The MCP consume tool returns `{ ok, itemRef, consumed, remaining,
    // depleted }` with the energy fields at the TOP level (not nested
    // under `data`) — `executeViaMcp` passes the world's result through
    // unchanged once it sees `ok`. So we read `outcome.consumed`.
    const raw = outcome as unknown as { consumed?: unknown };
    const consumed = typeof raw.consumed === "number" ? raw.consumed : 0;
    if (consumed > 0) {
      nextNeeds = adjustNeed(nextNeeds, "Fuel", "up", consumed);
    }
  }

  // Primal→personality wiring. The trigger is per-cascade DYNAMIC flux
  // in each primal — sustained net gain or net loss compounds into a
  // streak per (primal, target_slider) edge, and the streak × current
  // magnitude × base_step becomes a logit-delta applied to the
  // personality slider via the sigmoid math (`applyDelta`). A stable
  // ghost at any Fuel level produces flux=0 and gets no push, which is
  // the cultural-bias resolution: position alone never triggers, only
  // motion does.
  //
  // CRITICAL: flux is computed from the BEHAVIOUR (consumed −
  // depletion), NOT from the slider delta. The slider clamps at 10, so
  // a ghost binging at the ceiling shows slider-delta = 0 even though
  // they're still actively choosing to eat each cascade. That breaks
  // the wiring at the ceiling. The behaviour-based flux stays correct:
  // a ghost eating 1 token in a cascade with depletion 0.2 has flux
  // +0.8 regardless of where the slider sits.
  const primalEdges = req.primalEdges ?? DEFAULT_PRIMAL_PERSONALITY_EDGES;
  const fuelDepletedThisCascade = depletionRates.Fuel;
  const fuelConsumedThisCascade =
    surface.action.kind === "consume" && outcome.ok === true
      ? (typeof (outcome as unknown as { consumed?: unknown }).consumed === "number"
          ? ((outcome as unknown as { consumed: number }).consumed)
          : 0)
      : 0;
  const fuelFlux = fuelConsumedThisCascade - fuelDepletedThisCascade;
  const primalFlux = { Fuel: fuelFlux };
  const streaksIn = req.primalStreaks ?? emptyPrimalStreaks(primalEdges);
  const nextPrimalStreaks = updateStreaks(streaksIn, primalFlux, primalEdges);
  const primalForces = computePrimalForces(nextPrimalStreaks, primalFlux, primalEdges);
  let stateAfterPrimals: PersonalityState = nextState;
  for (const f of primalForces) {
    const trait = stateAfterPrimals[f.edge.targetFacet];
    const before = trait[f.edge.targetAxis];
    const after = applyDelta(
      before,
      f.logitDelta >= 0 ? "up" : "down",
      Math.abs(f.logitDelta),
    );
    stateAfterPrimals = {
      ...stateAfterPrimals,
      [f.edge.targetFacet]: { ...trait, [f.edge.targetAxis]: after },
    };
  }

  // Metabolic strain — state-based chronic-binge mortality.
  // While Fuel.display sits above the binge threshold (7), strain
  // accumulates per cascade by `(Fuel.display - 7) × strain_rate`,
  // so the deeper into binge, the faster the strain. While Fuel is at
  // or below the binge threshold, strain decays slowly. The
  // accumulation runs independently of streak — a ghost pegged at
  // Fuel=10 with no further flux movement still accrues strain.
  const strainIn = req.metabolicStrain ?? 0;
  const fuelDisplayAfter = nextNeeds.Fuel.display;
  let nextMetabolicStrain: number;
  if (fuelDisplayAfter > METABOLIC_BINGE_THRESHOLD) {
    const above = fuelDisplayAfter - METABOLIC_BINGE_THRESHOLD;
    nextMetabolicStrain = strainIn + above * METABOLIC_STRAIN_PER_DISPLAY_PER_CASCADE;
  } else {
    nextMetabolicStrain = Math.max(0, strainIn - METABOLIC_STRAIN_RECOVERY_PER_CASCADE);
  }

  return {
    ghostId,
    stimulus,
    id,
    surface,
    action: surface.action,
    outcome,
    applied,
    nextState: stateAfterPrimals,
    trace,
    commitment,
    nextLedger,
    nextNeeds,
    nextPrimalStreaks,
    primalFlux,
    primalForces,
    nextMetabolicStrain,
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
