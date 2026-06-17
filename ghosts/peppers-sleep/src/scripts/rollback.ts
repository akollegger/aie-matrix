/**
 * Roll back consolidation writes from earlier test runs.
 *
 *   --keep=<session_id>   keep this ghost-session's Consolidations
 *                          (and the relabels they own)
 *   --all                  remove EVERY :Consolidation and revert
 *                          every :ConsolidatedMessage → :Message
 *   --dry                  print what would be done, don't write
 *   --delete-aga           also delete the AGA session
 *                          (`peppers-sleep-dev`)
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run rollback -- --keep=61cd4de0-613a-4e95-896a-f2afa3aacaeb --delete-aga
 *
 * The operation is graph-transactional only at the per-Consolidation
 * level: each Consolidation's relabel + delete runs in its own
 * `session.run`. A crash mid-rollback could leave a partial state;
 * re-running is idempotent because it always works against the
 * current state.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { deleteAgaSession } from "../graph/teardown.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";

interface Args {
  readonly keep: string | null;
  readonly all: boolean;
  readonly dry: boolean;
  readonly deleteAga: boolean;
}

function parseArgs(): Args {
  const cli = process.argv.slice(2);
  let keep: string | null = null;
  let all = false;
  let dry = false;
  let deleteAga = false;
  for (const arg of cli) {
    if (arg.startsWith("--keep=")) keep = arg.slice("--keep=".length);
    else if (arg === "--all") all = true;
    else if (arg === "--dry") dry = true;
    else if (arg === "--delete-aga") deleteAga = true;
  }
  if (!all && !keep) {
    throw new Error(
      "Specify either --all (wipe everything) or --keep=<session_id> (keep one).",
    );
  }
  if (all && keep) {
    throw new Error("Can't combine --all with --keep.");
  }
  return { keep, all, dry, deleteAga };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `# Rollback mode: ${args.all ? "WIPE ALL" : `KEEP session=${args.keep}`}, dry=${args.dry}, delete-aga=${args.deleteAga}`,
  );

  const { session, close } = await openSessionFromEnv();
  try {
    // 1. Decide which Consolidations are going.
    const targetQuery = args.all
      ? `MATCH (c:Consolidation) RETURN c.id AS id, c.session_id AS sid`
      : `MATCH (c:Consolidation)
         WHERE c.session_id <> $keep
         RETURN c.id AS id, c.session_id AS sid`;
    const targetRes = await session.run(
      targetQuery,
      args.all ? {} : { keep: args.keep },
    );
    const targets = targetRes.records.map((r) => ({
      id: r.get("id") as string,
      sid: r.get("sid") as string,
    }));
    console.log(`\n# Will remove ${targets.length} Consolidations`);

    if (targets.length === 0) {
      console.log("Nothing to do.");
    } else {
      const bySession = new Map<string, number>();
      for (const t of targets) bySession.set(t.sid, (bySession.get(t.sid) ?? 0) + 1);
      for (const [sid, n] of bySession) console.log(`  - ${sid}: ${n}`);
    }

    // 2. For each target Consolidation: relabel its sources back to
    //    :Message and detach-delete the Consolidation.
    let revertedRelabels = 0;
    let removedConsolidations = 0;
    for (const t of targets) {
      if (args.dry) continue;
      const relabelRes = await session.run(
        `
          MATCH (src)-[:CONSOLIDATED_TO]->(c:Consolidation { id: $cid })
          WHERE src:ConsolidatedMessage
          REMOVE src:ConsolidatedMessage
          SET src:Message
          RETURN count(src) AS n
        `,
        { cid: t.id },
      );
      revertedRelabels += Number(relabelRes.records[0]?.get("n") ?? 0);

      // Detach-delete the Consolidation (drops :CONSOLIDATED_TO,
      // :DISTILLED_TO, :CONTRADICTS edges in one go).
      const delRes = await session.run(
        `
          MATCH (c:Consolidation { id: $cid })
          DETACH DELETE c
          RETURN 1 AS n
        `,
        { cid: t.id },
      );
      removedConsolidations += delRes.records.length;
    }

    console.log(`\n# Reverted ${revertedRelabels} :ConsolidatedMessage → :Message`);
    console.log(`# Removed ${removedConsolidations} :Consolidation nodes`);

    // 3. Optionally tear down the AGA session.
    if (args.deleteAga && !args.dry) {
      const deleted = await deleteAgaSession(session, AGA_SESSION_NAME);
      console.log(
        `# AGA session '${AGA_SESSION_NAME}' deleted: ${deleted}`,
      );
    }

    // 4. Post-state.
    const stateRes = await session.run(`
      OPTIONAL MATCH (c:Consolidation) WITH count(c) AS cons
      OPTIONAL MATCH (m:ConsolidatedMessage) WITH cons, count(m) AS cm
      OPTIONAL MATCH ()-[r:CONTRADICTS]->() WITH cons, cm, count(r) AS contr
      RETURN cons, cm, contr
    `);
    const r = stateRes.records[0]!;
    console.log("\n# Post-state:");
    console.log(
      `  :Consolidation = ${Number(r.get("cons"))}, :ConsolidatedMessage = ${Number(r.get("cm"))}, :CONTRADICTS edges = ${Number(r.get("contr"))}`,
    );
  } finally {
    await close();
  }
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
