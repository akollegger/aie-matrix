import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";
loadRootEnv();
const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(
    `MATCH (c:Consolidation { session_id: $sid })
     RETURN c.id AS id, c.content AS content, c.source_count AS n
     ORDER BY c.source_count DESC`,
    { sid: "de3124ab-e12a-4bc6-868d-74326646a5e9" },
  );
  const out = r.records.map((r) => ({
    id: r.get("id"),
    n: Number(r.get("n")),
    content: r.get("content"),
  }));
  process.stdout.write(JSON.stringify(out));
} finally { await close(); }
