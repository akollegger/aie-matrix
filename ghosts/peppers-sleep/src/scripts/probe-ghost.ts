import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();
const gid = process.argv[2] ?? "de3124ab-e12a-4bc6-868d-74326646a5e9";
const { session, close } = await openSessionFromEnv();
try {
  const conv = await session.run(
    `MATCH (c:Conversation) WHERE c.session_id CONTAINS $gid OR c.session_id = $gid
     RETURN c.session_id AS sid, c.id AS id LIMIT 5`,
    { gid },
  );
  console.log("Conversation by session_id match:", conv.records.length);
  for (const r of conv.records) console.log("  ", r.get("sid"), r.get("id"));

  const recent = await session.run(
    `MATCH (m:Message)
     WHERE m.timestamp >= datetime("2026-06-06T00:00:00Z")
     WITH m ORDER BY m.timestamp DESC
     OPTIONAL MATCH (c:Conversation)-[:HAS_MESSAGE]->(m)
     RETURN c.session_id AS sid, count(m) AS n
     ORDER BY n DESC LIMIT 10`,
  );
  console.log("\nRecent messages by session (since today):");
  for (const r of recent.records) console.log("  ", r.get("sid"), Number(r.get("n")));
} finally { await close(); }
