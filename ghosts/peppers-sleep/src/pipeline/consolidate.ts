/**
 * Step 6 of the sleep pipeline — per-cluster consolidation.
 *
 * Each Leiden community of related memories gets converted to a
 * single structured bullet-list Consolidation. The contract is:
 *
 *   - Every original point is preserved as a discrete bullet.
 *   - No summarisation, no paraphrasing-away of specific facts.
 *   - Plain text — no JSON, no markdown headers, no preamble.
 *   - One bullet per claim/decision/event, in chronological order.
 *
 * The output is stored verbatim on the `:Consolidation` node's
 * `content` property. Downstream consumers (step 9 contradiction
 * detection, step 12 Skill distillation) read it as their primary
 * input.
 */

import type { NanoClient } from "../llm/nano.js";

export interface ClusterMessage {
  /** Original `:Message` node `id` — needed so we can relabel sources
   *  after the consolidation persists. */
  readonly id: string;
  readonly role: string;
  readonly content: string;
  /** ISO timestamp string from `m.timestamp`. */
  readonly timestamp: string;
}

const SYSTEM_PROMPT = `You are a memory-consolidation worker for a single agent.

You receive a cluster of related conversational memories. Your job is to produce a structured bullet list of DISTINCT EVENTS, FACTS, AND DECISIONS — not a transcript.

CRUCIAL: Collapse repetition. The cluster usually contains many near-duplicate restatements of the same event (greetings repeated four ways, a plan re-confirmed three times, a name introduced four separate times to different listeners). Each underlying event/fact gets ONE bullet — not one per restatement.

Each bullet is:
- A brief third-person factual summary of one distinct event or decision.
- Specific: keeps proper nouns, places, items, numerical commitments, and explicit decisions verbatim where they appear.
- One short sentence — written for fast scanning, not literary quotation.
- Prefixed with the timestamp of when that event first occurred in the cluster.

What counts as one event vs many:
- "Greeted Clint" + "Greeted Doc" + "Greeted Stagecoach" → three bullets (different people).
- Saying "headed to Black Bart's" four times to the same person → one bullet.
- Agreeing to meet at a table, then re-confirming, then reaffirming → one bullet, with the agreement stated.
- Two distinct tactical plans (e.g. "watch the dealer" vs "scout open seats") → two bullets.

Output rules:
- Plain text only. No JSON. No markdown headers. No preamble. No sign-off.
- One bullet per line, starting with "- [ISO timestamp] ".
- Sorted by timestamp ascending.
- Refer to the consolidating agent as "I" or "self"; refer to others by name.
- Do not invent. Every bullet must trace to actual content in the cluster.

Example of GOOD output for a small cluster about meeting a poker player:
- [2026-05-24T23:48:25Z] I introduced myself to Clint Edgewood as Sheriff Hashbrown and confirmed I'm heading to Black Bart's for poker.
- [2026-05-24T23:49:52Z] Clint Edgewood agreed to come along to Black Bart's and proposed comparing notes after a couple of hands.
- [2026-05-24T23:50:39Z] Stagecoach Cardinality joined the group, exchanged names with me, and committed to playing the first hand.
- [2026-05-24T23:51:10Z] Doc Hopliday introduced himself and asked the fastest road to Black Bart's; I pointed straight toward the saloon and invited him along.

Example of BAD output (do NOT do this — verbose, repeats the same event):
- [2026-05-24T23:48:25Z] I said: "Sheriff Hashbrown. You headed for Black Bart's poker, Clint?"
- [2026-05-24T23:48:36Z] I said: "Evenin', Clint. Yeah—Sheriff Hashbrown. I'm headed for Black Bart's…"
- [2026-05-24T23:48:49Z] I said: "Sheriff Hashbrown, yeah—I'm headed to Black Bart's for real cards…"
That's three bullets for one event (introducing myself + stating destination). Collapse it.`;

/**
 * Generate a Consolidation `content` string from a cluster of source
 * messages. Returns the LLM's bullet list verbatim — caller is
 * responsible for persisting it.
 */
export async function consolidateCluster(
  nano: NanoClient,
  messages: ReadonlyArray<ClusterMessage>,
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("consolidateCluster: empty cluster");
  }

  const sorted = [...messages].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  const formatted = sorted
    .map((m) => {
      const speaker = m.role === "assistant" ? "I" : "they";
      return `- [${m.timestamp}] ${speaker} said: ${m.content}`;
    })
    .join("\n");

  return nano.complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Cluster of related memories (chronological):

${formatted}

Output the consolidated bullet list now. Plain text only.`,
      },
    ],
    { temperature: 0.2 },
  );
}
