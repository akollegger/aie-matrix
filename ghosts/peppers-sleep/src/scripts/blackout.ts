/**
 * Step E pipeline body — one full BLACKOUT consolidation cycle for a
 * single ghost session, run as a sequential chain of the existing
 * per-step CLIs (each keeps its own dry-run/commit contract and AGA
 * teardown discipline):
 *
 *   1. embed-experience            --session=<sid>            (all labels)
 *   2. try-consolidate-experience  --session=<sid> --commit
 *   3. embed-consolidations                                    (global, idempotent)
 *   4. contradict-experience       --session=<sid> --commit
 *   5. pagerank-kneedle-cut        --session=<sid> --commit
 *   6. distill-skills              --session=<sid> --commit
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run blackout -- \
 *       --session=<sid> [--dry]
 *
 * `--dry` drops every --commit flag (steps still run their dry-run
 * analysis; embedding steps still write embeddings — they are cheap,
 * idempotent, additive properties).
 *
 * The ghost host (peppers-agent-v2) spawns this script when a ghost
 * enters BLACKOUT, awaits exit, then reloads :Skill nodes.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface Args {
  readonly sessionId: string;
  readonly commit: boolean;
}

function parseArgs(): Args {
  let sessionId: string | null = null;
  let commit = true;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session=")) sessionId = arg.slice("--session=".length);
    else if (arg === "--dry") commit = false;
    else if (!arg.startsWith("--") && sessionId === null) sessionId = arg;
  }
  if (sessionId === null) throw new Error("--session=<sid> is required");
  return { sessionId, commit };
}

const here = path.dirname(fileURLToPath(import.meta.url));

function runStepOnce(script: string, stepArgs: ReadonlyArray<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(here, script), ...stepArgs],
      { stdio: "inherit", env: process.env },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * One retry after a pause. Aura connections reset transiently (lab
 * run 3 lost an entire blackout to a single "connection reset by
 * peer"); every step is idempotent or commit-once (embedding skips
 * done rows, consolidation skips relabelled sources), so a second
 * attempt is safe.
 */
async function runStep(script: string, stepArgs: ReadonlyArray<string>): Promise<void> {
  try {
    await runStepOnce(script, stepArgs);
  } catch (err) {
    console.warn(`### step ${script} failed (${String(err)}) — retrying in 20s`);
    await new Promise((r) => setTimeout(r, 20_000));
    await runStepOnce(script, stepArgs);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const sid = `--session=${args.sessionId}`;
  const commit = args.commit ? ["--commit"] : [];
  const t0 = Date.now();
  console.log(`### BLACKOUT start session=${args.sessionId} commit=${args.commit}`);

  await runStep("embed-experience.ts", [sid]);
  await runStep("try-consolidate-experience.ts", [sid, ...commit]);
  await runStep("embed-consolidations.ts", []);
  await runStep("contradict-experience.ts", [sid, ...commit]);
  await runStep("pagerank-kneedle-cut.ts", [sid, ...commit]);
  await runStep("distill-skills.ts", [sid, ...commit]);
  // Identity decision: who am I now, after this experience? Runs LAST —
  // it narrates over the survivors of the cut, not the noise.
  await runStep("narrate-self.ts", [sid, ...commit]);

  console.log(
    `### BLACKOUT done session=${args.sessionId} in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
