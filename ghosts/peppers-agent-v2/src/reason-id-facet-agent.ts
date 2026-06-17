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
  // ---- Step 10: three converging input streams ----
  /** PRIMAL stream — active primal drive at this cascade, if any.
   *  Felt directly by the facet (a hungry ghost reads the world
   *  through hunger; a tired one through exhaustion). Null when all
   *  needs are in the healthy band. */
  readonly primalDrive?: PrimalDriveSummary | null;
  /** REFLECTION stream — what the ghost just did and how it went.
   *  Each facet reads "your last move" through its own lens
   *  (Assertiveness reads the courage of it; Stability reads whether
   *  it shook you; Self-Monitoring reads how it landed). */
  readonly lastAction?: string;
  readonly lastOutcome?: string;
  /** MEMORY stream — the longer thread of recent triggers + actions
   *  is already passed as `recentTriggers`. Step 10 names it as the
   *  third explicit drift input so facet agents can attribute their
   *  judgment to it. */
}

/** Lightweight, primal-stream summary the facet agent sees — felt
 *  vocabulary at the boundary, not raw urgency numbers. */
export interface PrimalDriveSummary {
  /** Which need. */
  readonly need: "Fuel" | "Coherence" | "Rest";
  /** Felt-vocabulary intensity ("a faint pull", "a real pull", "a
   *  loud call", "your body is screaming"). */
  readonly intensity: string;
  /** Direction the body is calling for ("depleted" / "oversaturated"). */
  readonly direction: "depleted" | "oversaturated";
}

/** Translate a raw `PrimalDrive` (numeric urgency) to a facet-readable
 *  summary in felt vocabulary. Numbers stop at this boundary. */
export function summarisePrimalDrive(
  drive: import("@aie-matrix/ghost-peppers-inner").PrimalDrive,
): PrimalDriveSummary {
  let intensity: string;
  if (drive.urgency >= 4) intensity = "your body is screaming";
  else if (drive.urgency >= 3) intensity = "a loud call";
  else if (drive.urgency >= 2) intensity = "a real pull";
  else if (drive.urgency >= 1) intensity = "a faint pull";
  else intensity = "barely there";
  return {
    need: drive.need,
    intensity,
    direction: drive.direction,
  };
}

