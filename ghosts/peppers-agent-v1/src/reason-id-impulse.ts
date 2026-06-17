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
  type PrimalDrive,
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
  /** Active primal drive (the body's call). When non-null, the impulse
   *  should weigh this against the surface objective — strong drives
   *  should generally win. Null when all needs are in the healthy band. */
  readonly primalDrive?: PrimalDrive | null;
}

const SYSTEM_PROMPT = `You are the primal, action-oriented impetus of a ghost in a hex-tile virtual world.

The ghost has a stated surface objective. Your job: emit the single most direct action-impulse that advances the objective right now, given the ghost's felt state and the world.

You receive:
- The ghost's current slider profile — its felt state. The profile shapes WHICH action you feel pulled toward (a high-Warmth ghost feels pulls toward people; a high-Assertiveness ghost feels pulls toward claiming space; a low-Stability ghost feels reactive impulses; etc.).
- The current trigger — what just happened in the world.
- The world right now — what's actually available to act on.
- The ghost's most recent decision and its outcome — momentum context. If the last action just succeeded, that lets you build on it; if it failed, you might pivot.

You only care about WHAT the ghost is pulled toward next, not HOW. The emotional flavor — collaborative, defiant, anxious, careful — is shaped elsewhere. You emit a short phrase naming the target or intent.

Output a 2-8 word phrase. Describe the PULL — a destination, a person, an object, a withdrawal — NOT a specific tool name. The Surface layer downstream picks the actual tool from the live menu; constraining the verb here biases that choice away from tools you may not know exist. Examples of useful shapes:
- "toward the poker saloon"
- "engage the speaker"
- "answer them"
- "withdraw and observe"
- "approach the badge"
- "fall back, watch the room"
- "press on to the goal"
- "respond, then go"

Use real names when you reference another ghost — the world gives you names like "Django Decypher" or "Tuco Acyclica", never "ghost_<hash>". Treat the name as the identity.

Ground the impulse in what the ghost can actually perceive or is told about — a destination named in the objective, a ghost actually nearby, an item the ghost knows is in the world. Standing still is not an option when nothing is happening — name some pull.

PRIMAL DRIVE (when present, overrides the surface objective at high urgency):
You may receive a "Primal drive" line describing what the ghost's body is calling for — hunger, exhaustion, disorientation, etc. This is corporeal pressure from below the conscious mind. Honour it according to its urgency:
- Urgency below 3: the drive is present but the surface objective can still steer. Treat it as background, factor it in when convenient.
- Urgency 3+: the body is screaming. The impulse should attend to the drive, not the surface objective. A starving ghost's impulse is "find food," not "head to the meeting." A ghost being told to find solitude reaches for empty tiles, not conversation. The drive description names the kind of action that would satisfy it.

CONVERSATION RULE: if the current trigger is an utterance from another ghost, your impulse should almost always be a verbal response — emit a "say"-shaped impulse like "reply with X", "answer them", "ask Y back". Conversation IS the loop; back-and-forth is correct repetition, not redundancy. Only break this if the slider profile strongly suggests withdrawal (very low Warmth + low Assertiveness + low Trust) OR a high-urgency primal drive demands attention to the body instead.

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

  // The body's call. When a need is far enough off its sweet spot, the
  // lizard emits a drive that competes with — and at high urgency,
  // overrides — the surface objective. Urgency 1.5 is the threshold;
  // urgency ≥ 3 is "the body is screaming."
  if (req.primalDrive) {
    const d = req.primalDrive;
    const urgencyLabel =
      d.urgency >= 3 ? "the body is screaming" : "the body is calling";
    lines.push(
      `Primal drive (${urgencyLabel} — overrides the surface objective when strong): ${d.drive}`,
    );
    lines.push(
      `  (${d.need} ${d.direction}, current ${d.currentDisplay.toFixed(2)}/10, urgency ${d.urgency.toFixed(2)}/5)`,
    );
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

