/**
 * Per-stimulus-class action distribution + Shannon entropy for one
 * ghost session, split into BEFORE/AFTER windows.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run measure:entropy -- \
 *       --session=<sid> [--split-cascade=N | --split-ms=<epochMillis>]
 *
 * With no split, prints the whole-session table.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import {
  distributionsByClass,
  formatDistribution,
  loadStimulusActionRows,
  type StimulusActionRow,
} from "../pipeline/entropy.js";

loadRootEnv();

interface Args {
  readonly sessionId: string;
  readonly splitCascade: number | null;
  readonly splitMs: number | null;
}

function parseArgs(): Args {
  let sessionId: string | null = null;
  let splitCascade: number | null = null;
  let splitMs: number | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session=")) sessionId = arg.slice("--session=".length);
    else if (arg.startsWith("--split-cascade="))
      splitCascade = Number(arg.slice("--split-cascade=".length));
    else if (arg.startsWith("--split-ms="))
      splitMs = Number(arg.slice("--split-ms=".length));
    else if (!arg.startsWith("--") && sessionId === null) sessionId = arg;
  }
  if (sessionId === null) throw new Error("--session=<sid> is required");
  return { sessionId, splitCascade, splitMs };
}

function printWindow(label: string, rows: ReadonlyArray<StimulusActionRow>): void {
  console.log(`\n## ${label} — ${rows.length} cascades`);
  for (const d of distributionsByClass(rows)) {
    console.log(`  ${formatDistribution(d)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`# session_id: ${args.sessionId}`);
  const { session, close } = await openSessionFromEnv();
  try {
    const rows = await loadStimulusActionRows(session, args.sessionId);
    console.log(`# stimulus-response traces: ${rows.length}`);
    if (args.splitCascade === null && args.splitMs === null) {
      printWindow("ALL", rows);
      return;
    }
    const isBefore = (r: StimulusActionRow): boolean =>
      args.splitCascade !== null
        ? r.cascadeIndex >= 0 && r.cascadeIndex < args.splitCascade
        : r.startedAtMs < (args.splitMs ?? 0);
    const before = rows.filter(isBefore);
    const after = rows.filter((r) => !isBefore(r));
    printWindow(
      `BEFORE (${args.splitCascade !== null ? `cascade < ${args.splitCascade}` : `ms < ${args.splitMs}`})`,
      before,
    );
    printWindow("AFTER", after);
  } finally {
    await close();
  }
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
