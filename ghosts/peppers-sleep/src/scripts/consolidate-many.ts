/**
 * Batch sleep consolidation across the top N un-consolidated sessions.
 *
 * Each session gets its own AGA projection / KNN / Leiden cycle and
 * its own set of `:Consolidation` nodes. Writes via the same helpers
 * that `try-consolidate.ts --commit` exercises; that path has already
 * been validated against live data.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run consolidate:many [-- --n=10]
 *
 * Use `--dry` to skip writes and just print per-session cluster
 * counts.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { deleteAgaSession } from "../graph/teardown.js";
import { NanoClient } from "../llm/nano.js";
import { sleepOneSession } from "../pipeline/sleep-one-session.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";
const DEFAULT_BATCH = 10;

interface Args {
  readonly n: number;
  readonly commit: boolean;
}

function parseArgs(): Args {
  const cli = process.argv.slice(2);
  let n = DEFAULT_BATCH;
  let commit = true;
  for (const arg of cli) {
    if (arg.startsWith("--n=")) {
      const v = parseInt(arg.slice("--n=".length), 10);
      if (Number.isFinite(v) && v > 0) n = v;
    } else if (arg === "--dry") {
      commit = false;
    } else if (arg === "--commit") {
      commit = true;
    }
  }
  return { n, commit };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`# Batch: top ${args.n} sessions, mode=${args.commit ? "COMMIT" : "DRY"}`);

  const { session, close } = await openSessionFromEnv();
  const nano = new NanoClient();
  console.log(`# nano model: ${nano.model}`);

  try {
    // 1. AGA session ready (one explicit session re-used across all
    //    ghost sessions in this batch).
    console.log("\n# Ensuring AGA session is up");
    const sessRes = await session.run(
      `
        CALL gds.session.getOrCreate($name, '2GB', duration({minutes: 30}))
        YIELD id, status RETURN id AS id, status AS status
      `,
      { name: AGA_SESSION_NAME },
    );
    const agaSessionId = sessRes.records[0]!.get("id") as string;
    let status = sessRes.records[0]!.get("status") as string;
    const deadline = Date.now() + 120_000;
    while (status !== "Ready") {
      if (Date.now() > deadline) throw new Error("AGA session never Ready");
      await new Promise((r) => setTimeout(r, 2_000));
      const poll = await session.run(
        `CALL gds.session.list() YIELD id, status WHERE id = $id RETURN status`,
        { id: agaSessionId },
      );
      status = (poll.records[0]?.get("status") as string) ?? status;
    }
    console.log(`  ready (id=${agaSessionId})`);

    // 2. Pick the top N un-consolidated sessions by message count.
    const top = await session.run(
      `
        MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
        WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
          AND m.intent_embedding IS NOT NULL
        WITH c.session_id AS sid, count(m) AS n_messages
        WHERE n_messages >= 10
        RETURN sid, n_messages
        ORDER BY n_messages DESC
        LIMIT toInteger($n)
      `,
      { n: args.n },
    );

    const targets = top.records.map((r) => ({
      sid: r.get("sid") as string,
      n: Number(r.get("n_messages")),
    }));

    console.log(`\n# Top ${targets.length} sessions:`);
    for (const t of targets) {
      console.log(`  - ${t.sid}: ${t.n} messages`);
    }

    // 3. Loop.
    const summary: {
      sid: string;
      msgs: number;
      communities: number;
      consolidations: number;
    }[] = [];
    for (const [i, t] of targets.entries()) {
      const graphName = `peppers-sleep-batch-${t.sid.replace(/[^a-z0-9]/gi, "-")}`;
      console.log(`\n# (${i + 1}/${targets.length}) ${t.sid} — ${t.n} messages`);
      try {
        const result = await sleepOneSession(session, nano, {
          ghostSessionId: t.sid,
          agaSessionId,
          graphName,
          commit: args.commit,
        });
        summary.push({
          sid: t.sid,
          msgs: result.nMessages,
          communities: result.nCommunities,
          consolidations: result.consolidationIds.length,
        });
        console.log(
          `  result: ${result.nCommunities} communities, ${result.consolidationIds.length} ` +
            (args.commit ? "Consolidation nodes written" : "(dry — none written)"),
        );
      } catch (err) {
        console.error(
          `  ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
        summary.push({
          sid: t.sid,
          msgs: t.n,
          communities: -1,
          consolidations: -1,
        });
      }
    }

    // 4. Summary.
    console.log("\n# Summary");
    let totalCons = 0;
    for (const s of summary) {
      if (s.communities < 0) {
        console.log(`  ${s.sid}: FAILED`);
      } else {
        console.log(
          `  ${s.sid}: ${s.msgs} msgs → ${s.communities} communities → ${s.consolidations} Consolidations`,
        );
        totalCons += s.consolidations;
      }
    }
    console.log(`\n# Total Consolidations written this batch: ${totalCons}`);
  } finally {
    await deleteAgaSession(session, AGA_SESSION_NAME);
    await close();
  }
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
