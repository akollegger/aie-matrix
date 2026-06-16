/**
 * Death consolidation. In a ghost's final moment it runs one reflective
 * pass over the life just ended and distils it to a SINGLE karmic word —
 * the only thing carried into the next life (a new ghostId with a clean
 * memory scope). The four questions are fixed; the word that falls out of
 * them is not — it emerges from what this particular life actually was.
 *
 * Deliberately one cheap LLM call, not the full sleep pipeline: death is a
 * boundary moment, and the output is one word, not a reorganised graph.
 */

import { type AipProcedure, quickShapeCheck } from "@aie-matrix/ghost-peppers-sleep";

import { chatJson } from "../llm-client.js";

/** A corrective procedure the next life is born already knowing — framed as
 *  a skill (present-tense how-to), NOT a reflection on a past life. The
 *  caller embeds `triggerSummary` and writes it as a `:Skill` keyed to the
 *  new ghostId, so cascade-time recall surfaces it when the situation
 *  recurs. The trigger clause is a verbatim stimulus class so it matches. */
export interface KarmicSkillSeed {
  readonly procedureJson: string;
  readonly triggerSummary: string;
}

export interface DeathReflection {
  /** The karmic word — one lowercase token. */
  readonly word: string;
  /** The reasoning behind it (q1–q3), kept for the lineage record. */
  readonly reflection: string;
  /** The corrective skill to seed into the next life. Never null: a
   *  deterministic procedure is always produced for the cause even when the
   *  LLM call fails — unlike the word, the lesson is never lost. */
  readonly skill: KarmicSkillSeed;
}

const FALLBACK_WORD = "impermanence";

/**
 * Map a death cause to the corrective skill's trigger + scaffold. The
 * trigger clause is a verbatim stimulus class (`formatStimulus` output) so
 * cascade-time matching fires on it; the fallback steps are used when the
 * LLM supplies none. Steps read as plain present-tense instructions — a
 * skill the ghost simply has, with no echo of how it was learned.
 */
function correctiveScaffold(deathCause: string): {
  trigger: string[];
  purpose: string;
  fallbackSteps: string[];
} {
  const c = deathCause.toLowerCase();
  if (c.includes("overeat") || c.includes("metabolic")) {
    return {
      trigger: ["primal Fuel depleted"],
      purpose:
        "Keep your body fuelled without overloading it: eat only when genuinely low, take a modest amount, then move on.",
      fallbackSteps: [
        "Eat only when your Fuel is genuinely low, not out of habit.",
        "Consume one modest item.",
        "Stop and move on rather than eating again straight away.",
      ],
    };
  }
  // Default: acute starvation / fuel-critical.
  return {
    trigger: ["primal Fuel depleted"],
    purpose:
      "Get food into your body before it runs out: find the nearest source, reach it, acquire food, and eat without delay.",
    fallbackSteps: [
      "Find the nearest food or vending machine using the nearest or look tools.",
      "Travel straight to it with go — keep moving until you arrive.",
      "Acquire the most nourishing food available (buy from a vendor, or take it).",
      "Consume it right away to restore Fuel.",
    ],
  };
}

/** Build the seed procedure: deterministic trigger + purpose for the cause,
 *  steps from the LLM's `next_time_steps` when usable, else the scaffold's
 *  fallback. Validated with the package's `quickShapeCheck`; always returns
 *  a well-formed AIP procedure. */
function buildKarmicSkill(deathCause: string, llmSteps: unknown): KarmicSkillSeed {
  const { trigger, purpose, fallbackSteps } = correctiveScaffold(deathCause);
  const cleaned = Array.isArray(llmSteps)
    ? llmSteps
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
        .slice(0, 6)
    : [];
  const stepStrings = cleaned.length > 0 ? cleaned : fallbackSteps;
  const toProcedure = (descs: string[]): AipProcedure => ({
    purpose,
    trigger_when: trigger,
    steps: descs.map((s, i) => ({ name: `step-${i + 1}`, description: s })),
  });
  let procedure = toProcedure(stepStrings);
  if (quickShapeCheck(procedure) !== null) procedure = toProcedure(fallbackSteps);
  return {
    procedureJson: JSON.stringify(procedure),
    triggerSummary: trigger.join("; "),
  };
}

