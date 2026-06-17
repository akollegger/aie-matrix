import { loadRootEnv } from "@aie-matrix/root-env";
import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

const sid = process.argv[2] ?? "61cd4de0-613a-4e95-896a-f2afa3aacaeb";
const { session, close } = await openSessionFromEnv();
try {
  const r = await session.run(
    `MATCH (c:Consolidation { session_id: $sid })
     RETURN c.id AS id, c.community_id AS cid, c.source_count AS n, c.content AS content
     ORDER BY c.source_count DESC`,
    { sid },
  );
  for (const rec of r.records) {
    console.log("\n===");
    console.log(`id=${rec.get("id")} community=${Number(rec.get("cid"))} sources=${Number(rec.get("n"))}`);
    console.log(rec.get("content"));
  }
  console.log(`\n# total: ${r.records.length}`);
} finally { await close(); }
