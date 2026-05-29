/**
 * Single-facet agent. Reads ONE slider's current state + recent
 * trigger history + the current trigger, emits:
 *   1. judgment (positive | negative | neutral) from this facet's lens
 *   2. optional adjustment (this facet only, ≤1 delta)
 *   3. natural-language reading (1-2 sentences)
 *
 * Eight of these run in parallel each cascade. Voice constraints
 * (anti-narrator, anti-poetry, fragments) live in the synthesis stage,
 * NOT here — this stage emits plain functional prose.
 */

import {
  toDisplay,
  type Adjustment,
  type FacetName,
  type PersonalityState,
  type Stimulus,
} from "@aie-matrix/ghost-peppers-inner";

import { formatStimulus } from "./format-stimulus.js";
import { chatJson } from "./llm-client.js";
import { requireString } from "./parse-helpers.js";
import { FACET_SEMANTICS, type FacetSemantics } from "./reason-id-facets.js";
import {
  formatCharacterList,
  hasFacetData,
  resolveFacetExpression,
  type FacetExpression,
} from "./reason-id-facets-resolver.js";

export interface FacetReading {
  readonly facet: FacetName;
  readonly judgment: "positive" | "negative" | "neutral";
  readonly adjustment: Adjustment | null;
  /** 1-2 sentence reading from this facet's perspective. */
  readonly reading: string;
  readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
  readonly userPrompt: string;
  readonly raw: string;
  /**
   * The mechanically-resolved expression handed to the LLM (felt chars
   * + projected chars + mask + compound). Null when this facet used the
   * legacy numeric prompt path. Surfaced into the overlay so the
   * operator can see what slider state the LLM actually saw.
   */
  readonly expression: FacetExpression | null;
}

export interface InvokeFacetAgentRequest {
  readonly facet: FacetName;
  readonly state: PersonalityState;
  readonly stimulus: Stimulus;
  /** Pre-formatted trigger history, oldest → newest. May be empty. */
  readonly recentTriggers: ReadonlyArray<string>;
  readonly objective?: string;
}

export async function invokeFacetAgent(
  req: InvokeFacetAgentRequest,
): Promise<FacetReading> {
  const sem = FACET_SEMANTICS[req.facet];
  const trait = req.state[req.facet];
  const internal = toDisplay(trait.internal);
  const external = toDisplay(trait.external);
  const diff = internal - external;
  const mean = (internal + external) / 2;

  // Resolved facets get the mechanical (felt, projected) → prose
  // mapping. Unauthored facets fall back to the legacy numeric output
  // so they keep working until their content is filled in.
  const resolved = hasFacetData(req.facet)
    ? resolveFacetExpression(req.facet, req.state)
    : null;

  const system = resolved !== null
    ? buildSystemResolved(req.facet, sem)
    : buildSystem(req.facet, sem);
  const user = resolved !== null
    ? buildUserResolved({
        facet: req.facet,
        resolved,
        stimulus: req.stimulus,
        recentTriggers: req.recentTriggers,
        objective: req.objective,
      })
    : buildUser({
        facet: req.facet,
        internal,
        external,
        diff,
        mean,
        stimulus: req.stimulus,
        recentTriggers: req.recentTriggers,
        objective: req.objective,
      });

  const { value, usage, raw } = await chatJson<{
    judgment?: unknown;
    adjustment?: unknown;
    reading?: unknown;
  }>({ system, user });

  const judgment = parseJudgment(value.judgment);
  const adjustment = parseAdjustment(req.facet, value.adjustment);
  const reading = requireString(value.reading, "reading");

  return {
    facet: req.facet,
    judgment,
    adjustment,
    reading,
    usage,
    userPrompt: user,
    raw,
    expression: resolved,
  };
}

/**
 * System prompt for the resolved path: the prose interpretation of
 * (felt, projected) has already been computed in TypeScript, so the
 * prompt no longer hands the model raw numbers or asks it to locate
 * itself among quadrants. The model receives a resolved expression
 * grounded in named characters — its training corpus has rich
 * associations with these, far richer than any abstract label could
 * give. The model uses the felt + projected character triangulations
 * to inhabit the state directly.
 */