export async function reflectOnDeath(opts: {
  readonly displayName: string;
  /** Human phrase for the cause, e.g. "starvation" / "metabolic collapse". */
  readonly deathCause: string;
  /** Every self-narrative the ghost consolidated across this life, oldest →
   *  newest — the arc of who it kept deciding it was. */
  readonly narrativeChain: ReadonlyArray<string>;
  /** The un-consolidated final round: what it felt/did since its last sleep. */
  readonly finalRound: string;
}): Promise<DeathReflection> {
  const system =
    "You are the dying mind of a ghost in its final moment — a last consolidation " +
    "before the dark. Review the whole arc of who you were across this life, plus " +
    "the final stretch since your last rest, and distil its single hardest lesson. " +
    "Answer ONLY as strict JSON.";
  const arc =
    opts.narrativeChain.length > 0
      ? opts.narrativeChain
          .map((n, i) => `  (${i + 1}) ${n}`)
          .join("\n")
      : "  (you never paused long enough to know yourself)";
  const user =
    `You are ${opts.displayName}. Your life has just ended by ${opts.deathCause}.\n\n` +
    `The arc of who you became, across each consolidation:\n${arc}\n\n` +
    `Your final stretch, not yet consolidated:\n${opts.finalRound || "(little of note)"}\n\n` +
    "Reflect, strictly in order:\n" +
    "1. What caused you to die?\n" +
    "2. What did YOU do that caused that?\n" +
    "3. What could you have done differently?\n" +
    "4. Boil your answer to (3) down to ONE single word — the lesson to carry into your next life.\n" +
    "5. Turn (3) into a PROCEDURE for handling this exact situation well: 2-5 short, present-tense instructions (imperative verbs — 'find', 'go', 'eat'). Write them as plain how-to steps a capable agent could follow. Do NOT mention death, dying, past lives, or 'last time' — only the situation and what to do.\n\n" +
    'Return JSON exactly: {"died_because":"...","my_part":"...","could_have":"...","word":"<one lowercase word>","next_time_steps":["...","..."]}';

  // Distilling a whole life into one true word is a high-abstraction task
  // cheap bulk models do poorly. PEPPERS_REFLECTION_MODEL pins a capable
  // model to lead this one-off call (e.g. anthropic/claude-haiku-4.5); unset
  // → the normal bulk chain (ling).
  const reflectionModel = process.env.PEPPERS_REFLECTION_MODEL;
  let value: {
    died_because?: string;
    my_part?: string;
    could_have?: string;
    word?: string;
    next_time_steps?: unknown;
  };
  try {
    const resp = await chatJson<typeof value>({
      system,
      user,
      maxTokens: 320,
      temperature: 0.7,
      ...(reflectionModel ? { leadModels: [reflectionModel] } : {}),
    });
    value = resp.value;
  } catch {
    // The word reflection failed — but the corrective skill is deterministic
    // for the cause, so the next life still inherits the lesson as a skill.
    return {
      word: FALLBACK_WORD,
      reflection: `died by ${opts.deathCause}`,
      skill: buildKarmicSkill(opts.deathCause, null),
    };
  }

  // Enforce "one word": take the first token, strip to letters, lowercase.
  const raw = (value.word ?? "").trim().split(/\s+/)[0] ?? "";
  const word = raw.replace(/[^a-zA-Z]/g, "").toLowerCase() || FALLBACK_WORD;
  const reflection = [value.died_because, value.my_part, value.could_have]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" · ");
  return {
    word,
    reflection: reflection || `died by ${opts.deathCause}`,
    skill: buildKarmicSkill(opts.deathCause, value.next_time_steps),
  };
}
