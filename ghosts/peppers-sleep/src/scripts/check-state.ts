import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

const { session, close } = await openSessionFromEnv();
try {
  const q = await session.run(`
    OPTIONAL MATCH (cons:Consolidation)
    WITH count(cons) AS n_consolidations
    OPTIONAL MATCH ()-[r:CONTRADICTS]->()
    WITH n_consolidations, count(r) AS n_contradicts
    OPTIONAL MATCH (cm:ConsolidatedMessage)
    WITH n_consolidations, n_contradicts, count(cm) AS n_consolidated_messages
    OPTIONAL MATCH (s:Skill)
    WITH n_consolidations, n_contradicts, n_consolidated_messages, count(s) AS n_skills
    RETURN n_consolidations, n_contradicts, n_consolidated_messages, n_skills
  `);
  const r = q.records[0]!;
  console.log({
    consolidations: Number(r.get("n_consolidations")),
    contradicts_edges: Number(r.get("n_contradicts")),
    consolidated_messages: Number(r.get("n_consolidated_messages")),
    skills: Number(r.get("n_skills")),
  });

  const perSession = await session.run(`
    MATCH (c:Consolidation)
    RETURN c.session_id AS session_id, count(c) AS n
    ORDER BY n DESC
  `);
  console.log("\nConsolidations per ghost-session:");
  for (const row of perSession.records) {
    console.log(`  ${row.get("session_id")}: ${Number(row.get("n"))}`);
  }

  const aga = await session.run(`
    CALL gds.session.list() YIELD id, name, status RETURN id, name, status
  `);
  console.log("\nAGA sessions alive:");
  for (const row of aga.records) {
    console.log(`  id=${row.get("id")} name=${row.get("name")} status=${row.get("status")}`);
  }
} finally {
  await close();
}
