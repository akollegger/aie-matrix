/**
 * Per-ghost AGA pass against live data, read-only inspection.
 *
 * Iteration 3 — switched back to per-session scope (cultural memory
 * was a fun side-discovery but is a separate feature). Uses
 * `intent_embedding` which was backfilled with speaker-prefixes
 * stripped before OpenAI embedding, so the cosine similarity reflects
 * "what was said" rather than "who said it".
 *
 *   Pipeline:
 *     0. Read-only sanity — how many un-consolidated messages does
 *        this session have?
 *     1. Ensure explicit AGA session up (peppers-sleep-dev).
 *     2. Drop stale projection if any.
 *     3. Project session's messages with `intent_embedding`.
 *     4. KNN — topK adapts to corpus size (small sessions need
 *        smaller K).
 *     5. toUndirected with score aggregation.
 *     6. Leiden with explicit seed.
 *     7. Bucket and print communities.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run try:aga -- <session_id>
 */

import neo4j from "neo4j-driver";

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { deleteAgaSession } from "../graph/teardown.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";
const KNN_REL = "KNN_SIM";
const KNN_UNDIR = "KNN_SIM_UNDIR";
const LEIDEN_SEED = 42;

// One of the larger sessions from inspect-corpus. Pass any session_id
// on the CLI to override.
const DEFAULT_SESSION = "61cd4de0-613a-4e95-896a-f2afa3aacaeb";

function pickTopK(n: number): number {
  // KNN's topK is capped at N-1. For tiny corpora we want fewer
  // neighbours so communities can actually separate. Floor at 5.
  if (n <= 6) return Math.max(1, n - 1);
  if (n <= 20) return 8;
  if (n <= 60) return 12;
  if (n <= 200) return 25;
  return 50;
}

