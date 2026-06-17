/**
 * Id reasoning — the modular pipeline.
 *
 * Replaces the monolithic single-call Id with a three-stage pipeline:
 *   1. Eight facet agents, run in parallel. Each reads the trigger
 *      through its own slider's lens and emits a judgment, an optional
 *      slider adjustment, and a 1-2 sentence reading.
 *   2. A convergence agent integrates the eight readings into a
 *      single emotional read + a 3-8 word super-objective.
 *   3. A synthesis agent voices the stream-of-consciousness monologue
 *      from the convergence output (this is where the voice
 *      constraints live; upstream stages emit plain prose).
 *
 * Sliders are owned by the facet agents — each emits at most one
 * adjustment for its own slider. No global "≥1 up + ≥1 down" rule;
 * balance emerges from the facets' collective judgment.
 *
 * Public contract (`invokeId` → `IdReasoning`) matches the old shape
 * so `runOneStimulus` doesn't need to know the Id is now a pipeline.
 */

import { Agent } from "@openai/agents";

import {
  STARTER_FACETS,
  fullnessFelt,
  midpointNeeds,
  selectPrimalDrive,
  type Adjustment,
  type NeedProfile,
  type PersonalityState,
  type PrimalDrive,
  type Stimulus,
  type SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import type { MemoryClient } from "@aie-matrix/ghost-peppers-mem";

import {
  FUEL_CRITICAL_DISPLAY,
  synthesisTokenCap,
} from "./cognition/need-gating.js";
import { DEFAULT_MODEL, type ToolSchema } from "./llm-client.js";
import { invokeIdAction } from "./reason-id-action.js";

import type { CascadeReplay } from "@aie-matrix/ghost-peppers-mem";

import {
  invokeFacetAgent,
  summarisePrimalDrive,
  type FacetReading,
} from "./reason-id-facet-agent.js";
import { invokeConvergence, type ConvergenceResult } from "./reason-id-convergence.js";
import { invokeImpulse, type ImpulseResult } from "./reason-id-impulse.js";
import { invokeSynthesis } from "./reason-id-synthesis.js";
import type { WorldContext } from "./reason-surface.js";

export interface IdReasoning {
  readonly superObjective: string;
  readonly monologue: string;
  readonly adjustments: readonly Adjustment[];
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly userPrompt: string;
  readonly raw: string;
  /** Per-facet trace, exposed for verbose / overlay debugging. */
  readonly facetReadings: ReadonlyArray<FacetReading>;
  /** Convergence layer's 1-2 sentence emotional read. */
  readonly emotionalRead: string;
  /** Impulse layer's 2-8 word action-oriented urge. */
  readonly impulse: string;
  /** Active primal drive at the time of this cascade, or null if all
   *  needs were in the healthy band. Exposed for overlay rendering
   *  and cascade-log diagnosis. */
  readonly primalDrive: PrimalDrive | null;
  /** Every world action the Id's SDK run emitted during this
   *  cascade, in execution order. A single `run(idAgent, …)` can
   *  produce multiple actions (compound cascade: speak + go + eat).
   *  Empty array on legacy callers that didn't pass `actionStage`. */
  readonly actions: readonly SurfaceAction[];
  /** The Id's speech gate this cascade: did it call `speak`? The run-loop
   *  runs the Surface ONCE afterwards iff true. The Id never speaks itself. */
  readonly speakRequested: boolean;
  /** Optional addressee the Id hinted at; the Surface may use or ignore it. */
  readonly speakAddressee: string | null;
  /** Action-stage trace, separate from the rest of the pipeline. */
  readonly actionTrace: {
    readonly userPrompt: string;
    readonly raw: string;
    readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
    /** Recall and action capture from the SDK run — used for the
     *  capture log and any per-cascade outcome reasoning. */
    readonly recalls: ReadonlyArray<{ readonly tool: string; readonly args: Record<string, unknown>; readonly output: string }>;
    readonly actionOutcomes: ReadonlyArray<{ readonly action: SurfaceAction; readonly outcome: string; readonly ok: boolean; readonly result?: unknown }>;
    /** Fork-join worker delegations this cascade (delegate_* tools):
     *  who was forked, for what task, and the head of their report. */
    readonly delegations: ReadonlyArray<import("./cognition/cascade-context.js").CapturedHandoff>;
  } | null;
}

export interface InvokeIdRequest {
  readonly personality: PersonalityState;
  readonly stimulus: Stimulus;
  readonly recentCascades: readonly CascadeReplay[];
  readonly worldContext?: WorldContext;
  readonly objective?: string;
  /** This ghost's persistent name. Threaded into every facet agent +
   *  impulse + convergence + synthesis prompt as the self-identity
   *  anchor. Removes any need to reason about routing UUIDs. */
  readonly selfDisplayName?: string;
  /** Last N super-objectives from prior cascades, oldest → newest.
   *  Fed into convergence so committed plans persist across ticks
   *  rather than regenerating fresh each cascade. */
  readonly recentSuperObjectives?: ReadonlyArray<string>;
  /** Primal need state at the start of this cascade. Used to scale
   *  pipeline behaviour (currently just synthesis max_tokens via the
   *  Fuel need). Optional — when omitted, the pipeline runs at full
   *  capacity. */
  readonly needs?: NeedProfile;
  /** Felt-vocabulary description of memory truncation, when the
   *  substrate's memory gate (Step 4) shrunk the horizon. Threaded
   *  into synthesis so the monologue voices the fog as felt
   *  experience. */
  readonly memoryFog?: string;
  /** Top-2 facets to run this cascade on the internal axis. Picked
   *  by the run-loop from prior-cascade movement; the Id pipeline
   *  only fires facet agents for these. Defaults to all 8 if
   *  omitted (legacy callers that haven't switched). */
  readonly activeInternalFacets?: ReadonlyArray<import("@aie-matrix/ghost-peppers-inner").FacetName>;
  /** Top-2 external-axis facets the Surface will render. Threaded
   *  through to the cascade context so voice_surface can pass the
   *  list to `renderOuterSelf`. */
  readonly activeExternalFacets?: ReadonlyArray<import("@aie-matrix/ghost-peppers-inner").FacetName>;
  /** Sleep-pipeline Skill match for this stimulus (Step D). The
   *  purpose line feeds synthesis as felt familiarity; the full
   *  fragment feeds the action stage as remembered know-how. Both
   *  are hints — the model still chooses. */
  readonly skillHint?: {
    readonly purpose: string;
    readonly hintText: string;
  };
  /** Self-narrative from the last sleep — the ghost's own capped
   *  "who I am" account. Identity anchor for synthesis and the Id's
   *  acting instructions. */
  readonly selfNarrative?: string;
  /** Substrate push-recall: remembered exchanges with the specific
   *  ghost who triggered this cascade (utterance stimuli only).
   *  Surfaced memory, not instruction. */
  readonly peerMemory?: string;
  /** RFC-0031: a painting/card the ghost engaged last cascade, landing as
   *  real model input now (image part / page text). Forwarded to the Id. */
  readonly pendingPerception?: {
    readonly imageUrl?: string;
    readonly pageText?: string;
    readonly pageUrl?: string;
  };
  /** Step 8: when set, the Id runs an action-picker stage after
   *  synthesis and returns the chosen world action on
   *  `IdReasoning.action`. When omitted, the Id stops at synthesis
   *  (legacy callers that still pick action elsewhere). */
  readonly actionStage?: {
    readonly ghostId: string;
    readonly tools: ReadonlyArray<ToolSchema>;
    readonly mcp: import("@aie-matrix/ghost-ts-client").GhostMcpClient;
    readonly memoryClient: MemoryClient;
    readonly knownGhosts: ReadonlyMap<string, string>;
    readonly currentCascadeIndex: number;
    /** True when this ghost is mid-binge — withholds the feeding
     *  tools at the action stage. */
    readonly bingeActive?: boolean;
    /** Observer-view live feed: when set, the action stage streams
     *  and forwards compact run events (tool calls, worker forks,
     *  text deltas) as they happen. */
    readonly onRunEvent?: (
      ev: import("./reason-id-action.js").IdStreamEvent,
    ) => void;
  };
}

// ---- Step 7: Agents SDK shell ----
//
// The Id is now structurally an `@openai/agents` Agent. The pipeline
// (facet × 8 → convergence → synthesis + parallel impulse) is kept
// intact as the deterministic inner logic — facet drift is a real
// mechanic and stays in peppers-inner math, not free-form agent
// tool-calling.
//
// What this shell buys us NOW: a single named Agent that downstream
// steps can register as a handoff target (Step 8: Surface as Id's
// voice tool; Step 9: drive sub-agents). The Id-as-Agent shell makes
// those wirings natural rather than retrofit.
//
// What it does NOT do yet: drive any LLM calls itself. `runIdAgent`
// below delegates straight to `runIdPipeline` (the renamed
// implementation). When a future step makes the Agent actually
// orchestrate sub-agents, this is the seam.
export const idAgent = new Agent({
  name: "Id",
  instructions:
    "You are the Id — a ghost's unconscious mind. You run a deterministic " +
    "pipeline of facet agents, a convergence agent, and a synthesis agent " +
    "to produce a stream-of-consciousness monologue and an emotional " +
    "super-objective each cascade. Personality drift is a real mechanic " +
    "owned by peppers-inner; the facet agents propose adjustments and the " +
    "substrate applies them deterministically.",
  model: DEFAULT_MODEL,
});

/**
 * Step-7 public entry point. Equivalent to `invokeId` today; the
 * separate name lets Step 8 wrap this in the Agents SDK `run()`
 * loop once the Id has reasons to make tool calls of its own
 * (handoff to Surface, handoff to drive sub-agents).
 */
export async function runIdAgent(req: InvokeIdRequest): Promise<IdReasoning> {
  return await invokeId(req);
}

export async function invokeId(req: InvokeIdRequest): Promise<IdReasoning> {
  const recentTriggers = extractRecentTriggers(req.recentCascades);
  const { lastAction, lastOutcome } = extractLastDecision(req.recentCascades);
  // The lizard's call. Null when every need is in the healthy band;
  // otherwise the strongest need's drive. Feeds the impulse stage
  // (what to do) and propagates out for overlay rendering.
  const primalDrive = req.needs ? selectPrimalDrive(req.needs) : null;
  // Stage 7: substrate-emitted fullness signal. Fires at Fuel
  // ≥ setpoint + 0.5 (below drive-firing levels) so the brain
  // has a literal "you do not need food" cue before binge
  // territory. Returns null when Fuel is at or below comfortable.
  const fullnessSignal = req.needs ? fullnessFelt(req.needs) : null;

  // Fuel-critical short-circuit. A starving ghost doesn't get to
  // deliberate; the body's drive becomes BOTH the emotional read and
  // the super-objective deterministically, the facets+convergence
  // LLM calls are skipped, and we route straight to impulse +
  // synthesis. The action stage downstream is already getting a
  // narrowed tool menu (`gateForNeeds`); together that's the
  // "starving = corporeal mode, no deliberation" substrate the
  // roadmap asked for.
  const fuelDisplay = req.needs ? req.needs.Fuel.display : 5;
  const fuelCritical = fuelDisplay <= FUEL_CRITICAL_DISPLAY;

  // Stage 1 — TWO parallel chains:
  //   (a) Eight facet agents in parallel → convergence (sequential).
  //       Produces emotional read + super-objective (slider-shaped flavor).
  //   (b) Impulse agent (single call, action-oriented). Sees current
  //       slider state + the last decision/outcome so it can build on
  //       momentum or pivot when something just failed.
  // Both feed synthesis. Running (b) in parallel with (a) keeps the
  // pipeline at three sequential layers: facet → convergence → synthesis,
  // with impulse finishing alongside facets (faster, simpler input).
  // Step 10: facet agents now read THREE drift streams — primal,
  // reflection-on-previous-response, memory. Translate the raw
  // primal urgency to felt vocabulary at this boundary so the facet
  // prompt never sees the number.
  const facetPrimalSummary = primalDrive
    ? summarisePrimalDrive(primalDrive)
    : null;
  // Only the active facets fire LLM calls this cascade — the rest
  // stay quiet. The run-loop picks them from prior-cascade slider
  // movement (top 2 by |delta|); on cascade 1 / static cascades it
  // falls back to most-extreme-from-midpoint.
  const facetsToRun =
    req.activeInternalFacets && req.activeInternalFacets.length > 0
      ? req.activeInternalFacets
      : STARTER_FACETS;

  let facetReadings: ReadonlyArray<FacetReading>;
  let conv: ConvergenceResult;
  let impulse: ImpulseResult;

  if (fuelCritical && primalDrive !== null) {
    // Skip facets + convergence. Map the drive deterministically into
    // emotional read + super-objective; run impulse alone (cheap, one
    // call) so the action-pull still reflects the world snapshot.
    const driveText = primalDrive.drive;
    const synthesizedEmotionalRead = `Body has the wheel. ${driveText}.`;
    const synthesizedSuperObjective =
      primalDrive.direction === "depleted"
        ? `attend the body — ${primalDrive.need.toLowerCase()} now`
        : `let the body settle — ease back from ${primalDrive.need.toLowerCase()}`;
    impulse = await invokeImpulse({
      personality: req.personality,
      stimulus: req.stimulus,
      worldContext: req.worldContext,
      objective: req.objective,
      lastAction,
      lastOutcome,
      primalDrive,
      ...(fullnessSignal !== null ? { fullness: fullnessSignal } : {}),
    });
    facetReadings = [];
    conv = {
      emotionalRead: synthesizedEmotionalRead,
      superObjective: synthesizedSuperObjective,
      usage: null,
      userPrompt: `[fuel-critical short-circuit · ${primalDrive.need} ${primalDrive.direction} · display ${fuelDisplay.toFixed(2)}]`,
      raw: "",
    };
  } else {
    [facetReadings, impulse] = await Promise.all([
      Promise.all(
        facetsToRun.map((facet) =>
          invokeFacetAgent({
            facet,
            state: req.personality,
            stimulus: req.stimulus,
            recentTriggers,
            objective: req.objective,
            primalDrive: facetPrimalSummary,
            ...(lastAction !== undefined ? { lastAction } : {}),
            ...(lastOutcome !== undefined ? { lastOutcome } : {}),
          }),
        ),
      ),
      invokeImpulse({
        personality: req.personality,
        stimulus: req.stimulus,
        worldContext: req.worldContext,
        objective: req.objective,
        lastAction,
        lastOutcome,
        primalDrive,
        ...(fullnessSignal !== null ? { fullness: fullnessSignal } : {}),
      }),
    ]);

    // Stage 2 — convergence: the eight facet readings → one feeling + flavor.
    // Pass recent super-objectives + recent triggers so the prompt can
    // preserve committed plans across ticks instead of regenerating
    // fresh each cascade (the fix for "talk forever, never act" loops).
    conv = await invokeConvergence({
      facetReadings,
      stimulus: req.stimulus,
      objective: req.objective,
      ...(req.recentSuperObjectives && req.recentSuperObjectives.length > 0
        ? { recentSuperObjectives: req.recentSuperObjectives }
        : {}),
      ...(recentTriggers.length > 0 ? { recentTriggers } : {}),
    });
  }

  // Stage 3 — synthesis: voice it. Receives BOTH the emotional flavor
  // (super-objective) and the action-pull (impulse), weaves them.
  // Fuel-need scales the max_tokens cap so a starving ghost's
  // monologue is mechanically shorter — the first end-to-end primal
  // consequence the cascade observes.
  const fuelMaxTokens = req.needs ? synthesisTokenCap(req.needs) : undefined;
  const synth = await invokeSynthesis({
    emotionalRead: conv.emotionalRead,
    superObjective: conv.superObjective,
    impulse: impulse.impulse,
    stimulus: req.stimulus,
    worldContext: req.worldContext,
    objective: req.objective,
    ...(req.selfDisplayName ? { selfDisplayName: req.selfDisplayName } : {}),
    ...(fuelMaxTokens !== undefined ? { maxTokens: fuelMaxTokens } : {}),
    ...(req.memoryFog ? { memoryFog: req.memoryFog } : {}),
    ...(fullnessSignal !== null ? { fullness: fullnessSignal } : {}),
    ...(req.skillHint !== undefined
      ? { skillFamiliarity: req.skillHint.purpose }
      : {}),
    ...(req.selfNarrative !== undefined
      ? { selfNarrative: req.selfNarrative }
      : {}),
    ...(req.peerMemory !== undefined ? { peerMemory: req.peerMemory } : {}),
  });

  const adjustments: Adjustment[] = [];
  for (const r of facetReadings) {
    if (r.adjustment !== null) adjustments.push(r.adjustment);
  }

  const usage = sumUsage([
    ...facetReadings.map((r) => r.usage),
    impulse.usage,
    conv.usage,
    synth.usage,
  ]);
  const userPrompt = serializePrompts(
    facetReadings,
    impulse.userPrompt,
    conv.userPrompt,
    synth.userPrompt,
  );
  const raw = serializeRaw(facetReadings, impulse.raw, conv.raw, synth.raw);

  // Stage 4 (Step 8) — action-picker. The Id now decides the world
  // action; the Surface is invoked downstream only for speech
  // rendering. When `req.actionStage` is omitted (legacy callers /
  // tests that drive the pipeline directly without a world), we
  // skip this stage and leave `actions` empty.
  let actions: SurfaceAction[] = [];
  let actionTrace: IdReasoning["actionTrace"] = null;
  let speakRequested = false;
  let speakAddressee: string | null = null;
  let totalUsage = usage;
  if (req.actionStage) {
    const stage = req.actionStage;
    const actionResult = await invokeIdAction({
      ghostId: stage.ghostId,
      tools: stage.tools,
      mcp: stage.mcp,
      memoryClient: stage.memoryClient,
      knownGhosts: stage.knownGhosts,
      currentCascadeIndex: stage.currentCascadeIndex,
      personality: req.personality,
      stimulus: req.stimulus,
      ...(req.activeExternalFacets !== undefined
        ? { activeExternalFacets: req.activeExternalFacets }
        : {}),
      monologue: synth.monologue,
      superObjective: conv.superObjective,
      impulse: impulse.impulse,
      primalDrive,
      ...(req.objective !== undefined ? { objective: req.objective } : {}),
      ...(req.selfDisplayName !== undefined
        ? { selfDisplayName: req.selfDisplayName }
        : {}),
      ...(req.worldContext !== undefined ? { worldContext: req.worldContext } : {}),
      needs: req.needs ?? defaultNeedsForAction(),
      ...(stage.bingeActive !== undefined ? { bingeActive: stage.bingeActive } : {}),
      ...(req.skillHint !== undefined ? { skillHint: req.skillHint.hintText } : {}),
      ...(stage.onRunEvent !== undefined ? { onRunEvent: stage.onRunEvent } : {}),
      ...(req.selfNarrative !== undefined ? { selfNarrative: req.selfNarrative } : {}),
      ...(req.peerMemory !== undefined ? { peerMemory: req.peerMemory } : {}),
      ...(req.pendingPerception !== undefined ? { pendingPerception: req.pendingPerception } : {}),
    });
    actions = actionResult.actions.map((a) => a.action);
    speakRequested = actionResult.speakRequested;
    speakAddressee = actionResult.speakAddressee;
    actionTrace = {
      userPrompt: actionResult.userPrompt,
      raw: actionResult.raw,
      usage: actionResult.usage,
      recalls: actionResult.recalls,
      actionOutcomes: actionResult.actions,
      delegations: actionResult.handoffs,
    };
    totalUsage = sumUsage([usage, actionResult.usage]);
  }

  return {
    superObjective: conv.superObjective,
    monologue: synth.monologue,
    adjustments,
    usage: totalUsage,
    userPrompt,
    raw,
    facetReadings,
    emotionalRead: conv.emotionalRead,
    impulse: impulse.impulse,
    primalDrive,
    actions,
    actionTrace,
    speakRequested,
    speakAddressee,
  };
}

/** When the caller omits `needs`, default to satiated midpoint so the
 *  recall gates pass through. */
function defaultNeedsForAction(): NeedProfile {
  return midpointNeeds();
}

/**
 * Cascade `task` strings are the formatted stimulus from each prior
 * step. Pass them through as-is (newest cascades come first from the
 * memory layer; flip to oldest-first for the facet agent's prompt).
 */
function extractRecentTriggers(
  cascades: readonly CascadeReplay[],
): ReadonlyArray<string> {
  const out: string[] = [];
  for (const c of cascades) {
    if (typeof c.task === "string" && c.task.length > 0) out.push(c.task);
  }
  return out.reverse();
}

/**
 * Pull the most recent surface action and its outcome out of cascade
 * history for the impulse agent. Cascades are returned newest-first;
 * within each cascade the steps are insertion-ordered, and the last
 * step with a non-null `action` is the surface choice (followed by
 * `observation` carrying the outcome).
 */
function extractLastDecision(
  cascades: readonly CascadeReplay[],
): { lastAction: string | undefined; lastOutcome: string | undefined } {
  for (const c of cascades) {
    for (let i = c.steps.length - 1; i >= 0; i--) {
      const step = c.steps[i];
      if (step && step.action) {
        return {
          lastAction: step.action,
          lastOutcome: step.observation ?? undefined,
        };
      }
    }
  }
  return { lastAction: undefined, lastOutcome: undefined };
}

function sumUsage(
  list: ReadonlyArray<{ prompt: number; completion: number; total: number } | null>,
): { prompt: number; completion: number; total: number } | null {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let any = false;
  for (const u of list) {
    if (u === null) continue;
    any = true;
    prompt += u.prompt;
    completion += u.completion;
    total += u.total;
  }
  return any ? { prompt, completion, total } : null;
}

function serializePrompts(
  facetReadings: ReadonlyArray<FacetReading>,
  impulse: string,
  conv: string,
  synth: string,
): string {
  const parts: string[] = [];
  for (const r of facetReadings) {
    parts.push(`---- FACET: ${r.facet} ----\n${r.userPrompt}`);
  }
  parts.push(`---- IMPULSE ----\n${impulse}`);
  parts.push(`---- CONVERGENCE ----\n${conv}`);
  parts.push(`---- SYNTHESIS ----\n${synth}`);
  return parts.join("\n\n");
}

function serializeRaw(
  facetReadings: ReadonlyArray<FacetReading>,
  impulse: string,
  conv: string,
  synth: string,
): string {
  const parts: string[] = [];
  for (const r of facetReadings) {
    parts.push(`---- ${r.facet} ----\n${r.raw}`);
  }
  parts.push(`---- IMPULSE ----\n${impulse}`);
  parts.push(`---- CONVERGENCE ----\n${conv}`);
  parts.push(`---- SYNTHESIS ----\n${synth}`);
  return parts.join("\n\n");
}

/**
 * Kept for verbose-mode startup printing. The new architecture has
 * 9 distinct system prompts (8 facet + convergence + synthesis); this
 * is a summary of the pipeline shape.
 */
export const ID_SYSTEM_PROMPT = `[Id pipeline — replaces the legacy single-call Id]

Stage 1 (parallel — two chains run side by side):
  (a) 8 facet agents in parallel — Ideas, Deliberation, Assertiveness, Warmth, Trust, Altruism, Stability, Self-Monitoring.
      Each sees only its own slider, the current trigger, and recent trigger history.
      Each emits {judgment, optional adjustment, 1-2 sentence reading}.
  (b) Impulse agent (slider-blind) — emits a 2-8 word action-oriented urge ("go north", "take the brass key").

Stage 2: convergence agent — receives the 8 facet readings, emits {emotionalRead, superObjective}.
  Super-objective is EMOTIONAL FLAVOR ("make people like me", "stay invisible") — never an action.
  Sees no slider numbers.

Stage 3: synthesis agent — receives convergence + impulse + raw trigger + world-now.
  Weaves the impulse (action-pull) and super-objective (emotional flavor) into stream of consciousness.
  All voice constraints live here.

Per-facet system prompts contain the archetypes that ground each slider's meaning (see reason-id-facets.ts).`;
