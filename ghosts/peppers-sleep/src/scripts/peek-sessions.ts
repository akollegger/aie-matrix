import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(`
    MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
    WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->()) AND m.embedding IS NOT NULL
    RETURN
      count(DISTINCT c.session_id) AS distinct_sessions,
      count(m) AS total_messages
  `);
  for (const row of r.records) {
    console.log({
      distinct_sessions: Number(row.get("distinct_sessions")),
      total_messages: Number(row.get("total_messages")),
    });
  }
} finally {
  await close();
}
