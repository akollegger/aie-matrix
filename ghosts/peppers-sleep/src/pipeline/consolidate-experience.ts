/**
 * Multi-label cluster consolidation. The cluster's members can span
 * any of the agent-memory source labels (Message, ReasoningTrace,
 * Observation, Entity, Fact). The prompt renders mixed bullets with
 * type tags ([Said], [Thought], [Observed], [Knows], [Claim]) so the
 * sub-agent can produce one consolidated bullet list that respects
 * the mental + spoken + noted texture of the ghost's experience.
 */
import type { NanoClient } from "../llm/nano.js";
import {
  toClusterBullet,
  type CanonicalNode,
} from "../llm/canonical-text.js";

export interface ClusterMember {
  readonly node: CanonicalNode;
  /** ISO timestamp string — used for chronological ordering and bullet prefix. */
  readonly timestamp: string;
}

const SYSTEM_PROMPT = `You are a memory-consolidation worker for a single agent during sleep.

You receive a cluster of related memory traces from one agent's experience. The cluster may MIX:
- [Said]     — utterances the agent spoke (or peers spoke at it)
- [Thought]  — inner reasoning beats (one cascade's stimulus → action)
- [Observed] — world facts the agent noticed
- [Knows]    — named entities the agent has registered
- [Claim]    — assertions the agent has made about entities

Your job: produce a structured bullet list of DISTINCT EVENTS, FACTS, AND DECISIONS — not a transcript.

CRUCIAL: Collapse repetition. The cluster usually contains many near-duplicate restatements of the same underlying beat (a stimulus type encountered repeatedly, a plan re-confirmed, a name introduced multiple times). Each underlying event/fact/decision gets ONE bullet — not one per restatement.

Each bullet is:
- A brief third-person factual summary of one distinct event, observation, or decision.
- Specific: keeps proper nouns, places, items, numerical commitments, and explicit decisions verbatim where they appear.
- One short sentence — written for fast scanning, not literary quotation.
- Prefixed with the ISO timestamp of when that event first occurred in the cluster.
- Annotated with a kind tag in parentheses at the end so consumers can see what stratum it came from:
    (said)      for utterance-derived
    (thought)   for inner-reasoning-derived
    (observed)  for world-observation-derived
    (knows)     for entity-registration-derived
    (claim)     for fact-assertion-derived
    (mixed)     when a single distinct beat is supported by multiple strata

Output rules:
- Plain text only. No JSON. No markdown headers. No preamble. No sign-off.
- One bullet per line, starting with "- [ISO timestamp] " and ending with the kind tag in parentheses.
- Sorted by timestamp ascending.
- Refer to the consolidating agent as "I" or "self"; refer to others by name.
- Do not invent. Every bullet must trace to actual content in the cluster.

Example of GOOD output (a [Thought]-heavy cluster about a foraging pattern):
- [2026-06-06T00:01:12Z] I repeatedly responded to "Lantern in view" stimuli by closing the cascade with the look action, treating lanterns as inspection targets rather than acquisition targets. (thought)
- [2026-06-06T00:03:48Z] I encountered Food stimuli twice and closed each cascade with the take action, registering food as acquisition-worthy. (thought)
- [2026-06-06T00:05:15Z] I noted Crumbs and the Stone Fountain as cell-anchored features, distinct from carried inventory. (observed)`;

export async function consolidateExperienceCluster(
  nano: NanoClient,
  members: ReadonlyArray<ClusterMember>,
): Promise<string> {
  if (members.length === 0) {
    throw new Error("consolidateExperienceCluster: empty cluster");
  }
  const sorted = [...members].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const formatted = sorted
    .map((m) => toClusterBullet(m.node, m.timestamp))
    .join("\n");

  return nano.complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Cluster of related memory traces (chronological):

${formatted}

Output the consolidated bullet list now. Plain text only.`,
      },
    ],
    { temperature: 0.2 },
  );
}
