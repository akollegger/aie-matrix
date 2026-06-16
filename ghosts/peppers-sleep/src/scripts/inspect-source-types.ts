import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();
const gid = process.argv[2] ?? "de3124ab-e12a-4bc6-868d-74326646a5e9";
const { session, close } = await openSessionFromEnv();
try {
  // Per-label count for this ghost's experience nodes.
  const stats = await session.run(
    `MATCH (n) WHERE n.session_id = $gid
     WITH labels(n) AS labs, n
     UNWIND labs AS l
     WITH l, count(*) AS n
     RETURN l AS label, n ORDER BY n DESC`,
    { gid },
  );
  console.log("Label counts for session", gid, ":");
  for (const r of stats.records) console.log("  ", r.get("label"), Number(r.get("n")));

  // Sample one of each interesting node type for shape inspection.
  for (const label of ["Message", "ReasoningTrace", "Observation", "Entity", "Fact"]) {
    const s = await session.run(
      `MATCH (n:${label}) WHERE n.session_id = $gid
       RETURN n LIMIT 1`,
      { gid },
    );
    if (s.records.length === 0) { console.log(`\n[${label}] none`); continue; }
    const props = s.records[0]!.get("n").properties;
    console.log(`\n[${label}] keys: ${Object.keys(props).join(", ")}`);
    for (const [k, v] of Object.entries(props)) {
      const s = typeof v === "string" ? (v.length > 120 ? v.slice(0, 120) + "…" : v) : JSON.stringify(v);
      console.log(`    ${k} = ${s}`);
    }
  }
} finally { await close(); }
