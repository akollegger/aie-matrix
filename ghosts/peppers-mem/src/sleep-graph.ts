/**
 * Sleep-cycle graph helpers — label conventions and Cypher helpers
 * for the consolidation pipeline.
 *
 * The convention we adopt (decided in design): when a base memory
 * node gets consolidated, we **relabel** it. The upstream
 * agent-memory queries pattern-match on the base label (e.g.
 * `MATCH (m:Message)`), so relabelled nodes are naturally excluded
 * from live retrieval without any wrapper code on our side.
 *
 *   :Message            → :ConsolidatedMessage
 *   :Observation        → :ConsolidatedObservation
 *   :Fact               → :ConsolidatedFact            (when phase-2 traces land)
 *   :ReasoningStep      → :ConsolidatedReasoningStep   (phase 2)
 *   :ReasoningTrace     → :ConsolidatedReasoningTrace  (phase 2)
 *
 * Consolidation outputs themselves carry the `:Consolidation` label
 * and edges `(:OriginalNode)-[:CONSOLIDATED_TO]->(:Consolidation)`.
 * Contradictions between Consolidations carry
 * `(:Consolidation)-[:CONTRADICTS]->(:Consolidation)` (directional in
 * storage, undirected when projected for PageRank).
 *
 * AIP Skills distilled at step 12 carry the `:Skill` label and
 * `(:Consolidation)-[:DISTILLED_TO]->(:Skill)` edges.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { callOrThrow } from "./persist.js";

/** Base label → consolidated label. Anything not in this map is
 *  left alone — the relabel is opt-in per memory type. */
export const CONSOLIDATED_LABEL: Readonly<Record<string, string>> = {
  Message: "ConsolidatedMessage",
  Observation: "ConsolidatedObservation",
  Fact: "ConsolidatedFact",
  ReasoningStep: "ConsolidatedReasoningStep",
  ReasoningTrace: "ConsolidatedReasoningTrace",
};

/** Inverse map, for the rare case we'd need to "un-consolidate"
 *  (e.g. a sleep cycle aborts mid-write and we want to roll back). */
export const ORIGINAL_LABEL: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CONSOLIDATED_LABEL).map(([k, v]) => [v, k]),
  );

/** Cypher fragment that excludes already-consolidated nodes when
 *  selecting candidates for the next sleep cycle's input.
 *  Use in queries that walk a label that has a Consolidated- variant:
 *
 *    MATCH (m:Message) WHERE ${notConsolidated("m")} ...
 */
export function notConsolidated(varName: string): string {
  return `NOT EXISTS((${varName})-[:CONSOLIDATED_TO]->())`;
}

/**
 * Relabel a base node as its Consolidated- variant and link it to
 * the parent Consolidation node. Idempotent — re-running on an
 * already-consolidated node is a no-op (the source label was
 * already removed; the edge already exists).
 *
 * Runs one Cypher round trip per call; for bulk relabelling during
 * sleep, prefer `relabelManyAsConsolidated` below.
 */
export async function relabelAsConsolidated(
  client: Client,
  nodeId: string,
  baseLabel: keyof typeof CONSOLIDATED_LABEL,
  consolidationId: string,
): Promise<void> {
  const targetLabel = CONSOLIDATED_LABEL[baseLabel];
  if (targetLabel === undefined) {
    throw new Error(`relabelAsConsolidated: no consolidated label for ${baseLabel}`);
  }
  await callOrThrow(client, "graph_query", {
    query: `
      MATCH (n) WHERE n.id = $node_id
      MATCH (c:Consolidation) WHERE c.id = $consolidation_id
      MERGE (n)-[:CONSOLIDATED_TO]->(c)
      REMOVE n:${baseLabel}
      SET n:${targetLabel}
    `,
    parameters: { node_id: nodeId, consolidation_id: consolidationId },
  });
}

/**
 * Bulk relabel — one round trip for many nodes that all collapse
 * into the same Consolidation. Per-cluster batch during sleep step
 * 6 typically calls this once per cluster.
 */
