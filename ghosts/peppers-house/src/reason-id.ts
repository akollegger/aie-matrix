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

import {
  STARTER_FACETS,
  type Adjustment,
  type PersonalityState,
  type Stimulus,
} from "@aie-matrix/ghost-peppers-inner";

import type { CascadeReplay } from "@aie-matrix/ghost-peppers-mem";

import {
  invokeFacetAgent,
  type FacetReading,
} from "./reason-id-facet-agent.js";
import { invokeConvergence } from "./reason-id-convergence.js";
import { invokeImpulse } from "./reason-id-impulse.js";
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
}

export interface InvokeIdRequest {
  readonly personality: PersonalityState;
  readonly stimulus: Stimulus;
  readonly recentCascades: readonly CascadeReplay[];
  readonly worldContext?: WorldContext;
  readonly objective?: string;
}

export async function invokeId(req: InvokeIdRequest): Promise<IdReasoning> {
  const recentTriggers = extractRecentTriggers(req.recentCascades);
  const { lastAction, lastOutcome } = extractLastDecision(req.recentCascades);

  // Stage 1 — TWO parallel chains:
  //   (a) Eight facet agents in parallel → convergence (sequential).
  //       Produces emotional read + super-objective (slider-shaped flavor).
  //   (b) Impulse agent (single call, action-oriented). Sees current
  //       slider state + the last decision/outcome so it can build on
  //       momentum or pivot when something just failed.
  // Both feed synthesis. Running (b) in parallel with (a) keeps the
  // pipeline at three sequential layers: facet → convergence → synthesis,
  // with impulse finishing alongside facets (faster, simpler input).
  const [facetReadings, impulse] = await Promise.all([
    Promise.all(
      STARTER_FACETS.map((facet) =>
        invokeFacetAgent({
          facet,
          state: req.personality,
          stimulus: req.stimulus,
          recentTriggers,
          objective: req.objective,
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
    }),
  ]);

  // Stage 2 — convergence: the eight facet readings → one feeling + flavor.
  const conv = await invokeConvergence({
    facetReadings,
    stimulus: req.stimulus,
    objective: req.objective,
  });

  // Stage 3 — synthesis: voice it. Receives BOTH the emotional flavor
  // (super-objective) and the action-pull (impulse), weaves them.
  const synth = await invokeSynthesis({
    emotionalRead: conv.emotionalRead,
    superObjective: conv.superObjective,
    impulse: impulse.impulse,
    stimulus: req.stimulus,
    worldContext: req.worldContext,
    objective: req.objective,
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

  return {
    superObjective: conv.superObjective,
    monologue: synth.monologue,
    adjustments,
    usage,
    userPrompt,
    raw,
    facetReadings,
    emotionalRead: conv.emotionalRead,
    impulse: impulse.impulse,
  };
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
