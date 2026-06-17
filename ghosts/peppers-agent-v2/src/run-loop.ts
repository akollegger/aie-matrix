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
  applyDuePendingEffects,
  applyFoodConsume,
  computePrimalForces,
  createExternalStimulusEvent,
  emptyPrimalStreaks,
  midpointNeeds,
  toDisplay,
  updateStreaks,
  type PendingNeedEffect,
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
  fetchRecentCascades,
  fetchRecentDialogueWith,
  persistCascade,
  persistCommitmentEvaluation,
  persistImpressions,
  type CascadeReplay,
  type MemoryClientHandle,
} from "@aie-matrix/ghost-peppers-mem";

function formatErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

import {
  gateOccupantImpressions,
  gateRecencyDepth,
  mergeFog,
} from "./memory-gate.js";
import {
  priorMovementByFacet,
  selectActiveFacets,
} from "./facet-selection.js";
import { invokeCommitment, type CommitmentEvaluation } from "./reason-id-commitment.js";
import { runIdAgent, type IdReasoning } from "./reason-id.js";
import {
  renderSurfaceSpeech,
  type SurfaceReasoning,
  type WorldContext,
} from "./reason-surface.js";

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
 * Token → Fuel display conversion. Stage 3: per-cascade Fuel
 * depletion is the actual tokens this cascade burned in the Id
 * pipeline + action stage, mapped through this constant. The flat
 * `DEFAULT_NEED_DEPLETION.Fuel = 0.05` is now a fallback for callers
 * that don't expose token usage.
 *
 * Default scale `1e-5` calibrates against the historical flat rate:
 * the old 0.05 / cascade corresponds to ~5,000 tokens — about what
 * a single facet-resolver-only cascade burns. A full 5-stage Id +
 * SDK action run (~30k tokens) now burns ~0.30 Fuel per cascade,
 * which is the "deliberation is expensive" property. A fuel-critical
 * short-circuit run (~500 tokens) burns ~0.005, which closes the
 * survival loop: cheap thinking lets a starving ghost hang on.
 *
 * Tunable via `PEPPERS_FUEL_PER_KTOKEN` (display units per 1k
 * tokens, default 0.01).
 */
const FUEL_PER_KTOKEN: number = (() => {
  const raw = process.env.PEPPERS_FUEL_PER_KTOKEN;
  if (!raw) return 0.01;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0.01;
  return n;
})();

/** Convert a raw token count to a Fuel display-units depletion,
 *  including the NEEDS_RUSH time-compression. */
function tokensToFuelDepletion(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1000) * FUEL_PER_KTOKEN * NEEDS_RUSH;
}

/**
 * Rest depletes on TWO axes (per design): cognitive load (tokens burned
 * this cascade — hard thinking is tiring) and wall-clock time spent awake
 * (elapsed ms since the previous cascade — just being awake wears you
 * down). Sleep restores it. Tunables:
 *   PEPPERS_REST_PER_KTOKEN  display units / 1k tokens (default 0.004)
 *   PEPPERS_REST_PER_MINUTE  display units / minute awake (default 0.6)
 */
