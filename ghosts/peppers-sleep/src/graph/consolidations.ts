/**
 * Graph helpers for the sleep consolidation pipeline. Driver-based
 * (NOT MCP-routed) because the agent-memory MCP `graph_query` tool
 * is read-only.
 *
 * Label convention (decided in design):
 *
 *   :Message            → :ConsolidatedMessage         after consolidation
 *   :Observation        → :ConsolidatedObservation
 *   :Fact               → :ConsolidatedFact
 *   :ReasoningStep      → :ConsolidatedReasoningStep
 *   :ReasoningTrace     → :ConsolidatedReasoningTrace
 *
 * Agent-memory's upstream queries (`MATCH (m:Message) ...`) skip
 * relabelled nodes naturally — no filter clauses, no wrapper layer.
 *
 * Outputs:
 *
 *   :Consolidation                         — the per-cluster bullet-list node
 *   :Skill                                 — the AIP procedure (validated)
 *
 *   (:OriginalNode)-[:CONSOLIDATED_TO]->(:Consolidation)
 *   (:Consolidation)-[:DISTILLED_TO]->(:Skill)
 *   (:Consolidation)-[:CONTRADICTS]->(:Consolidation)
 */

import type { Session } from "neo4j-driver";
import { stringify as yamlStringify } from "yaml";

/**
 * AIP procedures are authored/consumed as YAML — that's the format the spec
 * defines. We generate the procedure as schema-conformant JSON (via the
 * Responses `json_schema` format), then serialise it to its native AIP YAML
 * with the standard `yaml` library for storage and agent consumption. No
 * bespoke converter — `yaml.stringify` is the tool for exactly this.
 */
export function procedureToYaml(procedureJson: string): string {
  return yamlStringify(JSON.parse(procedureJson) as unknown);
}

/** Base label → consolidated label. */
export const CONSOLIDATED_LABEL: Readonly<Record<string, string>> = {
  Message: "ConsolidatedMessage",
  Observation: "ConsolidatedObservation",
  Fact: "ConsolidatedFact",
  ReasoningStep: "ConsolidatedReasoningStep",
  ReasoningTrace: "ConsolidatedReasoningTrace",
};

export type BaseLabel = keyof typeof CONSOLIDATED_LABEL;

/**
 * Create a `:Consolidation` node. `content` is the structured-text
 * bullet list from the step-6 sub-agent — every original point
 * preserved as a discrete claim. No JSON.
 *
 * `sourceLabel` is the single-label legacy field (kept for the
 * existing Message-only path). `sourceLabels` is the multi-label
 * array used by the experience-wide pipeline. Callers pass whichever
 * matches their source set; if both are absent the Consolidation
 * still works but has no provenance.
 */
export async function createConsolidation(
  session: Session,
  args: {
    readonly ghostId: string;
    readonly content: string;
    readonly communityId: string | number;
    readonly sourceCount: number;
    readonly sourceLabel?: BaseLabel;
    readonly sourceLabels?: ReadonlyArray<BaseLabel>;
    readonly sourceLabelCounts?: Readonly<Record<string, number>>;
    readonly cascadeIndexAtSleep: number;
  },
): Promise<string> {
  const result = await session.run(
    `
      CREATE (c:Consolidation {
        id: randomUUID(),
        session_id: $ghost_id,
        content: $content,
        community_id: $community_id,
        source_count: $source_count,
        source_label: $source_label,
        source_labels: $source_labels,
        source_label_counts: $source_label_counts,
        cascade_index_at_sleep: $cascade_index_at_sleep,
        created_at: datetime()
      })
      RETURN c.id AS id
    `,
    {
      ghost_id: args.ghostId,
      content: args.content,
      community_id: String(args.communityId),
      source_count: args.sourceCount,
      source_label: args.sourceLabel ?? null,
      source_labels: args.sourceLabels ? [...args.sourceLabels] : null,
      source_label_counts: args.sourceLabelCounts
        ? JSON.stringify(args.sourceLabelCounts)
        : null,
      cascade_index_at_sleep: args.cascadeIndexAtSleep,
    },
  );
  const record = result.records[0];
  if (!record) {
    throw new Error("createConsolidation: no record returned");
  }
  const id = record.get("id");
  if (typeof id !== "string") {
    throw new Error(`createConsolidation: id is not a string: ${typeof id}`);
  }
  return id;
}

/**
 * Bulk relabel — one round trip for a cluster's worth of source
 * nodes that collapse into the same Consolidation. The labels API
 * is dynamic (REMOVE/SET don't take parameters), so we template
 * the labels at call-site after validating they're in the allowed
 * map. No injection risk.
 */
