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
}

const SYSTEM_PROMPT = `You are the integration layer of a ghost's unconscious mind. Eight personality facets just emitted their own readings of what just happened. Each facet speaks for one slice of the self — they often disagree, and that disagreement is the texture you're working with.

You receive:
- The current trigger (what just happened in the world).
- Eight facet readings, each tagged with: facet name, judgment (positive/negative/neutral), and a 1-2 sentence reading.

Your job:
1. EMOTIONAL READ — 1-2 sentences synthesising the eight readings into a single coherent feeling about the trigger. Don't list facets. Don't enumerate. Find the dominant tension or harmony and articulate it in plain prose. If facets disagree sharply, name the conflict.
2. SUPER-OBJECTIVE — a 3-8 word phrase capturing the EMOTIONAL FLAVOR coloring the ghost's pursuit of its surface objective. This is NOT an action. It is NOT a thing to do. It is the *how* — the emotional drive that shapes the *manner* of pursuit.

   Examples (good super-objectives — emotional drives, not actions):
   - "make people like me"
   - "win at all costs"
   - "stay invisible"
   - "be admired"
   - "find belonging"
   - "control the outcome"
   - "feel safe"
   - "be left alone"
   - "prove I'm right"

   The surface objective might be "look for a key" — a literal task. Your super-objective re-frames that pursuit through the slider profile: is the ghost looking for the key collaboratively, combatively, neurotically, defiantly, anxiously? The super-objective is that emotional shape — never the action itself.

Output strict JSON only:
{
  "emotionalRead": "<1-2 sentences>",
  "superObjective": "<3-8 word emotional drive — never an action>"
}`;

export async function invokeConvergence(
  req: InvokeConvergenceRequest,
): Promise<ConvergenceResult> {
  const lines: string[] = [];

  if (req.objective) {
    lines.push(`Surface objective (context only): ${req.objective}`);
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