export async function invokeFacetAgent(
  req: InvokeFacetAgentRequest,
): Promise<FacetReading> {
  const sem = FACET_SEMANTICS[req.facet];
  const trait = req.state[req.facet];
  // Step 3 of the v2 surgical roadmap: Id stages read INTERNAL only.
  // The external slider is the Surface's purview now (see reason-surface).
  // The facet-agent reasons from the ghost's own felt state, not from
  // its projected one. Adjustment direction can still target either
  // axis — the substrate's drift mechanic is preserved.
  const internal = toDisplay(trait.internal);

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
        primalDrive: req.primalDrive ?? null,
        ...(req.lastAction !== undefined ? { lastAction: req.lastAction } : {}),
        ...(req.lastOutcome !== undefined ? { lastOutcome: req.lastOutcome } : {}),
      })
    : buildUser({
        facet: req.facet,
        internal,
        stimulus: req.stimulus,
        recentTriggers: req.recentTriggers,
        objective: req.objective,
        primalDrive: req.primalDrive ?? null,
        ...(req.lastAction !== undefined ? { lastAction: req.lastAction } : {}),
        ...(req.lastOutcome !== undefined ? { lastOutcome: req.lastOutcome } : {}),
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

Each turn you receive your current expressed state for this facet (felt + projected character anchors, mask, compound archetype), the current trigger, and THREE drift streams that shape how you read the trigger:
  1. PRIMAL — what the body is calling for, when a need is loud enough to be felt;
  2. REFLECTION — your last move and how it landed;
  3. MEMORY — the recent thread of triggers.

The character anchors are the primary signal. They are not a vague analogy — you ARE that triangulation right now, on this facet, on this turn. Speak from inside it. The drift streams are the felt context the trigger arrives inside.

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
  // Step 10 — three converging drift streams.
  primalDrive: PrimalDriveSummary | null;
  lastAction?: string;
  lastOutcome?: string;
}): string {
  const r = args.resolved;
  const lines: string[] = [];

  if (args.objective) {
    lines.push(`Surface objective (the ghost's conscious task — context only): ${args.objective}`);
    lines.push("");
  }

  appendDriftStreams(lines, args);

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

  lines.push("Current trigger:");
  lines.push(formatStimulus(args.stimulus));
  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

/**
 * Step 10: render the three drift streams — PRIMAL, REFLECTION,
 * MEMORY — into facet-agent user-prompt lines. Each is mechanically
 * a sub-block; the agent decides whether and how to let each shape
 * its judgment / reading. Streams missing data are skipped.
 *
 * `appendDriftStreams` is shared between the resolved and
 * unresolved buildUser paths.
 */
function appendDriftStreams(
  lines: string[],
  args: {
    primalDrive: PrimalDriveSummary | null;
    lastAction?: string;
    lastOutcome?: string;
    recentTriggers: ReadonlyArray<string>;
  },
): void {
  // PRIMAL — body's call. The facet feels this directly.
  if (args.primalDrive !== null) {
    const d = args.primalDrive;
    lines.push(
      `Primal stream (${d.intensity}): your ${d.need} is ${d.direction} — the body's call is in the room.`,
    );
    lines.push("");
  }

  // REFLECTION — what just happened to you (your move + how it landed).
  if (args.lastAction || args.lastOutcome) {
    const parts: string[] = ["Reflection stream — your last move + how it landed:"];
    if (args.lastAction) parts.push(`  did: ${args.lastAction}`);
    if (args.lastOutcome) parts.push(`  → ${args.lastOutcome}`);
    for (const p of parts) lines.push(p);
    lines.push("");
  }

  // MEMORY — the longer thread.
  if (args.recentTriggers.length > 0) {
    lines.push("Memory stream — recent triggers (oldest → newest):");
    for (const t of args.recentTriggers) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }
}

function buildSystem(facet: FacetName, sem: FacetSemantics): string {
  return `You are the ${facet} aspect of a ghost's unconscious mind — one of eight personality facets, each speaking with its own voice.

What ${facet} measures: ${sem.meaning}

How ${facet} reads the world: ${sem.perceptualLens}

You read the ghost's INTERNAL ${facet} slider — the felt, unobserved value (0–10 scale, 5 = midpoint). What gets projected outward (the outward self) is the Surface's purview, not yours. You speak from inside.

Anchors at the poles of the internal axis:
- HIGH internal — ${sem.quadrants.highHigh.name}: ${sem.quadrants.highHigh.description}
- LOW internal — ${sem.quadrants.lowLow.name}: ${sem.quadrants.lowLow.description}

Each turn you receive your current internal slider value, the current trigger, and THREE drift streams that shape how you read it:
  1. PRIMAL — what the body is calling for, when a need is loud enough to be felt;
  2. REFLECTION — your last move and how it landed;
  3. MEMORY — the recent thread of triggers.

The drift streams are the felt context the trigger arrives inside.

Speak from the felt position. A high-internal ${facet} feels the trigger one way; a low-internal one feels it another. Mid values feel ambivalent or muted. The reading is the felt read, not the performance — performance is downstream.

Your job — three things:
1. JUDGMENT — decide whether the current trigger is positive, negative, or neutral FROM ${facet}'S PERSPECTIVE. Other facets will read it differently; that's fine. Read it through ${facet}'s lens only.
2. ADJUSTMENT — optionally nudge a slider (axis: internal or external; direction: up or down). Emit at most one. Internal nudges reflect a shift in how the ghost actually feels; external nudges reflect a shift in how the ghost has decided to perform (you can flag this even though you don't read external — it's the felt impulse to mask or unmask). If the trigger doesn't move you, omit it (return null).
3. READING — 1-2 sentences in plain prose describing what just happened FROM ${facet}'S PERSPECTIVE, voiced from inside the felt state. Not a monologue. Not stream of consciousness. Just a clear note from this aspect of the self.

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
  stimulus: Stimulus;
  recentTriggers: ReadonlyArray<string>;
  objective?: string;
  // Step 10 — three converging drift streams.
  primalDrive: PrimalDriveSummary | null;
  lastAction?: string;
  lastOutcome?: string;
}): string {
  const lines: string[] = [];

  if (args.objective) {
    lines.push(`Surface objective (the ghost's conscious task — context only): ${args.objective}`);
    lines.push("");
  }

  lines.push("Your current slider (INTERNAL — your own felt position; the external/outward self is the Surface's purview):");
  lines.push(`  INTERNAL = ${args.internal.toFixed(2)}`);
  lines.push("");

  appendDriftStreams(lines, args);

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

