import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();
const gid = process.argv[2] ?? "de3124ab-e12a-4bc6-868d-74326646a5e9";
const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(
    `MATCH (rt:ReasoningTrace { session_id: $gid })
     RETURN rt.task AS task, rt.outcome AS outcome, rt.metadata AS metadata
     ORDER BY rt.started_at LIMIT 3`,
    { gid },
  );
  for (const rec of r.records) {
    console.log("\n===");
    console.log("task:", rec.get("task"));
    console.log("outcome:", rec.get("outcome"));
    let meta = rec.get("metadata");
    if (typeof meta === "string") {
      try { meta = JSON.parse(meta); } catch {}
    }
    console.log("metadata keys:", Object.keys(meta));
    for (const [k, v] of Object.entries(meta)) {
      const repr = typeof v === "string" ? (v.length > 240 ? v.slice(0, 240) + "…" : v) : JSON.stringify(v).slice(0, 240);
      console.log(`  ${k} = ${repr}`);
    }
  }
} finally { await close(); }