const REST_PER_KTOKEN: number = (() => {
  const n = parseFloat(process.env.PEPPERS_REST_PER_KTOKEN ?? "");
  return Number.isFinite(n) && n >= 0 ? n : 0.004;
})();
const REST_PER_MINUTE: number = (() => {
  const n = parseFloat(process.env.PEPPERS_REST_PER_MINUTE ?? "");
  return Number.isFinite(n) && n >= 0 ? n : 0.6;
})();
function restDepletion(tokens: number, elapsedMs: number): number {
  const fromTokens =
    Number.isFinite(tokens) && tokens > 0
      ? (tokens / 1000) * REST_PER_KTOKEN
      : 0;
  const fromTime =
    Number.isFinite(elapsedMs) && elapsedMs > 0
      ? (elapsedMs / 60000) * REST_PER_MINUTE
      : 0;
  return (fromTokens + fromTime) * NEEDS_RUSH;
}

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
  /** The Surface's spoken utterance this cascade, if the Id gated speech
   *  open. Separate from the representative world `action` (the say is no
   *  longer the cascade's primary action), so the overlay/observers can
   *  render the ghost's OWN side of the conversation. Null when it didn't
   *  speak. */
  readonly say: { readonly content: string; readonly to: string | null } | null;
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
  /** Delayed need effects still pending AFTER this cascade (e.g. a cake's
   *  sugar crash scheduled a few cascades out). Threaded forward via
   *  `req.pendingEffects`; due entries are applied at the start of each
   *  cascade. */
  readonly nextPendingEffects: PendingNeedEffect[];
  /** RFC-0031: a painting the ghost looked at / a card it read THIS cascade,
   *  to be fed as real model input NEXT cascade (it can't land mid-run). The
   *  caller threads this back in as `req.pendingPerception`. Null when the
   *  ghost engaged no art this cascade. */
  readonly nextPendingPerception: {
    readonly imageUrl?: string;
    readonly pageText?: string;
    readonly pageUrl?: string;
  } | null;
  /** True when the binge-episode latch is active AFTER this cascade.
   *  Set when Fuel.display crosses `BINGE_LATCH_HIGH` (default
   *  setpoint + 4) from below; cleared when it falls back below
   *  `BINGE_LATCH_LOW` (default setpoint + 2). Threaded forward via
   *  `req.bingeActive` to drive tool gating on the NEXT cascade. */
  readonly nextBingeActive: boolean;
  /** True iff this cascade ENDED a binge episode (`bingeActive` was
   *  true before, false now). The run-house uses this edge to fire
   *  `incrementNeedTolerance(needs, "Fuel", "high")` so the
   *  satiety setpoint creeps up after each completed binge. */
  readonly bingeEpisodeEnded: boolean;
}

/** Inputs to one interaction step. */
export interface RunOneStimulusRequest {
  readonly memoryHandle: MemoryClientHandle;
  readonly ghostId: string;
  readonly state: PersonalityState;
  readonly stimulus: Stimulus;
  /** Live world MCP client. The Id's SDK tool wrappers call this
   *  directly to execute world actions during `run(idAgent, …)`.
   *  Replaces the legacy `executeAction` callback for in-world
   *  cascades; tests/mocks can still pass `executeAction` for
   *  non-MCP drives. */
  readonly mcp: import("@aie-matrix/ghost-ts-client").GhostMcpClient;
  /** Adapter that runs the chosen Surface action against the world.
   *  Retained for backward compatibility with non-SDK callers; the
   *  SDK tool wrappers do not consult it. */
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
  /** Prior-cascade movement summary (facet adjustments + primal
   *  forces). Used by the Id pipeline to pick the 2 facets that get
   *  to speak this cascade, and by the Surface to pick the 2
   *  external archetypes to render. Undefined on cascade 1. */
  readonly recentMovement?: import("./facet-selection.js").RecentMovement;
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
  /** Wall-clock ms the ghost was awake for this cascade (now − previous
   *  cascade end). Drives the time-awake component of Rest depletion;
   *  callers reset the clock across a blackout so sleep isn't counted as
   *  awake. Omitted → time component is zero (token component only). */
  readonly elapsedMsAwake?: number;
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
  /** Delayed need effects scheduled by earlier cascades (e.g. cake sugar
   *  crashes). Due entries (`dueAtCascade <= cascadeIndex`) are applied
   *  at the start of this cascade; the rest are threaded forward via
   *  `RunRecord.nextPendingEffects`. Default: none. */
  readonly pendingEffects?: ReadonlyArray<PendingNeedEffect>;
  /** RFC-0031: a painting/card the ghost engaged the PREVIOUS cascade, fed
   *  this cascade as real model input (image part / page text), routing to the
   *  vision model when an image is present. Threaded from
   *  `RunRecord.nextPendingPerception`. Default: none. */
  readonly pendingPerception?: {
    readonly imageUrl?: string;
    readonly pageText?: string;
    readonly pageUrl?: string;
  };
  /** True when this ghost is mid-binge — Fuel crossed `BINGE_HIGH`
   *  above the current setpoint and hasn't yet dropped back below
   *  `BINGE_LOW`. The run-house maintains this latch across
   *  cascades; here we just thread it into the action-stage gate. */
  readonly bingeActive?: boolean;
  /** Sleep-pipeline Skill match for this stimulus, resolved by the
   *  run-house BEFORE the cascade (Step D). Threaded into the Id as
   *  a hint — felt familiarity at synthesis, remembered know-how at
   *  the action stage. Never an override. */
  readonly skillHint?: {
    readonly purpose: string;
    readonly hintText: string;
  };
  /** Observer-view live feed: forwarded to the Id action stage, which
   *  streams its run and emits compact events (tool calls, worker
   *  forks, text deltas) as they happen. Omit for batch execution. */
  readonly onIdRunEvent?: (
    ev: import("./reason-id-action.js").IdStreamEvent,
  ) => void;
  /** The ghost's self-narrative — its own first-person account of who
   *  it is, written by itself during its last sleep under a hard size
   *  cap. Threaded into the Id's instructions and the synthesis
   *  identity anchor. Absent until the first blackout. */
  readonly selfNarrative?: string;
  /** A single inherited word from a past life, passed BARE — no framing,
   *  no label, no claim it influences anything. Deliberately ambiguous;
   *  the ghost is told nothing about what it is. Distinct from
   *  `selfNarrative` (which the ghost authored; this it did not). */
  readonly karmicWord?: string;
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