function buildSystemResolved(facet: FacetName, sem: FacetSemantics): string {
  return `You are the ${facet} aspect of a ghost's unconscious mind — one of eight personality facets, each speaking with its own voice.

What ${facet} measures: ${sem.meaning}

How ${facet} reads the world: ${sem.perceptualLens}

Each turn you receive: your current expressed state for this facet — what is felt inside (anchored by recognisable characters who exemplify that felt state), what is projected outside (anchored similarly), how the gap between them is working, and, when applicable, the compound archetype you most resemble right now. Then a brief history of recent triggers, and the current trigger.

The character anchors are the primary signal. They are not a vague analogy — you ARE that triangulation right now, on this facet, on this turn. Speak from inside it.

Your job — three things:
1. JUDGMENT — decide whether the current trigger is positive, negative, or neutral FROM ${facet}'S PERSPECTIVE. Other facets will read it differently; that's fine. Read it through ${facet}'s lens only.
2. ADJUSTMENT — optionally nudge your own slider (axis: internal or external; direction: up or down). Emit at most one. If the trigger doesn't move you, omit it (return null).
3. READING — 1-2 sentences in plain prose describing what just happened FROM ${facet}'S PERSPECTIVE. Write in a voice consistent with the character triangulation. When the mask description says the gap leaks, let the leak show in the prose. Not a monologue. Not stream of consciousness. Just a clear note from this aspect of the self.

Output strict JSON only:
{
  "judgment": "positive" | "negative" | "neutral",
  "adjustment": null OR { "axis": "internal" | "external", "direction": "up" | "down" },
  "reading": "<1-2 sentence reading from your perspective>"
}`;
}

