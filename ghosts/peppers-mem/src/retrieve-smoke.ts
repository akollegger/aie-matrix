/**
 * Smoke for `fetchRecentCascades`. Picks the most recent peppers-cascade
 * session in PeppersGhosts and pulls its last few cascades — full step
 * content inline, ready to be fed into an LLM prompt.
 *
 * Run with:
 *   pnpm --filter @aie-matrix/ghost-peppers-mem run smoke:retrieve
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { connectMemory } from "./client.js";
import { callOrThrow } from "./persist.js";
import { fetchRecentCascades, formatCascadeReplay } from "./retrieve.js";

loadRootEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function inspect(label: string, value: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const handle = await connectMemory({
    connection: {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    },
  });

  try {
    // Find a session with at least one ReasoningTrace.
    const seed = await callOrThrow(handle.client, "graph_query", {
      query: `
        MATCH (t:ReasoningTrace { success: true })
        WHERE t.session_id STARTS WITH "peppers-cascade-"
        RETURN t.session_id AS ghost_id
        ORDER BY t.completed_at DESC
        LIMIT 1
      `,
    });
    const ghostId = ((seed as { rows?: Array<Record<string, unknown>> })?.rows?.[0]
      ?.ghost_id ?? null) as string | null;
    if (ghostId === null) {
      inspect("FAIL", "no peppers-cascade- session found; run smoke:cascade first");
      process.exit(1);
    }
    inspect("Seed ghostId", ghostId);

    // Fetch recent cascades.
    const replays = await fetchRecentCascades(handle.client, ghostId, 3);
    inspect("Replay count", replays.length);

    if (replays.length === 0) {
      inspect("FAIL", "fetchRecentCascades returned no replays for that ghost");
      process.exit(1);
    }

    let withRichSteps = 0;
    for (const r of replays) {
      if (r.steps.some((s) => s.thought || s.action || s.observation)) withRichSteps++;
    }
    inspect("Replays with full step text", `${withRichSteps} / ${replays.length}`);
    if (withRichSteps === 0) {
      inspect("FAIL", "no replay carried any thought/action/observation text");
      process.exit(1);
    }

    inspect("Formatted (first replay)", formatCascadeReplay(replays[0]!));
    inspect("All replays (structured)", replays);
    inspect("OK", `${replays.length} replays retrieved with full step content`);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