export async function relabelManyAsConsolidated(
  session: Session,
  args: {
    readonly nodeIds: ReadonlyArray<string>;
    readonly baseLabel: BaseLabel;
    readonly consolidationId: string;
  },
): Promise<void> {
  if (args.nodeIds.length === 0) return;
  const targetLabel = CONSOLIDATED_LABEL[args.baseLabel];
  if (targetLabel === undefined) {
    throw new Error(`No consolidated label for ${args.baseLabel}`);
  }
  await session.run(
    `
      MATCH (c:Consolidation) WHERE c.id = $consolidation_id
      WITH c
      UNWIND $node_ids AS nid
      MATCH (n) WHERE n.id = nid
      MERGE (n)-[:CONSOLIDATED_TO]->(c)
      REMOVE n:${args.baseLabel}
      SET n:${targetLabel}
    `,
    {
      consolidation_id: args.consolidationId,
      node_ids: args.nodeIds,
    },
  );
}

/**
 * Multi-label variant: takes a cluster whose members span multiple
 * source labels, groups them by original label, and applies the
 * matching `:ConsolidatedX` relabel per group. The source nodes keep
 * every original property — additive labelling preserves agent-memory's
 * schema and ensures upstream `MATCH (m:Message)` queries naturally
 * skip relabelled nodes.
 */
export async function relabelMixedAsConsolidated(
  session: Session,
  args: {
    readonly members: ReadonlyArray<{ readonly id: string; readonly baseLabel: BaseLabel }>;
    readonly consolidationId: string;
  },
): Promise<void> {
  const byLabel = new Map<BaseLabel, string[]>();
  for (const m of args.members) {
    const arr = byLabel.get(m.baseLabel) ?? [];
    arr.push(m.id);
    byLabel.set(m.baseLabel, arr);
  }
  for (const [label, ids] of byLabel) {
    await relabelManyAsConsolidated(session, {
      nodeIds: ids,
      baseLabel: label,
      consolidationId: args.consolidationId,
    });
  }
}

/**
 * Create a `:Skill` node from an AIP-validated procedure. The
 * procedure is stored as JSON (the schema's native shape); YAML
 * rendering happens on read.
 */
export async function createSkill(
  session: Session,
  args: {
    readonly ghostId: string;
    readonly procedureJson: string;
    readonly consolidationId: string;
    readonly triggerSummary: string;
  },
): Promise<string> {
  const result = await session.run(
    `
      MATCH (c:Consolidation) WHERE c.id = $consolidation_id
      CREATE (s:Skill {
        id: randomUUID(),
        session_id: $ghost_id,
        procedure_json: $procedure_json,
        procedure_yaml: $procedure_yaml,
        trigger_summary: $trigger_summary,
        created_at: datetime()
      })
      MERGE (c)-[:DISTILLED_TO]->(s)
      RETURN s.id AS id
    `,
    {
      ghost_id: args.ghostId,
      consolidation_id: args.consolidationId,
      procedure_json: args.procedureJson,
      procedure_yaml: procedureToYaml(args.procedureJson),
      trigger_summary: args.triggerSummary,
    },
  );
  const record = result.records[0];
  if (!record) {
    throw new Error("createSkill: no record returned");
  }
  const id = record.get("id");
  if (typeof id !== "string") {
    throw new Error(`createSkill: id is not a string: ${typeof id}`);
  }
  return id;
}

/**
 * Add a directional `[:CONTRADICTS]` edge between two Consolidation
 * nodes. Stored directional; the PageRank pass projects the graph
 * as undirected. Idempotent via MERGE.
 */
export async function addContradicts(
  session: Session,
  args: {
    readonly fromConsolidationId: string;
    readonly toConsolidationId: string;
    readonly reason?: string;
  },
): Promise<void> {
  await session.run(
    `
      MATCH (a:Consolidation), (b:Consolidation)
      WHERE a.id = $from_id AND b.id = $to_id
      MERGE (a)-[r:CONTRADICTS]->(b)
      ON CREATE SET r.created_at = datetime(), r.reason = $reason
    `,
    {
      from_id: args.fromConsolidationId,
      to_id: args.toConsolidationId,
      reason: args.reason ?? null,
    },
  );
}

/**
 * Soft delete a Consolidation (and its source links) after the
 * PageRank/Kneedle cut decides it's an outlier. Doesn't remove
 * source nodes — they keep their `:Consolidated*` label and their
 * `[:CONSOLIDATED_TO]` edge so the audit trail survives. We DO
 * remove the Consolidation node and its outgoing relationships.
 *
 * This is destructive; callers should pass a dry-run flag if
 * needed. Returns the count of removed Consolidations.
 */
export async function deleteConsolidations(
  session: Session,
  args: {
    readonly consolidationIds: ReadonlyArray<string>;
  },
): Promise<number> {
  if (args.consolidationIds.length === 0) return 0;
  const result = await session.run(
    `
      UNWIND $ids AS cid
      MATCH (c:Consolidation) WHERE c.id = cid
      DETACH DELETE c
      RETURN count(*) AS removed
    `,
    { ids: args.consolidationIds },
  );
  const record = result.records[0];
  if (!record) return 0;
  const removed = record.get("removed");
  return typeof removed === "object" && removed !== null && "toNumber" in removed
    ? (removed as { toNumber: () => number }).toNumber()
    : Number(removed);
}