  // Step 4: Fuel/Rest gating on top of Coherence's history cap. The
  // gate returns an effective depth (≤ requested) plus a felt-vocab
  // "fog" string when the horizon was shrunk by cognitive state. We
  // collect the fogs and merge them into a single "memory feels" line
  // threaded into both the Id and Surface prompts.
  // Step 6 retired the dialogue / actions / impressions push-fetches —
  // those values are now pulled by the Surface's recall_* tools and
  // gated per-call inside the executors. We still gate the cascade
  // history depth (consumed by the Id) and collect the impressions
  // fog so the Id's synthesis can voice the haze up-front.
  const cascadeGate = gateRecencyDepth(needsIn, effectiveHistoryDepth);
  const impressionsGate = gateOccupantImpressions(needsIn);
  const gatedCascadeDepth = cascadeGate.effective;
  const memoryFog = mergeFog([cascadeGate.fog, impressionsGate.fog]);
  // surfaceDialogueDepth / surfaceActionDepth are retained for the
  // legacy interface fields (run-loop hands empty maps), but no
  // longer drive any fetch.
  void surfaceDialogueDepth;
  void surfaceActionDepth;

  // 1. Pull recent reasoning context for the Id and structured
  //    timeline context for the Surface in parallel. The Surface
  //    fetches are cheap (a handful of small Cypher queries) and
  //    independent of the Id fetch. Each is wrapped in a per-fetch
  //    catch so a single query failure degrades the cascade to
  //    "no memory context for this stage" rather than killing the
  //    cascade entirely — the previous Promise.all-all-or-nothing
  //    semantics caused the loop to spin at world-MCP latency when
  //    any one query rejected.
  // Step 6: Surface no longer needs pre-fetched dialogue / actions /
  // impressions — it pulls them on demand via recall_* tools when
  // the model decides it needs them. The only push-fetch remaining
  // is recentCascades, which the Id pipeline consumes for facet-
  // agent triggers. The three saved Cypher round-trips per cascade
  // are pure win.
  const recentCascades =
    gatedCascadeDepth > 0
      ? await fetchRecentCascades(memoryHandle.client, ghostId, gatedCascadeDepth).catch(
          (err) => {
            console.warn(`[peppers] fetchRecentCascades failed: ${formatErr(err)}`);
            return [] as readonly CascadeReplay[];
          },
        )
      : ([] as readonly CascadeReplay[]);
  // Step 8: the legacy Surface no longer receives dialogue/actions/
  // impressions push-fields — speech rendering doesn't need them.
  // Recall pull-tools cover the same ground when relevant.

  // Step 6/8: build knownGhosts (display-name → ghostId) for the
  // recall pull-tools — both Id-action and Surface-speech rely on it.
  // v1 scope: just the current cluster. A future step will extend
  // this to a persistent `:Acquaintance` set so a ghost can recall
  // someone who isn't physically present.
  const knownGhosts = new Map<string, string>();
  for (const g of nearbyForMemory) {
    knownGhosts.set(g.displayName, g.ghostId);
  }

