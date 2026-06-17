import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();
const gid = process.argv[2] ?? "de3124ab-e12a-4bc6-868d-74326646a5e9";
const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(
    `MATCH (c:Conversation { session_id: $gid })
     OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
     RETURN count(DISTINCT m) AS msgs`,
    { gid },
  );
  console.log("Messages:", Number(r.records[0]?.get("msgs") ?? 0));

  const all = await session.run(
    `MATCH (n)
     WHERE n.session_id = $gid
        OR EXISTS { MATCH (c:Conversation { session_id: $gid })-[*1..2]->(n) }
     WITH labels(n)[0] AS label, count(n) AS n
     RETURN label, n ORDER BY n DESC`,
    { gid },
  );
  console.log("\nAll node types touching this session:");
  for (const rec of all.records) console.log("  ", rec.get("label"), Number(rec.get("n")));

  const obs = await session.run(
    `MATCH (o:Observation) WHERE o.timestamp >= datetime("2026-06-06T00:00:00Z")
     RETURN count(o) AS n`,
  );
  console.log("\nObservations since today (any ghost):", Number(obs.records[0]?.get("n") ?? 0));
} finally { await close(); }
