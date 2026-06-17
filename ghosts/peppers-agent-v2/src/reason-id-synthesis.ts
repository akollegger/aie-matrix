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

import { renderItemsHereLine } from "./cognition/world-props.js";
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
  /** Felt-vocabulary phrase describing memory truncation (Step 4
   *  substrate gate). Threaded into the monologue prompt so the
   *  fog is voiced as felt experience. */
  readonly memoryFog?: string;
  /** Felt-vocabulary phrase from `fullnessFelt(needs)` — fires at
   *  Fuel ≥ setpoint + 0.5, before the primal drive does. The
   *  brain needs a literal "you are full" cue from the substrate,
   *  otherwise it has no signal to stop eating before binge
   *  territory. Null when Fuel is at or below comfortable. */
  readonly fullness?: string;
  /** Sleep-pipeline Skill match (Step D): the purpose line of a
   *  procedure distilled from this ghost's own consolidated
   *  experience whose trigger matched the current stimulus. Voiced
   *  as felt familiarity — a hint the monologue can take or ignore,
   *  never an instruction. */
  readonly skillFamiliarity?: string;
  /** The ghost's self-narrative — its own first-person "who I am",
   *  written by itself at its last sleep under a hard size cap. The
   *  deepest identity anchor the monologue has. */
  readonly selfNarrative?: string;
  /** Substrate push-recall: remembered exchanges with the ghost who
   *  triggered this cascade. */
  readonly peerMemory?: string;
}

const SYSTEM_PROMPT = `Write the character's first-person thought right now. 1-3 sentences. Output JSON: {"monologue": "..."}.`;

export async function invokeSynthesis(
  req: InvokeSynthesisRequest,
): Promise<SynthesisResult> {
  const lines: string[] = [];

  if (req.selfDisplayName) {
    lines.push(`You are ${req.selfDisplayName}. That is your name and your only identity — you have no other handle. When your stream of consciousness references yourself, it is ${req.selfDisplayName}.`);
    lines.push("");
  }

  if (req.selfNarrative) {
    lines.push(`Who you are, in your own words (written by you in your last sleep):`);
    lines.push(req.selfNarrative);
    lines.push("");
  }

  if (req.objective) {
    lines.push(`Surface objective (context only): ${req.objective}`);
    lines.push("");
  }

  lines.push(`Emotional read: ${req.emotionalRead}`);
  lines.push(`Super-objective (emotional flavor — colors HOW the ghost acts): ${req.superObjective}`);
  lines.push(`Impulse (primal action-pull — what the ghost wants to DO): ${req.impulse}`);
  if (req.memoryFog) {
    lines.push(`Memory feels: ${req.memoryFog}.`);
  }
  if (req.fullness) {
    lines.push(`Body feels: ${req.fullness}.`);
  }
  if (req.skillFamiliarity) {
    lines.push(`Familiarity: this kind of moment has happened before — ${req.skillFamiliarity}`);
  }
  if (req.peerMemory) {
    lines.push(req.peerMemory);
  }
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
    const itemsLine = renderItemsHereLine(ctx.takeableItemRefs, ctx.takeableItemsHere);
    if (itemsLine !== null) wlines.push(itemsLine);
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

  try {
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
  } catch (err) {
    // Low maxTokens (starving ghost) can truncate the JSON mid-string;
    // the parse fails. The mechanic — degraded cognition — is preserved
    // by returning an empty monologue: the ghost literally couldn't
    // form a thought. The cascade continues with the impulse alone.
    const message = err instanceof Error ? err.message : String(err);
    const partial = extractPartialMonologue(message);
    return {
      monologue: partial,
      usage: null,
      userPrompt: user,
      raw: message,
    };
  }
}

/** Pull whatever made it past `{"monologue":"` before the truncation. */
function extractPartialMonologue(errMessage: string): string {
  const rawIdx = errMessage.indexOf("--- raw ---\n");
  if (rawIdx < 0) return "";
  const raw = errMessage.slice(rawIdx + "--- raw ---\n".length);
  const m = raw.match(/"monologue"\s*:\s*"([^"]*)/);
  return m && m[1] ? m[1] : "";
}
