/**
 * Step 9 — within a Leiden community of similar Consolidations,
 * identify pairs of bullets that genuinely contradict each other.
 *
 * "Contradict" here is strict: one Consolidation contains a claim
 * X about a specific subject; another contains NOT-X about that
 * same subject. Differences-in-style, two ghosts choosing different
 * tactics in different situations, or near-duplicates are NOT
 * contradictions.
 *
 * Returns an array of pairwise edges to materialise as
 * `(:Consolidation)-[:CONTRADICTS]->(:Consolidation)`. Direction is
 * arbitrary in storage; the PageRank pass projects them as
 * undirected.
 */

import type { NanoClient } from "../llm/nano.js";

export interface ConsolidationForJudge {
  readonly id: string;
  readonly content: string;
  readonly communityId: number;
}

export interface ContradictionEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly reason: string;
}

const SYSTEM_PROMPT = `You are a strict logical-contradiction detector inside an agent-memory consolidation pipeline.

You receive a small batch of CONSOLIDATIONS (each a bullet list of distinct facts/decisions/events from one agent's past). Your job is to identify pairs that genuinely contradict each other.

A contradiction is:
- Two claims about the SAME subject that cannot both be true.
- Example: Consolidation A says "I agreed to meet Doc at Black Bart's at midnight"; Consolidation B says "I told Doc I refused to meet him at Black Bart's."

NOT a contradiction:
- Different ghosts choosing different tactics in different situations.
- Restatements of the same decision in different words.
- One Consolidation being more detailed than another about the same event.
- Differing personal preferences (those go to preferences, not contradictions).

Be conservative — false positives here corrupt the downstream graph. If you're uncertain, do NOT report a pair.

Output strict JSON only. Schema:
{
  "contradictions": [
    {
      "from_id": "<consolidation id>",
      "to_id": "<consolidation id>",
      "reason": "<one-sentence explanation of the specific conflict>"
    }
  ]
}

Empty list is a valid answer.`;

interface JudgeResponseShape {
  readonly contradictions: ReadonlyArray<{
    readonly from_id: string;
    readonly to_id: string;
    readonly reason: string;
  }>;
}

/**
 * Judge a community of Consolidations for pairwise contradictions.
 *
 * We use `openai.chat.completions.create` with `response_format:
 * {type: "json_object"}` for hard JSON conformance. The nano model
 * gets the schema in the system prompt and is forced to emit JSON;
 * we parse + validate shape on the way out.
 */
export async function judgeCommunity(
  nano: NanoClient,
  members: ReadonlyArray<ConsolidationForJudge>,
): Promise<ContradictionEdge[]> {
  if (members.length < 2) return [];

  const bundle = members
    .map(
      (m, i) =>
        `Consolidation ${i + 1} (id=${m.id}):\n${m.content}`,
    )
    .join("\n\n---\n\n");

  const text = await nano.completeJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Find every pair of consolidations below that genuinely contradict each other. Emit them in the JSON schema specified.\n\n${bundle}`,
    },
  ]);

  let parsed: JudgeResponseShape;
  try {
    parsed = JSON.parse(text) as JudgeResponseShape;
  } catch {
    return [];
  }
  const idSet = new Set(members.map((m) => m.id));
  const edges: ContradictionEdge[] = [];
  for (const c of parsed.contradictions ?? []) {
    if (typeof c.from_id !== "string" || typeof c.to_id !== "string") continue;
    if (!idSet.has(c.from_id) || !idSet.has(c.to_id)) continue;
    if (c.from_id === c.to_id) continue;
    edges.push({
      fromId: c.from_id,
      toId: c.to_id,
      reason: typeof c.reason === "string" ? c.reason : "",
    });
  }
  return edges;
}
