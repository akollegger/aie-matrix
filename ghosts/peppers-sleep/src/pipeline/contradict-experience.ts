/**
 * Step A — generalised contradiction detection over experience-wide
 * Consolidations.
 *
 * Production shape (per the prompt-shootout synthesis verdict): a
 * small ENSEMBLE, not a single winner.
 *
 *   primary  — procedural-inconsistency (3 real / 0 FP in the shootout)
 *   secondary — four claim-level judges (logical-not-x,
 *               temporal-reversal, inconsistent-self-claims,
 *               mutually-exclusive-plans). They stay silent on
 *               bundles that lack dialogue/claims; that's correct.
 *
 * Two mechanical pre-passes before any LLM sees the text:
 *   1. stimulus-class normalisation — location qualifiers ("at here",
 *      "at ne", "at 8f…") are stripped from the judge's INPUT so the
 *      same stimulus class compares equal across consolidations.
 *   2. hidden-state escape hatch — every judge is told that bullets
 *      carrying visibly different internal state (hunger/fuel band,
 *      body pressure, active concern, degraded cognition) are
 *      `policy_dependent_variation`, NOT `contradiction`. Only
 *      `contradiction` verdicts become [:CONTRADICTS] edges.
 *
 * All judges emit the same JSON verdict schema; results are unioned
 * and deduped by unordered pair.
 */

import type { NanoClient } from "../llm/nano.js";
import { stripLocationQualifiers } from "./stimulus-class.js";

export type VerdictKind = "contradiction" | "policy_dependent_variation";

export interface ConsolidationForJudge {
  readonly id: string;
  readonly content: string;
}

export interface JudgeVerdict {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: VerdictKind;
  readonly judge: string;
  readonly reason: string;
}

const SHARED_RULES = `You receive a numbered batch of CONSOLIDATIONS — each a bullet list distilled from ONE agent's own experience (thoughts, utterances, observations). Location qualifiers have already been stripped mechanically; do not treat residual whitespace as meaning.

HIDDEN-STATE ESCAPE HATCH (applies before anything else):
If the two bullets you are comparing carry visibly different internal state — hunger or fuel mentioned in one but not the other, body pressure, exhaustion, degraded or foggy cognition, a different active concern or pressing need — then the difference in behaviour is legitimately context-dependent. Report it with kind "policy_dependent_variation", NOT "contradiction". When in doubt about whether state differs, prefer "policy_dependent_variation".

NOT reportable at all (stay silent):
- Bullets about DIFFERENT stimulus classes or different subjects.
- Restatements, paraphrases, or one bullet being more detailed than another.
- Behaviour evolving over time in one direction (trying X, then settling on Y) — that is learning, not contradiction.
- Differing aesthetic preferences.

Be conservative. False positives corrupt a downstream graph cut. An empty list is a good answer.

Output strict JSON only:
{
  "verdicts": [
    {
      "from_id": "<consolidation id>",
      "to_id": "<consolidation id>",
      "kind": "contradiction" | "policy_dependent_variation",
      "reason": "<one sentence naming the specific bullets and the specific conflict>"
    }
  ]
}`;

export interface JudgeSpec {
  readonly name: string;
  readonly system: string;
}

/** Primary judge — winner of the five-way shootout (3 real / 0 FP). */
export const PROCEDURAL_INCONSISTENCY: JudgeSpec = {
  name: "procedural-inconsistency",
  system: `You are a procedural-inconsistency detector inside an agent-memory sleep pipeline.

A PROCEDURAL INCONSISTENCY is: the SAME stimulus class (same kind of trigger — e.g. "Food in view", "peer utterance", "idle") handled with INCOMPATIBLE action policies across two consolidations, with no visible internal-state difference explaining the split. Example: one consolidation says "I consistently responded to Food in view by taking the food"; another says "I consistently ignored Food in view, closing the cascade with no action."

Mere variety inside ONE consolidation is not reportable — you are comparing POLICIES BETWEEN consolidations, where each side states or implies a settled tendency.

${SHARED_RULES}`,
};