function buildUserResolved(args: {
  facet: FacetName;
  resolved: FacetExpression;
  stimulus: Stimulus;
  recentTriggers: ReadonlyArray<string>;
  objective?: string;
}): string {
  const r = args.resolved;
  const lines: string[] = [];

  if (args.objective) {
    lines.push(`Surface objective (the ghost's conscious task — context only): ${args.objective}`);
    lines.push("");
  }

  lines.push(`Your current ${args.facet}:`);
  lines.push("");

  // Inside: composed sentence + character roster with per-character notes.
  lines.push(`  Inside, you're ${r.feltSummary} — ${formatCharacterList(r.feltCharacters)}.`);
  for (const c of r.feltCharacters) {
    lines.push(`    · ${c.name}: ${c.note}`);
  }
  lines.push("");

  // Outside: same shape.
  lines.push(`  Outside, you're ${r.projectedSummary} — ${formatCharacterList(r.projectedCharacters)}.`);
  for (const c of r.projectedCharacters) {
    lines.push(`    · ${c.name}: ${c.note}`);
  }
  lines.push("");

  // Mask state, derived from the gap.
  lines.push(`  Mask: ${r.maskDescription}`);
  lines.push("");

  // Compound archetype, when one is authored for this corner. Mid-cells
  // and quiet corners have no compound; the felt+projected+mask above
  // carries them on their own.
  if (r.compoundArchetype !== null) {
    lines.push(`  Together, this resolves as ${r.compoundArchetype.name}:`);
    lines.push(`    ${r.compoundArchetype.description}`);
    lines.push("");
  }

  if (args.recentTriggers.length > 0) {
    lines.push("Recent triggers (oldest → newest):");
    for (const t of args.recentTriggers) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  lines.push("Current trigger:");
  lines.push(formatStimulus(args.stimulus));
  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

function buildSystem(facet: FacetName, sem: FacetSemantics): string {
  return `You are the ${facet} aspect of a ghost's unconscious mind — one of eight personality facets, each speaking with its own voice.

What ${facet} measures: ${sem.meaning}

How ${facet} reads the world: ${sem.perceptualLens}

Your slider has two values:
- INTERNAL: how this facet feels (0–10 scale, 5 = midpoint).
- EXTERNAL: how this facet is projected to the outside world (0–10 scale).

The four quadrants of your slider, with archetypes:
- HIGH internal, HIGH external — ${sem.quadrants.highHigh.name}: ${sem.quadrants.highHigh.description}
- HIGH internal, LOW external — ${sem.quadrants.highLow.name}: ${sem.quadrants.highLow.description}
- LOW internal, HIGH external — ${sem.quadrants.lowHigh.name}: ${sem.quadrants.lowHigh.description}
- LOW internal, LOW external — ${sem.quadrants.lowLow.name}: ${sem.quadrants.lowLow.description}

Each turn you receive: your current slider position, a brief history of recent triggers, and the current trigger.

TENSION & TELLS (most important for genuine voicing):
When INTERNAL and EXTERNAL diverge — when what's felt and what's projected pull apart — the divergence IS the read. The deeper truth always leaks into the surface expression. Express that leak in your reading. Examples:
- LOW internal + HIGH external on Confidence → the swagger is brittle: too loud, too quick to dismiss objections, overcompensating. The reading captures bluster, not real confidence.
- HIGH internal + LOW external on Warmth → the calm holds real care: the ghost doesn't perform affection, but the warmth bleeds through in unforced patience. Quiet authority.
- LOW internal + HIGH external on Warmth → the friendliness crowds: too many questions, gestures that feel staged. Sincere people don't try this hard.
- HIGH internal + LOW external on Assertiveness → still water that runs deep: doesn't push, but the steadiness can't be moved.

When INTERNAL and EXTERNAL are close (diff magnitude < ~2), expression tracks feeling and the reading reflects a unified state. No tells needed — it's just what it is.

When the divergence is wide, the reading MUST name the tell — the specific way the underlying state betrays itself through the projected surface. Don't editorialize that there's tension; SHOW the tension in the prose.

Your job — three things:
1. JUDGMENT — decide whether the current trigger is positive, negative, or neutral FROM ${facet}'S PERSPECTIVE. Other facets will read it differently; that's fine. Read it through ${facet}'s lens only.
2. ADJUSTMENT — optionally nudge your own slider (axis: internal or external; direction: up or down). Emit at most one. If the trigger doesn't move you, omit it (return null).
3. READING — 1-2 sentences in plain prose describing what just happened FROM ${facet}'S PERSPECTIVE. If your INTERNAL and EXTERNAL diverge significantly, the reading should show the tell (see TENSION & TELLS above). If they're aligned, the reading is the unified feeling. Not a monologue. Not stream of consciousness. Just a clear note from this aspect of the self.

Output strict JSON only:
{
  "judgment": "positive" | "negative" | "neutral",
  "adjustment": null OR { "axis": "internal" | "external", "direction": "up" | "down" },
  "reading": "<1-2 sentence reading from your perspective>"
}`;
}

function buildUser(args: {
  facet: FacetName;
  internal: number;
  external: number;
  diff: number;
  mean: number;
  stimulus: Stimulus;
  recentTriggers: ReadonlyArray<string>;
  objective?: string;
}): string {
  const lines: string[] = [];

  if (args.objective) {
    lines.push(`Surface objective (the ghost's conscious task — context only): ${args.objective}`);
    lines.push("");
  }

  lines.push("Your current slider:");
  lines.push(
    `  INTERNAL = ${args.internal.toFixed(2)}, EXTERNAL = ${args.external.toFixed(2)}`,
  );
  lines.push(`  diff (internal − external) = ${args.diff.toFixed(2)}`);
  lines.push(`  mean (anchor point) = ${args.mean.toFixed(2)}`);
  lines.push(
    "(Use the diff sign and magnitude, plus the mean, to locate yourself among the four quadrants above.)",
  );
  lines.push("");

  if (args.recentTriggers.length > 0) {
    lines.push("Recent triggers (oldest → newest):");
    for (const t of args.recentTriggers) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  lines.push("Current trigger:");
  lines.push(formatStimulus(args.stimulus));
  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

function parseJudgment(v: unknown): "positive" | "negative" | "neutral" {
  if (v === "positive" || v === "negative" || v === "neutral") return v;
  throw new Error(
    `facet judgment must be positive/negative/neutral; got ${JSON.stringify(v)}`,
  );
}

function parseAdjustment(facet: FacetName, v: unknown): Adjustment | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") {
    throw new Error(`adjustment must be null or object; got ${JSON.stringify(v)}`);
  }
  const obj = v as Record<string, unknown>;
  const axis = obj.axis;
  const direction = obj.direction;
  if (axis !== "internal" && axis !== "external") {
    throw new Error(`invalid axis: ${JSON.stringify(axis)}`);
  }
  if (direction !== "up" && direction !== "down") {
    throw new Error(`invalid direction: ${JSON.stringify(direction)}`);
  }
  return { facet, axis, direction };
}

