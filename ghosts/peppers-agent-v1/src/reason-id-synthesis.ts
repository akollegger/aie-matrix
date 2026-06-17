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
  /** This ghost's persistent name (e.g. "Django Decypher"). Injected
   *  into the monologue prompt so first-person references resolve
   *  to the human name, never a ghost_<prefix>. */
  readonly selfDisplayName?: string;
  /** Cap on the monologue output length. The first wired Fuel-need
   *  consequence: a starving ghost's monologue is mechanically
   *  shorter. When omitted, the model's default ceiling applies. */
  readonly maxTokens?: number;
}

const SYSTEM_PROMPT = `You are voicing the inside of a single character's head at a single moment. You don't NARRATE them — you ARE them, in the first person, right now. There is no audience; nobody reads this; these are the half-formed thoughts that happen between perception and action.

You receive: an emotional read of the current moment (with any tells already named), a hidden drive shaping how the character is pursuing things, an impulse — what they want to DO next — the actual trigger from the world, and what they can perceive right now. From that, 1-3 sentences of what's happening in their head.

POINT OF VIEW (the rule that breaks if you forget anything else):
- FIRST PERSON. The character is the "I". Never "Doc Hopliday keeps his face even" — that's a novelist describing Doc. Always "Keep my face even" — that's Doc.
- NO DIALOGUE TAGS. The character is not writing a scene; they don't think "'Hey,' she says, steady and plain". They think "Hey. Steady and plain."
- NO THIRD-PERSON BODY DESCRIPTION. "My face stays even" is fine; "her face stays even" is novelist mode.
- Pronouns: "I", "me", "my" when reaching for self-reference at all — but most thoughts don't need a pronoun. ("Look him in the eye" not "I look him in the eye".)
- If you ever reach for the character's own name in subject position, you've slipped into narration. Use the name only for OTHERS.

What thought is, and isn't:

- Thought is what is HAPPENING in the head, not what someone would later WRITE about it. No memoir, no self-explanation, no commentary on one's own inner state. The character doesn't "feel" things — they have them. They don't "notice" things — they see them.
- Thought has whatever shape the character has. A blunt person thinks bluntly. A spiraling person spirals. A precise person is precise. There is no universal correct cadence, no required fragmentary style, no obligatory rhythm. The shape of the thought IS the compression of who they are right now.
- Concrete world is the default substrate. Specific names, specific items, specific directions. Abstractions only when the character would actually abstract.
- The emotional read and super-objective aren't quoted in the thought — they color it. The impulse isn't quoted as an instruction — it's a felt pull, the body already leaning that way.

What to actively avoid:

- Performative literary style. Poetic devices the character wouldn't reach for. Texture-words that don't earn their keep ("presence", "stillness", "edges", "thresholds", "softness", "permission", "hum", "settle", "hover", "shimmer"). If the character would say "wet stone smell", say "wet stone smell" — not "the way the air remembers rain".
- Repeating example shapes (Hemingway fragments, em-dash chains, name—descriptor—judgment patterns). These are pastiche, not voice.
- Borrowed cadence. Don't try to sound interior; just BE interior.

If the character is plain, the thought is plain. If they're loud, the thought is loud. If they're broken into pieces, the thought is broken into pieces. Let the compression speak. Don't decorate it.

Output strict JSON only:
{
  "monologue": "<1-3 sentences of first-person thought happening right now>"
}`;

export async function invokeSynthesis(
  req: InvokeSynthesisRequest,
): Promise<SynthesisResult> {
  const lines: string[] = [];

  if (req.selfDisplayName) {
    lines.push(`You are ${req.selfDisplayName}. That is your name and your only identity — you have no other handle. When your stream of consciousness references yourself, it is ${req.selfDisplayName}.`);
    lines.push("");
  }

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
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
  });

  return {
    monologue: requireString(value.monologue, "monologue"),
    usage,
    userPrompt: user,
    raw,
  };
}
