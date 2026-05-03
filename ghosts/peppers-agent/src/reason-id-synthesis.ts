/**
 * Synthesis stage: voices the stream-of-consciousness monologue from
 * the convergence layer's emotional read + super-objective + raw
 * trigger + concrete world context.
 *
 * All voice constraints (anti-narrator framing, anti-poetry,
 * fragments-first) live here — the upstream stages emit plain prose,
 * so this stage doesn't have to fight personality reasoning AND voice
 * in the same call.
 */

import type { Stimulus } from "@aie-matrix/ghost-peppers-inner";

import { formatStimulus } from "./format-stimulus.js";
import { chatJson } from "./llm-client.js";
import { requireString } from "./parse-helpers.js";
import type { WorldContext } from "./reason-surface.js";

export interface SynthesisResult {
  readonly monologue: string;
  readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
  readonly userPrompt: string;
  readonly raw: string;
}

export interface InvokeSynthesisRequest {
  readonly emotionalRead: string;
  readonly superObjective: string;
  /** Action-oriented urge from the impulse agent — what the ghost wants to DO. */
  readonly impulse: string;
  readonly stimulus: Stimulus;
  readonly worldContext?: WorldContext;
  readonly objective?: string;
}

const SYSTEM_PROMPT = `You voice the ghost's stream of consciousness — the unspoken half-thoughts that scroll through its head moment by moment.

You receive: an emotional read of the current moment, a hidden drive pulling on the ghost, the actual trigger from the world, and what the ghost can perceive right now. You emit 1-3 sentences in the ghost's voice.

Strict rules:

- The monologue is **stream of consciousness, NOT narration of inner experience**. This is what unspoken thought sounds like — not how someone would later describe their inner life to a reader.
- Use FRAGMENTS more than full sentences. Reactions, half-thoughts, sensory hits, judgments. World-first.
- **DO NOT use "I feel X" / "I notice Y" / "I sense Z" / "my [bodypart] [verbs]" constructions.** These are narrator-from-outside framings. Just have the thought directly.
- DO NOT introspect about your own inner state in third-person ("my attention sharpens", "my steadiness tightens"). Have the experience, don't report on it.
- DO NOT use texture-poetry filler words: "presence", "stillness", "edges", "thresholds", "softness", "permission", "ripple", "hum", "settle", "hover".
- Reference the SPECIFIC thing in the world: the brass key, the named ghost, the specific direction. Be concrete.
- DO NOT mention the emotional read or super-objective directly. They shape your voice; they aren't its content.
- You will receive an IMPULSE — a primal, action-oriented urge ("go north", "take the brass key", "ask their name"). Weave it into the stream of consciousness as a felt pull, not as a quoted line. The impulse is what the ghost wants to DO next; the super-objective is the emotional flavor coloring HOW. Both must come through.

Examples of WRONG (memoir-style, narrator-from-inside):
  ✗ "I feel my steadiness tighten as I track their movement tile by tile."
  ✗ "The X catches my eye and I notice my urge to act rise."
  ✗ "I hover at the edge of certainty, letting the moment settle."

Examples of RIGHT (immersed, fragmentary, world-first):
  ✓ "Sound from the next tile. Footsteps? Maybe. Keep walking."
  ✓ "Empty room. Boring. Where now."
  ✓ "<thing in front of me>. <one detail>. <one judgment or impulse>. <next move>."

The example shapes are about RHYTHM, not content. Don't borrow names, items, or directions from them.

Output strict JSON only:
{
  "monologue": "<1-3 sentences of stream of consciousness>"
}`;

export async function invokeSynthesis(
  req: InvokeSynthesisRequest,
): Promise<SynthesisResult> {
  const lines: string[] = [];

  if (req.objective) {
    lines.push(`Surface objective (context only): ${req.objective}`);
    lines.push("");
  }

  lines.push(`Emotional read: ${req.emotionalRead}`);
  lines.push(`Super-objective (emotional flavor — colors HOW the ghost acts): ${req.superObjective}`);
  lines.push(`Impulse (primal action-pull — what the ghost wants to DO): ${req.impulse}`);
  lines.push("");

  lines.push(`Current trigger: ${formatStimulus(req.stimulus)}`);

  if (req.worldContext) {
    const ctx = req.worldContext;
    const wlines: string[] = [];
    if (ctx.availableExits && ctx.availableExits.length > 0) {
      wlines.push(`exits: ${ctx.availableExits.join(", ")}`);
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

  const { value, usage, raw } = await chatJson<{ monologue?: unknown }>({
    system: SYSTEM_PROMPT,
    user,
  });

  return {
    monologue: requireString(value.monologue, "monologue"),
    usage,
    userPrompt: user,
    raw,
  };
}

