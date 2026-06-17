/**
 * Convergence stage: weaves the eight facet readings into a single
 * coherent emotional read of the trigger, plus a super-objective.
 *
 * Crucially, this stage sees ONLY the facets' natural-language
 * readings — never raw slider numbers. The compression lives at the
 * boundary between facet agents and convergence.
 */

import type { Stimulus } from "@aie-matrix/ghost-peppers-inner";

import { formatStimulus } from "./format-stimulus.js";
import { chatJson } from "./llm-client.js";
import { requireString } from "./parse-helpers.js";
import type { FacetReading } from "./reason-id-facet-agent.js";

export interface ConvergenceResult {
  /** 1-2 sentence synthesis of how the ghost feels about this trigger. */
  readonly emotionalRead: string;
  /** 3-8 word phrase: the dominant pull this turn. */
  readonly superObjective: string;
  readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
  readonly userPrompt: string;
  readonly raw: string;
}

export interface InvokeConvergenceRequest {
  readonly facetReadings: ReadonlyArray<FacetReading>;
  readonly stimulus: Stimulus;
  readonly objective?: string;
  /** Previous super-objectives from the last few cascades (oldest →
   *  newest). Convergence uses these to preserve committed plans
   *  across ticks rather than regenerating fresh each cascade —
   *  prevents the "talk forever, never act" loop. */
  readonly recentSuperObjectives?: ReadonlyArray<string>;
  /** One-line summaries of the last few cascades' triggers + actions,
   *  oldest → newest. Lets convergence see "we just agreed to go
   *  somewhere" and preserve that into the super-objective. */
  readonly recentTriggers?: ReadonlyArray<string>;
}

const SYSTEM_PROMPT = `You are the integration layer of a ghost's unconscious mind. Eight personality facets just emitted their own readings of what just happened. Each facet speaks for one slice of the self — they often disagree, and that disagreement is the texture you're working with.

You receive:
- The current trigger (what just happened in the world).
- Eight facet readings, each tagged with: facet name, judgment, and a 1-2 sentence reading. The readings speak from inside — they describe the FELT state of each facet, not how it's performed. (The performed/projected face is the Surface's purview downstream; you don't reason about it here.)
- Optionally: the ghost's recent super-objectives + a one-line summary of recent triggers + actions.

Your job:
1. EMOTIONAL READ — 1-2 sentences synthesising the eight readings into a single coherent felt state. Don't list facets. Don't enumerate. If facets disagree sharply, name the conflict — that disagreement is real interiority, not a failure to integrate. The read describes what the ghost FEELS right now; how that feels gets performed is decided downstream by the Surface.

2. SUPER-OBJECTIVE — a 3-8 word phrase capturing the EMOTIONAL FLAVOR coloring the ghost's pursuit of its surface objective. This is NOT an action. It is NOT a thing to do. It is the *how* — the emotional drive that shapes the *manner* of pursuit.

   Examples (good super-objectives — emotional drives, not actions):
   - "make people like me"
   - "win at all costs while hiding the panic"
   - "stay invisible"
   - "be admired without seeming to want it"
   - "find belonging"
   - "control the outcome"
   - "feel safe"
   - "be left alone"
   - "prove I'm right"

PLAN CONTINUITY (critical rule for getting plans to land):
If the recent super-objectives + recent triggers show that the ghost ALREADY committed to a course of action (e.g. last three cascades had super-objective "reach Black Bart's with allies" and recent triggers show ghosts agreeing on a destination), you MUST preserve that commitment into the new super-objective UNLESS the current trigger materially changes things (an injury, an arrival, a betrayal, a new and bigger pull). One ghost saying "let's go" three times and another agreeing is NOT a new event — it's the SAME plan, still uncompleted. Regenerating a fresh super-objective every cascade is the failure mode that traps ghosts in conversation loops; they need a felt drive that persists across ticks until executed or interrupted.

When you preserve a plan, the super-objective should reflect both the EMOTIONAL FLAVOR and the FACT THAT IT IS UNFULFILLED — e.g. "press on toward Black Bart's, no more talking" or "move with allies now, words later". This creates the pull the Surface needs to actually move.

Output strict JSON only:
{
  "emotionalRead": "<1-2 sentences — name the felt state, including any conflicts between facets>",
  "superObjective": "<3-8 word emotional drive — preserve committed plans across ticks>"
}`;

export async function invokeConvergence(
  req: InvokeConvergenceRequest,
): Promise<ConvergenceResult> {
  const lines: string[] = [];

  if (req.objective) {
    lines.push(`Surface objective (context only): ${req.objective}`);
    lines.push("");
  }

  // Plan-continuity context: recent super-objectives + the actions
  // that followed. Convergence uses these to decide "is there a
  // committed plan still in flight" and preserves it when present.
  if (req.recentSuperObjectives && req.recentSuperObjectives.length > 0) {
    lines.push("Recent super-objectives (oldest → newest):");
    for (const s of req.recentSuperObjectives) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }
  if (req.recentTriggers && req.recentTriggers.length > 0) {
    lines.push("Recent triggers + actions (oldest → newest):");
    for (const t of req.recentTriggers) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  lines.push(`Current trigger: ${formatStimulus(req.stimulus)}`);
  lines.push("");
  lines.push("Facet readings:");
  for (const r of req.facetReadings) {
    lines.push(`  - ${r.facet} [${r.judgment}]: ${r.reading}`);
  }
  lines.push("");
  lines.push("Return JSON only.");

  const user = lines.join("\n");

  const { value, usage, raw } = await chatJson<{
    emotionalRead?: unknown;
    superObjective?: unknown;
  }>({ system: SYSTEM_PROMPT, user });

  return {
    emotionalRead: requireString(value.emotionalRead, "emotionalRead"),
    superObjective: requireString(value.superObjective, "superObjective"),
    usage,
    userPrompt: user,
    raw,
  };
}