export async function relabelManyAsConsolidated(
  client: Client,
  nodeIds: ReadonlyArray<string>,
  baseLabel: keyof typeof CONSOLIDATED_LABEL,
  consolidationId: string,
): Promise<void> {
  if (nodeIds.length === 0) return;
  const targetLabel = CONSOLIDATED_LABEL[baseLabel];
  if (targetLabel === undefined) {
    throw new Error(`relabelManyAsConsolidated: no consolidated label for ${baseLabel}`);
  }
  await callOrThrow(client, "graph_query", {
    query: `
      MATCH (c:Consolidation) WHERE c.id = $consolidation_id
      WITH c
      UNWIND $node_ids AS nid
      MATCH (n) WHERE n.id = nid
      MERGE (n)-[:CONSOLIDATED_TO]->(c)
      REMOVE n:${baseLabel}
      SET n:${targetLabel}
    `,
    parameters: {
      consolidation_id: consolidationId,
      node_ids: nodeIds,
    },
  });
}

/**
 * Create the Consolidation node itself. Called before
 * `relabelManyAsConsolidated` during the sleep pipeline; the
 * returned id is then passed to the relabel call to link the
 * sources.
 *
 * `content` is the structured-text bullet list produced by the
 * step-6 sub-agent (every original point preserved as a discrete
 * claim, no JSON). `community_id` is the Leiden community label
 * the cluster came from, kept for audit / future re-clustering.
 */
export async function createConsolidation(
  client: Client,
  ghostId: string,
  content: string,
  metadata: {
    readonly community_id: string | number;
    readonly source_count: number;
    readonly source_label: keyof typeof CONSOLIDATED_LABEL;
    readonly cascade_index_at_sleep: number;
  },
): Promise<string> {
  const result = await callOrThrow(client, "graph_query", {
    query: `
      CREATE (c:Consolidation {
        id: randomUUID(),
        session_id: $ghost_id,
        content: $content,
        community_id: $community_id,
        source_count: $source_count,
        source_label: $source_label,
        cascade_index_at_sleep: $cascade_index_at_sleep,
        created_at: datetime()
      })
      RETURN c.id AS id
    `,
    parameters: {
      ghost_id: ghostId,
      content,
      community_id: String(metadata.community_id),
      source_count: metadata.source_count,
      source_label: metadata.source_label,
      cascade_index_at_sleep: metadata.cascade_index_at_sleep,
    },
  });
  const rows = extractRows(result);
  const id = rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error(`createConsolidation: no id returned: ${JSON.stringify(result)}`);
  }
  return id;
}

/**
 * Create a Skill node from a validated AIP procedure. Called by the
 * step-12 large-model authoring stage; the procedure JSON is
 * stringified for storage (the model emits JSON; we keep it that
 * way at the graph layer — YAML rendering happens on read).
 *
 * Links the Skill to the Consolidation it was distilled from so
 * later cycles can trace where the Skill came from.
 */
export async function createSkill(
  client: Client,
  ghostId: string,
  procedureJson: string,
  consolidationId: string,
  triggerSummary: string,
): Promise<string> {
  const result = await callOrThrow(client, "graph_query", {
    query: `
      MATCH (c:Consolidation) WHERE c.id = $consolidation_id
      CREATE (s:Skill {
        id: randomUUID(),
        session_id: $ghost_id,
        procedure_json: $procedure_json,
        trigger_summary: $trigger_summary,
        created_at: datetime()
      })
      MERGE (c)-[:DISTILLED_TO]->(s)
      RETURN s.id AS id
    `,
    parameters: {
      ghost_id: ghostId,
      consolidation_id: consolidationId,
      procedure_json: procedureJson,
      trigger_summary: triggerSummary,
    },
  });
  const rows = extractRows(result);
  const id = rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error(`createSkill: no id returned: ${JSON.stringify(result)}`);
  }
  return id;
}

function extractRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const r = result as { rows?: unknown };
  if (!Array.isArray(r.rows)) return [];
  return r.rows.filter(
    (x): x is Record<string, unknown> => x !== null && typeof x === "object",
  );
}
