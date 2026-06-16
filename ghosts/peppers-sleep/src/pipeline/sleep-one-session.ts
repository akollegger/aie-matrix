/**
 * One ghost-session's sleep consolidation cycle.
 *
 *   project (intent_embedding) → KNN → toUndirected → Leiden →
 *   per-community nano consolidation → persist :Consolidation +
 *   relabel sources.
 *
 * Returns the IDs of every :Consolidation node created. Throws on
 * any AGA / driver / LLM failure; caller decides whether to abort
 * the batch or carry on.
 */

import neo4j, { type Session } from "neo4j-driver";

import {
  createConsolidation,
  relabelManyAsConsolidated,
} from "../graph/consolidations.js";
import type { NanoClient } from "../llm/nano.js";
import { consolidateCluster, type ClusterMessage } from "./consolidate.js";

const KNN_REL = "KNN_SIM";
const KNN_UNDIR = "KNN_SIM_UNDIR";
const LEIDEN_SEED = 42;

export interface SleepCycleOptions {
  readonly ghostSessionId: string;
  readonly agaSessionId: string;
  readonly graphName: string;
  readonly commit?: boolean;
  /** Cascade index at which the sleep ran. Pinned to 0 for batch
   *  back-fill work; the live sleep loop will populate it. */
  readonly cascadeIndexAtSleep?: number;
  /** Override-able only for tests. */
  readonly topKOverride?: number;
}

export interface SleepCycleResult {
  readonly ghostSessionId: string;
  readonly nMessages: number;
  readonly nCommunities: number;
  readonly consolidationIds: ReadonlyArray<string>;
  readonly committed: boolean;
}

export async function sleepOneSession(
  session: Session,
  nano: NanoClient,
  opts: SleepCycleOptions,
): Promise<SleepCycleResult> {
  const { ghostSessionId, agaSessionId, graphName } = opts;
  const commit = opts.commit === true;
  const cascadeIndex = opts.cascadeIndexAtSleep ?? 0;

  // Sanity / corpus size.
  const sanity = await session.run(
    `
      MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:Message)
      WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
        AND m.intent_embedding IS NOT NULL
      RETURN count(m) AS n
    `,
    { sid: ghostSessionId },
  );
  const n = neoNum(sanity.records[0]?.get("n"));
  if (n === 0) {
    return {
      ghostSessionId,
      nMessages: 0,
      nCommunities: 0,
      consolidationIds: [],
      committed: false,
    };
  }
  const topK = opts.topKOverride ?? pickTopK(n);

  // Drop stale projection (idempotent).
  try {
    await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
      graph: graphName,
    });
  } catch {
    /* fine */
  }

  // Project.
  await session.run(
    `
      CYPHER runtime=parallel
      MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:Message)
      WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
        AND m.intent_embedding IS NOT NULL
      WITH m
      WITH gds.graph.project(
        $graph, m, NULL,
        { sourceNodeLabels: labels(m), sourceNodeProperties: m { .intent_embedding } },
        { sessionId: $agaId }
      ) AS g
      RETURN g.graphName
    `,
    { sid: ghostSessionId, graph: graphName, agaId: agaSessionId },
  );

  // KNN + toUndirected + Leiden.
  await session.run(
    `
      CALL gds.knn.mutate($graph, {
        nodeProperties: ['intent_embedding'],
        topK: $topK,
        mutateRelationshipType: $rel,
        mutateProperty: 'score'
      }) YIELD relationshipsWritten RETURN relationshipsWritten
    `,
    { graph: graphName, rel: KNN_REL, topK: neo4j.int(topK) },
  );
  await session.run(
    `
      CALL gds.graph.relationships.toUndirected($graph, {
        relationshipType: $rel,
        mutateRelationshipType: $undir,
        aggregation: { score: 'SINGLE' }
      }) YIELD relationshipsWritten RETURN relationshipsWritten
    `,
    { graph: graphName, rel: KNN_REL, undir: KNN_UNDIR },
  );
  const leiden = await session.run(
    `
      CALL gds.leiden.stream($graph, {
        relationshipTypes: [$rel],
        relationshipWeightProperty: 'score',
        randomSeed: $seed
      }) YIELD nodeId, communityId
      WITH gds.util.asNode(nodeId) AS m, communityId
      RETURN
        communityId,
        m.id AS id,
        m.role AS role,
        m.content AS content,
        toString(m.timestamp) AS timestamp
    `,
    { graph: graphName, rel: KNN_UNDIR, seed: neo4j.int(LEIDEN_SEED) },
  );

  const byCommunity = new Map<number, ClusterMessage[]>();
  for (const r of leiden.records) {
    const cid = neoNum(r.get("communityId"));
    const arr = byCommunity.get(cid) ?? [];
    arr.push({
      id: r.get("id") as string,
      role: r.get("role") as string,
      content: (r.get("content") as string) ?? "",
      timestamp: (r.get("timestamp") as string) ?? "",
    });
    byCommunity.set(cid, arr);
  }

  // Per-cluster: consolidate → optional persist + relabel.
  const consolidationIds: string[] = [];
  for (const [cid, members] of byCommunity) {
    const content = await consolidateCluster(nano, members);
    if (commit) {
      const consolidationId = await createConsolidation(session, {
        ghostId: ghostSessionId,
        content,
        communityId: cid,
        sourceCount: members.length,
        sourceLabel: "Message",
        cascadeIndexAtSleep: cascadeIndex,
      });
      await relabelManyAsConsolidated(session, {
        nodeIds: members.map((m) => m.id),
        baseLabel: "Message",
        consolidationId,
      });
      consolidationIds.push(consolidationId);
    }
  }

  // Drop projection.
  try {
    await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
      graph: graphName,
    });
  } catch {
    /* fine */
  }

  return {
    ghostSessionId,
    nMessages: n,
    nCommunities: byCommunity.size,
    consolidationIds,
    committed: commit,
  };
}

function pickTopK(n: number): number {
  if (n <= 6) return Math.max(1, n - 1);
  if (n <= 20) return 8;
  if (n <= 60) return 12;
  if (n <= 200) return 25;
  return 50;
}

function neoNum(v: unknown): number {
  if (
    v !== null &&
    typeof v === "object" &&
    "toNumber" in v &&
    typeof (v as { toNumber: unknown }).toNumber === "function"
  ) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}
