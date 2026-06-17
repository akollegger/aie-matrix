import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(`
    MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
    WITH c.session_id AS sid, count(m) AS n
    RETURN sid, n ORDER BY n DESC LIMIT 15
  `);
  for (const rec of r.records) {
    console.log(`${rec.get("sid")} => ${Number(rec.get("n"))}`);
  }
} finally { await close(); }
