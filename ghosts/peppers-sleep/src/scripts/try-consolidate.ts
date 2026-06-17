/**
 * Per-session AGA pass + per-cluster consolidation (step 6).
 *
 * Pipeline:
 *   - AGA project/KNN/toUndirected/Leiden on `intent_embedding`
 *     (per-session, intent-driven clusters)
 *   - For each Leiden community: fetch full message rows, send to the
 *     nano sub-agent, get a bullet-list `Consolidation.content`.
 *   - Print every consolidation.
 *   - If `--commit`: create `:Consolidation` nodes, link sources via
 *     `[:CONSOLIDATED_TO]`, relabel `:Message → :ConsolidatedMessage`.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run try:consolidate -- <session_id> [--commit]
 *
 * Dry-run by default. The relabel step is irreversible without
 * running the inverse, so we don't commit unless asked.
 */

import neo4j from "neo4j-driver";

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import {
  createConsolidation,
  relabelManyAsConsolidated,
} from "../graph/consolidations.js";
import { deleteAgaSession } from "../graph/teardown.js";
import { NanoClient } from "../llm/nano.js";
import {
  consolidateCluster,
  type ClusterMessage,
} from "../pipeline/consolidate.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";
const KNN_REL = "KNN_SIM";
const KNN_UNDIR = "KNN_SIM_UNDIR";
const LEIDEN_SEED = 42;

const DEFAULT_SESSION = "61cd4de0-613a-4e95-896a-f2afa3aacaeb";

function pickTopK(n: number): number {
  if (n <= 6) return Math.max(1, n - 1);
  if (n <= 20) return 8;
  if (n <= 60) return 12;
  if (n <= 200) return 25;
  return 50;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const sessionId =
    args.find((a) => !a.startsWith("--")) ?? DEFAULT_SESSION;
  const graphName = `peppers-sleep-${sessionId.replace(/[^a-z0-9]/gi, "-")}`;

  console.log(`# session_id: ${sessionId}`);
  console.log(`# graph projection: ${graphName}`);
  console.log(`# mode: ${commit ? "COMMIT (writes :Consolidation + relabels sources)" : "DRY RUN"}`);

  const { session, close } = await openSessionFromEnv();
  const nano = new NanoClient();
  console.log(`# nano model: ${nano.model}`);

  try {
    // ---- Sanity ----
    const sanity = await session.run(
      `
        MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:Message)
        WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
          AND m.intent_embedding IS NOT NULL
        RETURN count(m) AS n
      `,
      { sid: sessionId },
    );
    const n = neoNum(sanity.records[0]?.get("n"));
    console.log(`\n# Sanity: ${n} un-consolidated messages with intent_embedding`);
    if (n === 0) {
      console.log("Nothing to consolidate.");
      return;
    }
    const topK = pickTopK(n);

    // ---- AGA session up ----
    console.log("\n# Ensuring AGA session is up");
    const sessRes = await session.run(
      `
        CALL gds.session.getOrCreate($name, '2GB', duration({minutes: 30}))
        YIELD id, status RETURN id AS id, status AS status
      `,
      { name: AGA_SESSION_NAME },
    );
    const agaSessionId = sessRes.records[0]!.get("id") as string;
    let status = sessRes.records[0]!.get("status") as string;
    const deadline = Date.now() + 120_000;
    while (status !== "Ready") {
      if (Date.now() > deadline) throw new Error("AGA session never Ready");
      await new Promise((r) => setTimeout(r, 2_000));
      const poll = await session.run(
        `CALL gds.session.list() YIELD id, status WHERE id = $id RETURN status`,
        { id: agaSessionId },
      );
      status = (poll.records[0]?.get("status") as string) ?? status;
    }
    console.log(`  ready (id=${agaSessionId})`);

    // ---- Drop stale projection ----
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: graphName,
      });
    } catch {
      /* not there yet */
    }

    // ---- Project ----
    console.log("\n# Projecting");
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
        RETURN g.graphName, g.nodeCount, g.relationshipCount
      `,
      { sid: sessionId, graph: graphName, agaId: agaSessionId },
    );

    // ---- KNN ----
    console.log(`# KNN topK=${topK}`);
    await session.run(
      `
        CALL gds.knn.mutate($graph, {
          nodeProperties: ['intent_embedding'],
          topK: $topK,
          mutateRelationshipType: $rel,
          mutateProperty: 'score'
        }) YIELD relationshipsWritten
        RETURN relationshipsWritten
      `,
      { graph: graphName, rel: KNN_REL, topK: neo4j.int(topK) },
    );

    // ---- toUndirected ----
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

    // ---- Leiden + collect community → [{id, role, content, timestamp}] ----
    console.log("# Leiden");
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
    console.log(
      `  ${byCommunity.size} communities from ${leiden.records.length} messages`,
    );

    // ---- Consolidate each community ----
    const sortedCommunities = [...byCommunity.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    let cascadeIndex = 0; // we're outside a cascade — pin to 0 for now

    for (const [cid, members] of sortedCommunities) {
      console.log(
        `\n# ─── Community ${cid} (${members.length} messages) ───`,
      );
      const content = await consolidateCluster(nano, members);
      console.log(content);

      if (commit) {
        const consolidationId = await createConsolidation(session, {
          ghostId: sessionId,
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
        console.log(
          `  committed: Consolidation ${consolidationId} (${members.length} sources relabelled)`,
        );
      }
    }

    if (!commit) {
      console.log(
        `\n# (dry run) — pass --commit to persist :Consolidation nodes + relabel sources`,
      );
    }
  } finally {
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: graphName,
      });
    } catch {
      /* projection may already be gone */
    }
    await deleteAgaSession(session, AGA_SESSION_NAME);
    await close();
  }
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

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