  // Push-recall: when someone SPEAKS to this ghost, the substrate
  // remembers for it — recent exchanges with that specific speaker are
  // fetched and surfaced as remembered context. Mechanical, not
  // optional: 198 observed cascades showed pull-tools going unused
  // (reads ≈ 0), so relational memory was decorative. Recall stays
  // Coherence-gated (display < 2 → too foggy to place the voice) and
  // matters most where the in-process thread can't reach: across
  // pause/resume, past the thread horizon, and after sleep relabels
  // raw messages. Failure degrades to "no remembered context".
  let peerMemory: string | undefined;
  if (stimulus.kind === "utterance" && coherenceDisplay >= 2) {
    const speakerName = stimulus.from;
    const speakerId = knownGhosts.get(speakerName);
    if (speakerId !== undefined) {
      try {
        const dialogue = await fetchRecentDialogueWith(
          memoryHandle.client,
          ghostId,
          [{ ghostId: speakerId, displayName: speakerName }],
          5,
        );
        const turns = dialogue.get(speakerId) ?? [];
        if (turns.length > 0) {
          const turnLines = turns.map(
            (t) => `  ${t.by === "self" ? "you" : speakerName}: ${t.text.slice(0, 140)}`,
          );
          peerMemory = `You have spoken with ${speakerName} before — recent exchanges:\n${turnLines.join("\n")}`;
          console.info(
            `[peppers-recall] ${req.selfDisplayName ?? ghostId.slice(0, 8)}: ${turns.length} remembered turn(s) with ${speakerName}`,
          );
        }
      } catch (err) {
        console.warn(`[peppers-recall] fetch failed: ${formatErr(err)}`);
      }
    }
  }
  // `strainAtCascadeStart` was used by the legacy Surface request; the
  // Id pipeline already reads `needsIn` directly, so the value is no
  // longer threaded through here. Leaving the computation out — if a
  // future stage wants pre-cascade strain it can read req.metabolicStrain.
  void req.metabolicStrain;

  // 2. Pick which facets get a voice this cascade. Top 2 by prior-
  //    cascade movement on the relevant axis (internal for the Id,
  //    external for the Surface), with fallback to most-extreme-
  //    from-midpoint when prior movement is empty (cascade 1, or
  //    static cascades). The Id will run facet agents only for the
  //    internal picks; the Surface will render performed-face
  //    archetypes only for the external picks.
  const internalMovement = priorMovementByFacet(req.recentMovement, "internal");
  const externalMovement = priorMovementByFacet(req.recentMovement, "external");
  const activeInternalFacets = selectActiveFacets(internalMovement, state, "internal", 2);
  const activeExternalFacets = selectActiveFacets(externalMovement, state, "external", 2);

  // 3. Id composes monologue + adjustments + the world action (Step 8
  //    — the action-picker now lives in the Id pipeline as stage 4).
  //    The `actionStage` block tells `runIdAgent` to run stage 4; the
  //    Id sees `say_intent` in place of the world's `say` and the run-
  //    loop translates that to a real `say(text=rendered)` below.
  const id = await runIdAgent({
    personality: state,
    stimulus,
    recentCascades,
    worldContext: req.worldContext,
    objective: req.objective,
    needs: needsIn,
    activeInternalFacets,
    activeExternalFacets,
    actionStage: {
      ghostId,
      tools: req.tools,
      mcp: req.mcp,
      memoryClient: memoryHandle.client,
      knownGhosts,
      currentCascadeIndex: cascadeIndex,
      bingeActive: req.bingeActive === true,
      ...(req.onIdRunEvent !== undefined ? { onRunEvent: req.onIdRunEvent } : {}),
    },
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
    ...(req.recentSuperObjectives && req.recentSuperObjectives.length > 0
      ? { recentSuperObjectives: req.recentSuperObjectives }
      : {}),
    ...(memoryFog ? { memoryFog } : {}),
    ...(req.skillHint !== undefined ? { skillHint: req.skillHint } : {}),
    ...(req.selfNarrative !== undefined ? { selfNarrative: req.selfNarrative } : {}),
    ...(req.karmicWord !== undefined ? { karmicWord: req.karmicWord } : {}),
    ...(peerMemory !== undefined ? { peerMemory } : {}),
    ...(req.pendingPerception !== undefined ? { pendingPerception: req.pendingPerception } : {}),
  });

