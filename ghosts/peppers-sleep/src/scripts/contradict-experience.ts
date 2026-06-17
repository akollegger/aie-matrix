/**
 * Step A runner — session-scoped contradiction detection over
 * :Consolidation nodes, using the judge ensemble
 * (procedural-inconsistency primary + four claim-level secondaries).
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run contradict:experience -- \
 *       --session=<sid> [--commit]
 *
 * Dry-run by default; `--commit` materialises [:CONTRADICTS] edges
 * (reason = "<judge>: <one-sentence reason>").
 *
 * Grouping: per-ghost Consolidation counts are small (one sleep cycle
 * produces ~5-15). For N <= 15 we judge the whole session as one
 * bundle — no AGA session, no embeddings needed, no cost. For larger
 * N we group by local cosine connected-components over the existing
 * `embedding` property (run embed:consolidations first).
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { addContradicts } from "../graph/consolidations.js";
import { NanoClient } from "../llm/nano.js";
import {
  judgeCommunityEnsemble,
  type ConsolidationForJudge,
  type JudgeVerdict,
} from "../pipeline/contradict-experience.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const SINGLE_BUNDLE_MAX = 15;
const COMPONENT_COSINE = 0.75;

interface Args {
  readonly sessionId: string;
  readonly commit: boolean;
}

function parseArgs(): Args {
  let sessionId: string | null = null;
  let commit = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session=")) sessionId = arg.slice("--session=".length);
    else if (arg === "--commit") commit = true;
    else if (!arg.startsWith("--") && sessionId === null) sessionId = arg;
  }
  if (sessionId === null) throw new Error("--session=<sid> is required");
  return { sessionId, commit };
}

interface LoadedConsolidation extends ConsolidationForJudge {
  readonly embedding: ReadonlyArray<number> | null;
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Union-find connected components over pairwise cosine >= threshold. */
function groupByCosineComponents(
  members: ReadonlyArray<LoadedConsolidation>,
): LoadedConsolidation[][] {
  const parent = members.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ea = members[i]!.embedding;
      const eb = members[j]!.embedding;
      if (ea === null || eb === null) continue;
      if (cosine(ea, eb) >= COMPONENT_COSINE) union(i, j);
    }
  }
  const groups = new Map<number, LoadedConsolidation[]>();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(members[i]!);
    groups.set(root, arr);
  }
  return [...groups.values()];
}

export async function runContradictExperience(
  opts: { sessionId: string; commit: boolean },
): Promise<void> {
  const args = { sessionId: opts.sessionId, commit: opts.commit };
  console.log(`# session_id: ${args.sessionId}`);
  console.log(`# mode:       ${args.commit ? "COMMIT" : "DRY RUN"}`);

  const { session, close } = await openSessionFromEnv();
  const nano = new NanoClient();
  console.log(`# judge model: ${nano.model}`);

  try {
    const res = await session.run(
      `MATCH (c:Consolidation { session_id: $sid })
       RETURN c.id AS id, c.content AS content, c.embedding AS embedding
       ORDER BY c.created_at`,
      { sid: args.sessionId },
    );
    const members: LoadedConsolidation[] = res.records.map((r) => ({
      id: r.get("id") as string,
      content: (r.get("content") as string) ?? "",
      embedding: (r.get("embedding") as number[] | null) ?? null,
    }));
    console.log(`# consolidations: ${members.length}`);
    if (members.length < 2) {
      console.log("# nothing to judge (need >= 2)");
      return;
    }

    let groups: LoadedConsolidation[][];
    if (members.length <= SINGLE_BUNDLE_MAX) {
      groups = [members];
    } else {
      const missing = members.filter((m) => m.embedding === null).length;
      if (missing > 0) {
        throw new Error(
          `${missing} consolidations lack 'embedding' — run embed:consolidations first`,
        );
      }
      groups = groupByCosineComponents(members);
    }
    console.log(`# groups: ${groups.map((g) => g.length).join(", ")}`);

    const contradictions: JudgeVerdict[] = [];
    const policyVariations: JudgeVerdict[] = [];
    for (const group of groups) {
      if (group.length < 2) continue;
      const verdicts = await judgeCommunityEnsemble(nano, group);
      for (const v of verdicts) {
        if (v.kind === "contradiction") contradictions.push(v);
        else policyVariations.push(v);
      }
    }

    console.log(`\n# contradictions: ${contradictions.length}`);
    for (const v of contradictions) {
      console.log(`  ${v.fromId.slice(0, 8)}… vs ${v.toId.slice(0, 8)}…  [${v.judge}]`);
      console.log(`    ${v.reason}`);
    }
    console.log(`\n# policy-dependent variations (no edge): ${policyVariations.length}`);
    for (const v of policyVariations) {
      console.log(`  ${v.fromId.slice(0, 8)}… vs ${v.toId.slice(0, 8)}…  [${v.judge}]`);
      console.log(`    ${v.reason}`);
    }

    if (args.commit && contradictions.length > 0) {
      console.log(`\n# committing ${contradictions.length} [:CONTRADICTS] edges`);
      for (const v of contradictions) {
        await addContradicts(session, {
          fromConsolidationId: v.fromId,
          toConsolidationId: v.toId,
          reason: `${v.judge}: ${v.reason}`,
        });
      }
      console.log("  done");
    } else if (!args.commit) {
      console.log("\n# (dry run) pass --commit to materialise edges");
    }
  } finally {
    await close();
  }
}

if (isCliEntry(import.meta.url)) {
  await runContradictExperience(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
