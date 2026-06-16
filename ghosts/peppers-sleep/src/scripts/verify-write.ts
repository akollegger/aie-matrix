import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

const SESSION = "61cd4de0-613a-4e95-896a-f2afa3aacaeb";

const { session, close } = await openSessionFromEnv();
try {
  const q = await session.run(
    `
      MATCH (cons:Consolidation { session_id: $sid })
      OPTIONAL MATCH (src)-[:CONSOLIDATED_TO]->(cons)
      WITH cons, count(src) AS source_count, collect(DISTINCT labels(src)) AS source_labels
      RETURN
        cons.id AS id,
        cons.community_id AS community_id,
        cons.source_count AS recorded_source_count,
        source_count AS edge_count,
        source_labels
      ORDER BY cons.community_id
    `,
    { sid: SESSION },
  );
  console.log(`Consolidations for session ${SESSION}:`);
  for (const r of q.records) {
    console.log(JSON.stringify({
      id: r.get("id"),
      community_id: r.get("community_id"),
      recorded_source_count: Number(r.get("recorded_source_count")),
      edge_count: Number(r.get("edge_count")),
      source_labels: r.get("source_labels"),
    }));
  }

  const remaining = await session.run(
    `
      MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:Message)
      RETURN count(m) AS remaining_messages
    `,
    { sid: SESSION },
  );
  console.log(`\nRemaining un-relabelled :Message in session: ${Number(remaining.records[0]!.get("remaining_messages"))}`);

  const consolidatedReachable = await session.run(
    `
      MATCH (c:Conversation { session_id: $sid })-[:HAS_MESSAGE]->(m:ConsolidatedMessage)
      RETURN count(m) AS consolidated
    `,
    { sid: SESSION },
  );
  console.log(`Reachable :ConsolidatedMessage in session: ${Number(consolidatedReachable.records[0]!.get("consolidated"))}`);
} finally {
  await close();
}