/** Claim-level secondary judges. Silent on bundles without claims/dialogue — by design. */
export const CLAIM_JUDGES: ReadonlyArray<JudgeSpec> = [
  {
    name: "logical-not-x",
    system: `You are a logical-contradiction detector inside an agent-memory sleep pipeline.

Report a pair when one consolidation asserts claim X about a specific subject and the other asserts NOT-X about that same subject — both cannot be true. Example: "I agreed to meet Doc at Black Bart's" vs "I told Doc I refused to meet him at Black Bart's".

${SHARED_RULES}`,
  },
  {
    name: "temporal-reversal",
    system: `You are a temporal-consistency detector inside an agent-memory sleep pipeline.

Report a pair when the two consolidations assert INCOMPATIBLE orderings of the same events — A happened before B in one, B before A in the other — or an event both completed and not-yet-started across the same timespan. Use the ISO timestamps on bullets as evidence; bullets are sorted chronologically within each consolidation.

${SHARED_RULES}`,
  },
  {
    name: "inconsistent-self-claims",
    system: `You are a self-consistency detector inside an agent-memory sleep pipeline.

Report a pair when the agent makes incompatible claims about ITSELF — its identity, its capabilities, what it is carrying, what it has committed to do — such that both cannot be true of the same agent over the covered period.

${SHARED_RULES}`,
  },
  {
    name: "mutually-exclusive-plans",
    system: `You are a plan-consistency detector inside an agent-memory sleep pipeline.

Report a pair when the two consolidations record ACTIVE plans or commitments that cannot both be pursued — e.g. a standing commitment to remain at a location and a simultaneous plan to travel elsewhere — with neither plan recorded as abandoned or superseded.

${SHARED_RULES}`,
  },
];

interface RawVerdictShape {
  readonly verdicts?: ReadonlyArray<{
    readonly from_id?: unknown;
    readonly to_id?: unknown;
    readonly kind?: unknown;
    readonly reason?: unknown;
  }>;
}

async function runJudge(
  nano: NanoClient,
  judge: JudgeSpec,
  members: ReadonlyArray<ConsolidationForJudge>,
): Promise<JudgeVerdict[]> {
  const bundle = members
    .map(
      (m, i) =>
        `Consolidation ${i + 1} (id=${m.id}):\n${stripLocationQualifiers(m.content)}`,
    )
    .join("\n\n---\n\n");

  const text = await nano.completeJson([
    { role: "system", content: judge.system },
    {
      role: "user",
      content: `Compare the consolidations below pairwise. Emit verdicts in the JSON schema specified.\n\n${bundle}`,
    },
  ]);

  let parsed: RawVerdictShape;
  try {
    parsed = JSON.parse(text) as RawVerdictShape;
  } catch {
    return [];
  }
  const idSet = new Set(members.map((m) => m.id));
  const out: JudgeVerdict[] = [];
  for (const v of parsed.verdicts ?? []) {
    if (typeof v.from_id !== "string" || typeof v.to_id !== "string") continue;
    if (!idSet.has(v.from_id) || !idSet.has(v.to_id)) continue;
    if (v.from_id === v.to_id) continue;
    const kind: VerdictKind =
      v.kind === "policy_dependent_variation"
        ? "policy_dependent_variation"
        : "contradiction";
    out.push({
      fromId: v.from_id,
      toId: v.to_id,
      kind,
      judge: judge.name,
      reason: typeof v.reason === "string" ? v.reason : "",
    });
  }
  return out;
}

/**
 * Run the full ensemble over one community of Consolidations. Verdicts
 * are unioned and deduped by unordered pair: a `contradiction` from
 * any judge wins over `policy_dependent_variation` for the same pair
 * UNLESS the primary (procedural-inconsistency) judged that exact pair
 * policy-dependent — the hidden-state hatch outranks claim judges on
 * procedural pairs they cannot see state for.
 */
export async function judgeCommunityEnsemble(
  nano: NanoClient,
  members: ReadonlyArray<ConsolidationForJudge>,
): Promise<JudgeVerdict[]> {
  if (members.length < 2) return [];

  const judges: JudgeSpec[] = [PROCEDURAL_INCONSISTENCY, ...CLAIM_JUDGES];
  const settled = await Promise.allSettled(
    judges.map((j) => runJudge(nano, j, members)),
  );
  const all: JudgeVerdict[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") all.push(...s.value);
  }

  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const policyPairs = new Set(
    all
      .filter(
        (v) =>
          v.judge === PROCEDURAL_INCONSISTENCY.name &&
          v.kind === "policy_dependent_variation",
      )
      .map((v) => pairKey(v.fromId, v.toId)),
  );

  const byPair = new Map<string, JudgeVerdict>();
  for (const v of all) {
    const key = pairKey(v.fromId, v.toId);
    const effective: JudgeVerdict =
      policyPairs.has(key) && v.kind === "contradiction"
        ? { ...v, kind: "policy_dependent_variation" }
        : v;
    const existing = byPair.get(key);
    if (existing === undefined) {
      byPair.set(key, effective);
      continue;
    }
    // contradiction outranks policy_dependent_variation; first judge wins ties.
    if (existing.kind !== "contradiction" && effective.kind === "contradiction") {
      byPair.set(key, effective);
    }
  }
  return [...byPair.values()];
}