async function main(): Promise<void> {
  const sessionId = process.argv[2] ?? DEFAULT_SESSION;
  const graphName = `peppers-sleep-${sessionId.replace(/[^a-z0-9]/gi, "-")}`;

  console.log(`# session_id: ${sessionId}`);
  console.log(`# graph projection: ${graphName}`);

  const { session, close } = await openSessionFromEnv();
  try {
    // 0. Sanity — corpus size for this session.
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
    console.log(`\n# Sanity: ${n} embeddable un-consolidated messages`);
    if (n === 0) {
      console.log("Nothing to project.");
      return;
    }
    const topK = pickTopK(n);
    console.log(`# Using topK=${topK} for n=${n}`);

    // 1. Explicit AGA session — re-runs reuse it.
    console.log("\n# Ensuring AGA session is up");
    const sessRes = await session.run(
      `
        CALL gds.session.getOrCreate($name, '2GB', duration({minutes: 30}))
        YIELD id, name, status
        RETURN id AS id, status AS status
      `,
      { name: AGA_SESSION_NAME },
    );
    const agaSessionId = sessRes.records[0]!.get("id") as string;
    let status = sessRes.records[0]!.get("status") as string;
    console.log(`  AGA session id=${agaSessionId} status=${status}`);
    const deadline = Date.now() + 120_000;
    while (status !== "Ready") {
      if (Date.now() > deadline) {
        throw new Error(`AGA session never reached Ready (last=${status})`);
      }
      await new Promise((r) => setTimeout(r, 2_000));
      const poll = await session.run(
        `CALL gds.session.list() YIELD id, status WHERE id = $id RETURN status`,
        { id: agaSessionId },
      );
      status = (poll.records[0]?.get("status") as string) ?? status;
      console.log(`  polled: status=${status}`);
    }

    // 2. Drop existing projection if present.
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: graphName,
      });
      console.log(`  dropped stale graph ${graphName}`);
    } catch {
      /* ok */
    }

    // 3. Project this session's messages with intent_embedding.
    console.log("\n# Projecting graph");
    const proj = await session.run(
      `
        CYPHER runtime=parallel
        MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:Message)
        WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
          AND m.intent_embedding IS NOT NULL
        WITH m
        WITH gds.graph.project(
          $graph,
          m,
          NULL,
          {
            sourceNodeLabels: labels(m),
            sourceNodeProperties: m { .intent_embedding }
          },
          { sessionId: $agaId }
        ) AS g
        RETURN g.graphName AS name, g.nodeCount AS nodes, g.relationshipCount AS rels
      `,
      { sid: sessionId, graph: graphName, agaId: agaSessionId },
    );
    const projRow = proj.records[0]!;
    console.log(
      `  projected: nodes=${neoNum(projRow.get("nodes"))} rels=${neoNum(projRow.get("rels"))}`,
    );

    // 4. KNN over intent_embedding.
    console.log(`\n# Running KNN (topK=${topK})`);
    const knn = await session.run(
      `
        CALL gds.knn.mutate(
          $graph,
          {
            nodeProperties: ['intent_embedding'],
            topK: $topK,
            mutateRelationshipType: $rel,
            mutateProperty: 'score'
          }
        )
        YIELD nodesCompared, relationshipsWritten, similarityDistribution
        RETURN nodesCompared, relationshipsWritten, similarityDistribution
      `,
      { graph: graphName, rel: KNN_REL, topK: neo4j.int(topK) },
    );
    const knnRow = knn.records[0]!;
    console.log(
      `  KNN: compared ${neoNum(knnRow.get("nodesCompared"))} nodes, wrote ${neoNum(knnRow.get("relationshipsWritten"))} edges`,
    );
    console.log(
      `  similarity: ${JSON.stringify(knnRow.get("similarityDistribution"))}`,
    );

    // 5. Materialise undirected counterparts with score preserved.
    console.log("\n# toUndirected (aggregation: SINGLE for score)");
    const undir = await session.run(
      `
        CALL gds.graph.relationships.toUndirected(
          $graph,
          {
            relationshipType: $rel,
            mutateRelationshipType: $undir,
            aggregation: { score: 'SINGLE' }
          }
        )
        YIELD inputRelationships, relationshipsWritten
        RETURN inputRelationships, relationshipsWritten
      `,
      { graph: graphName, rel: KNN_REL, undir: KNN_UNDIR },
    );
    const undirRow = undir.records[0]!;
    console.log(
      `  inputRelationships=${neoNum(undirRow.get("inputRelationships"))} written=${neoNum(undirRow.get("relationshipsWritten"))}`,
    );

    // 6. Leiden.
    console.log(`\n# Running Leiden (seed=${LEIDEN_SEED})`);
    const leiden = await session.run(
      `
        CALL gds.leiden.stream(
          $graph,
          {
            relationshipTypes: [$rel],
            relationshipWeightProperty: 'score',
            randomSeed: $seed
          }
        )
        YIELD nodeId, communityId
        RETURN gds.util.asNode(nodeId) AS m, communityId
      `,
      { graph: graphName, rel: KNN_UNDIR, seed: neo4j.int(LEIDEN_SEED) },
    );

    // 7. Bucket + show.
    type Row = { content: string; role: string; communityId: number };
    const rows: Row[] = leiden.records.map((r) => {
      const m = r.get("m") as {
        properties?: { content?: unknown; role?: unknown };
      };
      const content =
        typeof m.properties?.content === "string" ? m.properties.content : "";
      const role =
        typeof m.properties?.role === "string" ? m.properties.role : "?";
      return { content, role, communityId: neoNum(r.get("communityId")) };
    });
    const byCommunity = new Map<number, Row[]>();
    for (const row of rows) {
      const arr = byCommunity.get(row.communityId) ?? [];
      arr.push(row);
      byCommunity.set(row.communityId, arr);
    }

    console.log(
      `\n# Leiden: ${byCommunity.size} communities from ${rows.length} messages`,
    );
    const sorted = [...byCommunity.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [cid, members] of sorted) {
      console.log(`\n  Community ${cid} (${members.length} messages):`);
      for (const s of members.slice(0, 4)) {
        const preview = s.content.replace(/\s+/g, " ").slice(0, 140);
        console.log(`    [${s.role}] ${preview}`);
      }
      if (members.length > 4) {
        console.log(`    … and ${members.length - 4} more`);
      }
    }
  } finally {
    // Tear down: drop the graph projection and delete the AGA
    // session so we don't pay for it past script exit.
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