  // 3. The SDK has already executed every world action the Id
  //    decided on (via the tool wrappers in cognition/sdk-tools/).
  //    What was previously "Surface picks action → run-loop executes"
  //    is now "Id calls world tools directly during run()". The
  //    run-loop's job here is just to summarise: pick the
  //    representative action for the cascade record (the last one
  //    submitted, which corresponds to the cascade's "exit move")
  //    and assemble a SurfaceReasoning trace for backward-compat
  //    capture-log fields.
  const lastOutcomeRec =
    id.actionTrace?.actionOutcomes[id.actionTrace.actionOutcomes.length - 1];
  const action: SurfaceAction =
    lastOutcomeRec?.action ?? { kind: "(no-action)" };
  const outcome: ActionOutcome = lastOutcomeRec
    ? lastOutcomeRec.ok
      ? { ok: true }
      : { ok: false, code: "WORLD_ERROR", reason: lastOutcomeRec.outcome }
    : { ok: true };

  // RFC-0031: did the ghost engage any art this cascade? A painting it looked
  // at (`inspect`→image) or a card it read (`read`→page text) can only land as
  // real model input NEXT cascade, so capture it for the caller to thread back.
  let nextPendingPerception: RunRecord["nextPendingPerception"] = null;
  for (const rec of id.actionTrace?.actionOutcomes ?? []) {
    if (typeof rec.outcome !== "string") continue;
    let o: { kind?: string; ok?: boolean; imageUrl?: string; text?: string; url?: string };
    try {
      o = JSON.parse(rec.outcome);
    } catch {
      continue;
    }
    if (o.ok === false) continue;
    if (o.kind === "artwork" && typeof o.imageUrl === "string") {
      nextPendingPerception = { ...(nextPendingPerception ?? {}), imageUrl: o.imageUrl };
    } else if (o.kind === "page" && typeof o.text === "string") {
      nextPendingPerception = { ...(nextPendingPerception ?? {}), pageText: o.text, ...(o.url ? { pageUrl: o.url } : {}) };
    }
  }
  // ── Speech is the Surface's, gated by the Id ──────────────────────────
  // The Id decided ONCE whether to speak (the `speak` gate). The Id never
  // produces words. If granted, the Surface runs ONCE here and composes the
  // utterance independently — from its own top-2 external sliders + the
  // conversation it sees directly + world — with NO intent from the Id. We then
  // submit the single `say`. One utterance per cascade, by construction.
  let sayAction: SurfaceAction | null = null;
  let sayOutcome: ActionOutcome = { ok: true };
  if (id.speakRequested) {
    const present = req.worldContext?.nearbyGhosts ?? [];
    const to = id.speakAddressee ?? (present.length === 1 ? present[0]!.displayName : undefined);
    // The current incoming utterance isn't in the graph yet (persisted at
    // end-of-cascade); hand it to the Surface so it answers what was just said.
    const priorPeerLines =
      stimulus.kind === "utterance" ? [`${stimulus.from}: ${stimulus.text}`] : undefined;
    try {
      const rendered = await renderSurfaceSpeech({
        ghostId,
        memoryClient: memoryHandle.client,
        needs: needsIn,
        knownGhosts,
        currentCascadeIndex: cascadeIndex,
        personality: state,
        ...(req.worldContext !== undefined ? { worldContext: req.worldContext } : {}),
        ...(req.objective !== undefined ? { objective: req.objective } : {}),
        ...(req.selfDisplayName !== undefined ? { selfDisplayName: req.selfDisplayName } : {}),
        ...(activeExternalFacets && activeExternalFacets.length > 0
          ? { activeExternalFacets }
          : {}),
        ...(req.pendingPerception?.imageUrl ? { imageUrl: req.pendingPerception.imageUrl } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(priorPeerLines !== undefined ? { priorPeerLines } : {}),
      });
      const text = rendered.text.trim();
      if (text.length > 0) {
        const sayArgs: Record<string, unknown> = { content: text };
        if (to !== undefined) sayArgs["to"] = to;
        sayAction = { kind: "say", ...sayArgs } as SurfaceAction;
        try {
          const r = (await req.mcp.callTool("say", sayArgs)) as { ok?: boolean } | null;
          sayOutcome =
            r === null || typeof r !== "object" || r.ok !== false
              ? { ok: true }
              : { ok: false, code: "WORLD_ERROR", reason: JSON.stringify(r).slice(0, 200) };
        } catch (err) {
          sayOutcome = { ok: false, code: "WORLD_ERROR", reason: err instanceof Error ? err.message : String(err) };
        }
      }
    } catch (err) {
      console.warn(`[surface] render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const surface: SurfaceReasoning = {
    action,
    usage: null,
    userPrompt: id.actionTrace?.userPrompt ?? "",
    raw: id.actionTrace?.raw ?? "",
  };
  // The legacy `executeAction` callback is no longer the path that
  // actually runs world calls — the SDK tool wrappers do that. We
  // keep the callback for tests/mocks that drive cascades without
  // a live world, but in the lab it's a no-op for this cascade.
  void executeAction;

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
  // Record EVERY world action the Id ran this cascade — not just the
  // representative/last one — each with its FULL structured result. A forage
  // cascade is nearest → request → consume; recording only the last (with a
  // flattened {ok}) lost the purchases, prices, item refs, and energy. We
  // carry `rec.result` (the raw world result: paid, consumed, itemRef, …) as
  // the outcome so persistCascade writes it verbatim — literally everything
  // the ghost did lands in memory.
  for (const rec of id.actionTrace?.actionOutcomes ?? []) {
    const oc: ActionOutcome = rec.ok
      ? rec.result !== null && typeof rec.result === "object"
        ? (rec.result as ActionOutcome)
        : { ok: true }
      : { ok: false, code: "WORLD_ERROR", reason: rec.outcome };
    builder.addSurfaceAction(rec.action, oc);
  }
  // The Surface's utterance is its own action — record it so persistCascade
  // writes it to the conversation tier (the memory the Surface reads next turn).
  if (sayAction !== null) {
    builder.addSurfaceAction(sayAction, sayOutcome);
  }
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
  //
  // Stage 3: Fuel depletion this cascade is proportional to actual
  // tokens burned, not a flat constant. The Id's `usage.total`
  // (facets + impulse + convergence + synthesis + SDK action stage
  // — `sumUsage` rolls them all up) maps through
  // `tokensToFuelDepletion` to a display-units rate. Heavy cascades
  // cost more; the fuel-critical short-circuit (skip facets +
  // convergence) cheap-thinks the ghost out of the danger zone. If
  // usage is unavailable (legacy callers / mock tests), fall back
  // to the flat default rate.
  const cascadeTokens = id.usage?.total ?? 0;
  const fuelRateThisCascade =
    cascadeTokens > 0
      ? tokensToFuelDepletion(cascadeTokens)
      : depletionRates.Fuel;
  // Rest drains on cognitive load (tokens) + time awake (elapsed ms),
  // not a flat rate. Sleep is the only restore (see run-house).
  const restRateThisCascade = restDepletion(cascadeTokens, req.elapsedMsAwake ?? 0);
  const dynamicDepletionRates: Record<NeedName, number> = {
    Fuel: fuelRateThisCascade,
    Coherence: depletionRates.Coherence,
    Rest: restRateThisCascade > 0 ? restRateThisCascade : depletionRates.Rest,
  };
  let nextNeeds = applyCascadeDepletion(needsIn, dynamicDepletionRates);

  // Fire any delayed need effects that have come due this cascade — most
  // notably a cake's sugar crash, scheduled when it was eaten. Applied
  // right after depletion and BEFORE this cascade's own eating, so a
  // crash hits first and the ghost can then choose to eat its way back.
  const dueEffects = applyDuePendingEffects(
    nextNeeds,
    req.pendingEffects ?? [],
    cascadeIndex,
  );
  nextNeeds = dueEffects.needs;
  let pendingEffectsOut: PendingNeedEffect[] = dueEffects.remaining;
  let foodStrainDelta = 0;

  // Every successful `consume` the Id ran THIS cascade — not just the
  // cascade's representative/last action. The SDK action stage records each
  // tool call in `actionOutcomes`; we read the structured world `result`
  // (energy fields at top level), falling back to parsing the truncated
  // outcome string only if an older trace lacks it. This is exactly the piece
  // the SDK handoff dropped: before it, `consume`'s `{consumed,itemRef}`
  // arrived on `outcome` directly; now it rides on the per-action `result`.
  const consumeEvents = (id.actionTrace?.actionOutcomes ?? [])
    .filter((rec) => rec.action.kind === "consume" && rec.ok === true)
    .map((rec) => {
      let r = rec.result as { consumed?: unknown; itemRef?: unknown } | undefined;
      if (r === null || typeof r !== "object") {
        try {
          r = JSON.parse(rec.outcome) as { consumed?: unknown; itemRef?: unknown };
        } catch {
          r = undefined;
        }
      }
      return {
        consumed: typeof r?.consumed === "number" ? r.consumed : 0,
        itemRef: typeof r?.itemRef === "string" ? r.itemRef : undefined,
      };
    });

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
  // (Idle no longer restores Rest — being idle is still being awake, and
  // time-awake drains Rest. Sleep is the restore now.)
  if (stimulus.kind === "utterance") {
    nextNeeds = adjustNeed(nextNeeds, "Coherence", "up", 0.05 * NEEDS_RUSH);
  }
  for (const ev of consumeEvents) {
    // The food's `tokens` value is a slider input in DISPLAY units.
    // `adjustNeed` does linear math on display directly: a crumb with
    // `tokens: 1` moves Fuel display by +1.0 (1.82 → 2.82); a partial bite
    // of 0.5 moves it by +0.5. Clamped to [0, 10]. `consumed` is the token
    // count the world actually transferred from the item to this ghost.
    //
    // The MCP consume tool returns `{ ok, itemRef, consumed, remaining,
    // depleted }` with the energy fields at the TOP level; we read them off
    // the captured `result` (see `consumeEvents` above).
    //
    // Fuel BEFORE this bite — lets a delayed crash be sized against the
    // actual Fuel the food delivers (cake: gain + 1).
    const fuelBeforeEating = nextNeeds.Fuel.display;
    if (ev.consumed > 0) {
      nextNeeds = adjustNeed(nextNeeds, "Fuel", "up", ev.consumed);
    }
    // Layer the food's CHARACTER on top of the raw Fuel: an immediate
    // overshoot + Rest hit (cake/sweets), an immediate strain delta, and
    // a delayed Fuel crash scheduled for `crash.after` cascades from now.
    // Unknown items carry the empty profile (no side effects).
    const food = applyFoodConsume(nextNeeds, ev.itemRef, cascadeIndex, fuelBeforeEating);
    nextNeeds = food.needs;
    foodStrainDelta += food.strainDelta;
    if (food.enqueue.length > 0) {
      pendingEffectsOut = [...pendingEffectsOut, ...food.enqueue];
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
  const fuelConsumedThisCascade = consumeEvents.reduce((s, ev) => s + ev.consumed, 0);
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
  // Per-food immediate strain (junk strains now, fresh relieves) layers on
  // top of the state-based binge strain. Floored at 0.
  nextMetabolicStrain = Math.max(0, nextMetabolicStrain + foodStrainDelta);

  // Binge-episode latch (Stage 4). The thresholds are relative to
  // the current Fuel setpoint, NOT absolute — so a tolerance-high
  // ghost (setpoint 7) binges starting at Fuel display ~9.5, not
  // at the same 9.0 as a fresh ghost. Once a binge ends (Fuel
  // crosses back below LOW), we fire `bingeEpisodeEnded=true` so
  // the run-house can increment Fuel's tolerance — that's the
  // "satiety setpoint creeps up" mechanic.
  const bingeWasActive = req.bingeActive === true;
  const setpoint = nextNeeds.Fuel.slider.setpoint;
  // Setpoint is in logit space; convert thresholds via the sigmoid.
  // Latch HIGH ≈ display 9.0 above a setpoint of display 5;
  // 4 display units above the setpoint, capped at 9.5 so the
  // latch is always reachable.
  const setDisplay = 10 / (1 + Math.exp(-setpoint));
  const bingeLatchHigh = Math.min(9.5, setDisplay + 4);
  const bingeLatchLow = Math.min(8.5, setDisplay + 2);
  let nextBingeActive: boolean;
  if (bingeWasActive) {
    nextBingeActive = fuelDisplayAfter > bingeLatchLow;
  } else {
    nextBingeActive = fuelDisplayAfter >= bingeLatchHigh;
  }
  const bingeEpisodeEnded = bingeWasActive && !nextBingeActive;

  return {
    ghostId,
    stimulus,
    id,
    surface,
    action: surface.action,
    outcome,
    say:
      sayAction !== null
        ? ((s: Record<string, unknown>) => ({
            content:
              typeof s["content"] === "string"
                ? (s["content"] as string)
                : typeof s["text"] === "string"
                  ? (s["text"] as string)
                  : "",
            to: typeof s["to"] === "string" ? (s["to"] as string) : null,
          }))(sayAction as unknown as Record<string, unknown>)
        : null,
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
    nextPendingEffects: pendingEffectsOut,
    nextPendingPerception,
    nextBingeActive,
    bingeEpisodeEnded,
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
