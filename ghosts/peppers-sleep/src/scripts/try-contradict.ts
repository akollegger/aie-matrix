/**
 * Step 9 — second AGA pass on `:Consolidation` nodes + per-Leiden-
 * community LLM contradiction detection → `[:CONTRADICTS]` edges.
 *
 *   1. Sanity — how many Consolidations have `embedding`?
 *   2. Project all embeddable Consolidations.
 *   3. KNN + toUndirected + Leiden.
 *   4. Per community: ship the bullet bundles to nano, ask for
 *      contradiction pairs.
 *   5. (commit) write directional `[:CONTRADICTS]` edges.
 *
 * Dry-run by default. Pass `--commit` to materialise edges.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run try:contradict [-- --commit]
 */

import neo4j from "neo4j-driver";

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { addContradicts } from "../graph/consolidations.js";
import { deleteAgaSession } from "../graph/teardown.js";
import { NanoClient } from "../llm/nano.js";
import {
  judgeCommunity,
  type ConsolidationForJudge,
  type ContradictionEdge,
} from "../pipeline/contradict.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";
const GRAPH_NAME = "peppers-sleep-consolidations";
const KNN_REL = "CONS_KNN";
const KNN_UNDIR = "CONS_KNN_UNDIR";
const LEIDEN_SEED = 42;

function pickTopK(n: number): number {
  if (n <= 6) return Math.max(1, n - 1);
  if (n <= 20) return 8;
  if (n <= 60) return 12;
  if (n <= 200) return 25;
  return 50;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  console.log(`# mode: ${commit ? "COMMIT" : "DRY"}`);

  const { session, close } = await openSessionFromEnv();
  const nano = new NanoClient();
  console.log(`# nano model: ${nano.model}`);

  try {
    // ---- Sanity ----
    const sanity = await session.run(`
      MATCH (c:Consolidation)
      WHERE c.embedding IS NOT NULL
      RETURN count(c) AS n
    `);
    const n = neoNum(sanity.records[0]?.get("n"));
    console.log(`\n# Sanity: ${n} embeddable Consolidations`);
    if (n < 2) {
      console.log("Not enough to project. Run embed:consolidations first?");
      return;
    }
    const topK = pickTopK(n);

    // ---- AGA session up ----
    console.log("\n# Ensuring AGA session is up");
    const sessRes = await session.run(
      `CALL gds.session.getOrCreate($name, '2GB', duration({minutes: 30}))
       YIELD id, status RETURN id AS id, status AS status`,
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
        graph: GRAPH_NAME,
      });
    } catch {
      /* fine */
    }

    // ---- Project Consolidations ----
    console.log("\n# Projecting Consolidations");
    const proj = await session.run(
      `
        CYPHER runtime=parallel
        MATCH (c:Consolidation) WHERE c.embedding IS NOT NULL
        WITH c
        WITH gds.graph.project(
          $graph, c, NULL,
          { sourceNodeLabels: labels(c), sourceNodeProperties: c { .embedding } },
          { sessionId: $agaId }
        ) AS g
        RETURN g.nodeCount AS nodes
      `,
      { graph: GRAPH_NAME, agaId: agaSessionId },
    );
    console.log(`  nodes=${neoNum(proj.records[0]!.get("nodes"))}`);

    // ---- KNN + toUndirected ----
    console.log(`# KNN topK=${topK}`);
    const knn = await session.run(
      `
        CALL gds.knn.mutate($graph, {
          nodeProperties: ['embedding'],
          topK: $topK,
          mutateRelationshipType: $rel,
          mutateProperty: 'score'
        }) YIELD relationshipsWritten, similarityDistribution
        RETURN relationshipsWritten, similarityDistribution
      `,
      { graph: GRAPH_NAME, rel: KNN_REL, topK: neo4j.int(topK) },
    );
    console.log(
      `  KNN edges=${neoNum(knn.records[0]!.get("relationshipsWritten"))} similarity=${JSON.stringify(knn.records[0]!.get("similarityDistribution"))}`,
    );

    await session.run(
      `
        CALL gds.graph.relationships.toUndirected($graph, {
          relationshipType: $rel,
          mutateRelationshipType: $undir,
          aggregation: { score: 'SINGLE' }
        }) YIELD relationshipsWritten RETURN relationshipsWritten
      `,
      { graph: GRAPH_NAME, rel: KNN_REL, undir: KNN_UNDIR },
    );

    // ---- Leiden ----
    console.log("# Leiden");
    const leiden = await session.run(
      `
        CALL gds.leiden.stream($graph, {
          relationshipTypes: [$rel],
          relationshipWeightProperty: 'score',
          randomSeed: $seed
        }) YIELD nodeId, communityId
        WITH gds.util.asNode(nodeId) AS c, communityId
        RETURN
          communityId,
          c.id AS id,
          c.content AS content
      `,
      { graph: GRAPH_NAME, rel: KNN_UNDIR, seed: neo4j.int(LEIDEN_SEED) },
    );

    const byCommunity = new Map<number, ConsolidationForJudge[]>();
    for (const r of leiden.records) {
      const cid = neoNum(r.get("communityId"));
      const arr = byCommunity.get(cid) ?? [];
      arr.push({
        id: r.get("id") as string,
        content: (r.get("content") as string) ?? "",
        communityId: cid,
      });
      byCommunity.set(cid, arr);
    }
    console.log(
      `  ${byCommunity.size} communities from ${leiden.records.length} Consolidations`,
    );

    // ---- Judge each community ----
    let totalEdges = 0;
    const allEdges: ContradictionEdge[] = [];
    const sorted = [...byCommunity.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [cid, members] of sorted) {
      console.log(
        `\n# Community ${cid} (${members.length} Consolidations) — judging`,
      );
      if (members.length < 2) {
        console.log("  (skip: solo)");
        continue;
      }
      try {
        const edges = await judgeCommunity(nano, members);
        if (edges.length === 0) {
          console.log("  → no contradictions found");
        } else {
          for (const e of edges) {
            console.log(`  → ${e.fromId.slice(0, 8)}…  vs  ${e.toId.slice(0, 8)}…`);
            console.log(`    reason: ${e.reason}`);
          }
          allEdges.push(...edges);
          totalEdges += edges.length;
        }
      } catch (err) {
        console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`\n# Total contradictions found: ${totalEdges}`);

    // ---- Commit edges ----
    if (commit && allEdges.length > 0) {
      console.log(`\n# Committing ${allEdges.length} [:CONTRADICTS] edges`);
      for (const e of allEdges) {
        await addContradicts(session, {
          fromConsolidationId: e.fromId,
          toConsolidationId: e.toId,
          reason: e.reason,
        });
      }
      console.log("  done");
    } else if (!commit) {
      console.log(`\n# (dry run) pass --commit to materialise edges`);
    }

  } finally {
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: GRAPH_NAME,
      });
    } catch {
      /* fine */
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
