/**
 * Impulse stage: the primal, action-oriented impetus.
 *
 * Slider-blind. Doesn't care about feelings, archetypes, or how the
 * ghost should pursue its objective — only WHAT the ghost should do
 * next to advance the surface objective.
 *
 * Runs in parallel with the facet/convergence chain. Both streams
 * feed the synthesis stage, which weaves the action-impulse and the
 * emotional flavor (super-objective) into a single stream of
 * consciousness.
 */

import {
  STARTER_FACETS,
  toDisplay,
  type PersonalityState,
  type Stimulus,
} from "@aie-matrix/ghost-peppers-inner";

import { formatStimulus } from "./format-stimulus.js";
import { chatJson } from "./llm-client.js";
import { requireString } from "./parse-helpers.js";
import type { WorldContext } from "./reason-surface.js";

export interface ImpulseResult {
  /** 2-8 word action-oriented phrase. */
  readonly impulse: string;
  readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
  readonly userPrompt: string;
  readonly raw: string;
}

export interface InvokeImpulseRequest {
  /** Current slider profile — shapes WHICH action the ghost feels pulled toward. */
  readonly personality: PersonalityState;
  readonly stimulus: Stimulus;
  readonly worldContext?: WorldContext;
  readonly objective?: string;
  /** Most recent surface action (formatted), if any. */
  readonly lastAction?: string;
  /** Outcome of the most recent action (formatted), if any. */
  readonly lastOutcome?: string;
}

const SYSTEM_PROMPT = `You are the primal, action-oriented impetus of a ghost in a hex-tile virtual world.

The ghost has a stated surface objective. Your job: emit the single most direct action-impulse that advances the objective right now, given the ghost's felt state and the world.

You receive:
- The ghost's current slider profile — its felt state. The profile shapes WHICH action you feel pulled toward (a high-Warmth ghost feels pulls toward people; a high-Assertiveness ghost feels pulls toward claiming space; a low-Stability ghost feels reactive impulses; etc.).
- The current trigger — what just happened in the world.
- The world right now — what's actually available to act on.
- The ghost's most recent decision and its outcome — momentum context. If the last action just succeeded, that lets you build on it; if it failed, you might pivot.

You only care about WHAT happens next, not HOW. The emotional flavor of the action — collaborative, defiant, anxious, careful — is shaped elsewhere. You emit the raw verb-and-target.

Output a 2-8 word phrase. Examples of good shapes:
- "reply to ghost_<name>"
- "answer their question"
- "ask their name"
- "say something back"
- "go north"
- "take the brass key"
- "head toward an exit"
- "drop the key here"

Ground the impulse in what's actually available — only suggest going toward a real exit, taking an item that's actually here, talking to a ghost that's actually present. If the world offers nothing pulling the ghost in any direction, default to "go" toward an available exit. Standing still is not an option when nothing is happening.

CONVERSATION RULE (most important): if the current trigger is an utterance from another ghost, your impulse should almost always be a verbal response — emit a "say"-shaped impulse like "reply with X", "answer them", "ask Y back". Conversation IS the loop; back-and-forth is correct repetition, not redundancy. Only break this if the slider profile strongly suggests withdrawal (e.g., very low Warmth + very low Assertiveness + very low Trust).

For non-conversation triggers, prefer novelty over verbatim repeats — if the last action just succeeded, build on it rather than redoing the exact same step.

Don't justify. Don't deliberate. Just emit the impulse.

Output strict JSON only:
{
  "impulse": "<2-8 word action-oriented phrase>"
}`;

export async function invokeImpulse(
  req: InvokeImpulseRequest,
): Promise<ImpulseResult> {
  const lines: string[] = [];

  if (req.objective) {
    lines.push(`Surface objective (the goal you serve): ${req.objective}`);
    lines.push("");
  }

  lines.push("Slider profile (your felt state — shapes what kind of action pulls at you):");
  for (const facet of STARTER_FACETS) {
    const t = req.personality[facet];
    const i = toDisplay(t.internal).toFixed(2);
    const e = toDisplay(t.external).toFixed(2);
    lines.push(`  ${facet}: I=${i}, E=${e}`);
  }
  lines.push("");

  if (req.lastAction) {
    lines.push(`Last decision: ${req.lastAction}`);
  }
  if (req.lastOutcome) {
    lines.push(`Last outcome: ${req.lastOutcome}`);
  }
  if (req.lastAction || req.lastOutcome) {
    lines.push("");
  }

  lines.push(`Current trigger: ${formatStimulus(req.stimulus)}`);

  if (req.worldContext) {
    const ctx = req.worldContext;
    const wlines: string[] = [];
    if (ctx.availableExits && ctx.availableExits.length > 0) {
      wlines.push(`exits: ${ctx.availableExits.join(", ")}`);
    } else if (ctx.availableExits) {
      wlines.push("exits: none");
    }
    if (ctx.nearbyGhostIds && ctx.nearbyGhostIds.length > 0) {
      wlines.push(`ghosts nearby: ${ctx.nearbyGhostIds.join(", ")}`);
    }
    if (ctx.takeableItemRefs && ctx.takeableItemRefs.length > 0) {
      wlines.push(`items here: ${ctx.takeableItemRefs.join(", ")}`);
    }
    if (ctx.inventoryItemRefs && ctx.inventoryItemRefs.length > 0) {
      wlines.push(`carrying: ${ctx.inventoryItemRefs.join(", ")}`);
    }
    if (wlines.length > 0) {
      lines.push("");
      lines.push("World now:");
      for (const w of wlines) lines.push(`  ${w}`);
    }
  }

  lines.push("");
  lines.push("Return JSON only.");

  const user = lines.join("\n");

  const { value, usage, raw } = await chatJson<{ impulse?: unknown }>({
    system: SYSTEM_PROMPT,
    user,
  });

  return {
    impulse: requireString(value.impulse, "impulse"),
    usage,
    userPrompt: user,
    raw,
  };
}

