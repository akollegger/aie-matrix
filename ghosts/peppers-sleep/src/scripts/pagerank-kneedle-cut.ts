/**
 * Step B — resolve the contradiction graph: PageRank over the
 * session's :CONTRADICTS subgraph, Kneedle elbow on the sorted score
 * curve, soft-delete the noisy side via deleteConsolidations.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run cut:contradictions -- \
 *       --session=<sid> [--commit]
 *
 * Semantics (acceptance: "removes the noisier consolidations, keeps
 * the stable ones"):
 *   - Consolidations with ZERO contradictions are never touched.
 *   - High PageRank in the CONTRADICTS graph = contradiction hub =
 *     noisy. The Kneedle elbow splits hubs from the rest; hubs are cut.
 *   - Every [:CONTRADICTS] edge must end with at least one endpoint
 *     gone (otherwise Step C would distill contradictory Skills). Any
 *     edge the elbow cut leaves unresolved is resolved per-pair
 *     mechanically: lower source_count loses (less evidence); tie →
 *     older created_at loses (newer experience wins).
 *   - Pure pairwise graphs have flat PageRank (no elbow) — the
 *     per-pair rule then does all the work. This is the common case
 *     for a single ghost's sleep cycle.
 *
 * PageRank runs as local power iteration: per-ghost contradiction
 * graphs are tens of nodes at most; spinning a paid AGA session per
 * blackout would cost real money for an identical result.
 *
 * Soft delete = the Consolidation node and its edges go; the source
 * nodes keep their :Consolidated* relabels and [:CONSOLIDATED_TO]
 * edges (audit trail survives — they simply won't re-enter future
 * consolidation rounds, and no Skill is distilled from the deleted
 * Consolidation).
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { deleteConsolidations } from "../graph/consolidations.js";
import { elbowIndex, pageRankUndirected } from "../pipeline/kneedle.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

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

interface Node {
  readonly id: string;
  readonly sourceCount: number;
  readonly createdAt: string;
  readonly contentHead: string;
}

export async function runPagerankKneedleCut(
  opts: { sessionId: string; commit: boolean },
): Promise<void> {
  const args = { sessionId: opts.sessionId, commit: opts.commit };
  console.log(`# session_id: ${args.sessionId}`);
  console.log(`# mode:       ${args.commit ? "COMMIT" : "DRY RUN"}`);

  const { session, close } = await openSessionFromEnv();
  try {
    const nodesRes = await session.run(
      `MATCH (c:Consolidation { session_id: $sid })
       RETURN c.id AS id, c.source_count AS sc, toString(c.created_at) AS at,
              left(c.content, 90) AS head
       ORDER BY c.created_at`,
      { sid: args.sessionId },
    );
    const nodes: Node[] = nodesRes.records.map((r) => ({
      id: r.get("id") as string,
      sourceCount: Number(r.get("sc") ?? 0),
      createdAt: (r.get("at") as string) ?? "",
      contentHead: (r.get("head") as string) ?? "",
    }));
    const indexById = new Map(nodes.map((n, i) => [n.id, i]));

    const edgesRes = await session.run(
      `MATCH (a:Consolidation { session_id: $sid })-[r:CONTRADICTS]-(b:Consolidation { session_id: $sid })
       WHERE a.id < b.id
       RETURN DISTINCT a.id AS a, b.id AS b, r.reason AS reason`,
      { sid: args.sessionId },
    );
    const edges = edgesRes.records.map((r) => ({
      a: r.get("a") as string,
      b: r.get("b") as string,
      reason: (r.get("reason") as string) ?? "",
    }));
    console.log(`# nodes: ${nodes.length}, contradiction edges: ${edges.length}`);
    if (edges.length === 0) {
      console.log("# nothing to cut");
      return;
    }

    const adjacency: number[][] = nodes.map(() => []);
    for (const e of edges) {
      const ia = indexById.get(e.a);
      const ib = indexById.get(e.b);
      if (ia === undefined || ib === undefined) continue;
      adjacency[ia]!.push(ib);
      adjacency[ib]!.push(ia);
    }

    const rank = pageRankUndirected(adjacency);
    const candidates = nodes
      .map((n, i) => ({ node: n, index: i, score: rank[i]!, degree: adjacency[i]!.length }))
      .filter((c) => c.degree > 0)
      .sort((x, y) => y.score - x.score);

    console.log("\n# PageRank over contradiction subgraph (desc):");
    for (const c of candidates) {
      console.log(
        `  ${c.score.toFixed(5)}  deg=${c.degree}  src=${c.node.sourceCount}  ${c.node.id.slice(0, 8)}…  ${c.node.contentHead.replace(/\n/g, " ")}`,
      );
    }

    const cut = new Set<string>();
    const elbow = elbowIndex(candidates.map((c) => c.score));
    if (elbow !== null && elbow <= Math.floor(candidates.length / 2)) {
      for (let i = 0; i < elbow; i++) cut.add(candidates[i]!.node.id);
      console.log(`\n# elbow at index ${elbow} → ${cut.size} hub(s) cut by Kneedle`);
    } else {
      console.log(
        `\n# no usable elbow (${elbow === null ? "flat/degenerate series" : "would cut majority"}) — per-pair resolution only`,
      );
    }

    // Per-pair resolution for edges the elbow left unresolved.
    for (const e of edges) {
      if (cut.has(e.a) || cut.has(e.b)) continue;
      const na = nodes[indexById.get(e.a)!]!;
      const nb = nodes[indexById.get(e.b)!]!;
      let loser: Node;
      if (na.sourceCount !== nb.sourceCount) {
        loser = na.sourceCount < nb.sourceCount ? na : nb;
      } else {
        loser = na.createdAt <= nb.createdAt ? na : nb;
      }
      cut.add(loser.id);
      console.log(
        `# pair-resolved: cutting ${loser.id.slice(0, 8)}… (src=${loser.sourceCount}) — kept rival`,
      );
    }

    console.log(`\n# total to cut: ${cut.size} of ${nodes.length}`);
    for (const id of cut) {
      const n = nodes[indexById.get(id)!]!;
      console.log(`  CUT ${id.slice(0, 8)}…  ${n.contentHead.replace(/\n/g, " ")}`);
    }

    if (args.commit) {
      const removed = await deleteConsolidations(session, {
        consolidationIds: [...cut],
      });
      console.log(`\n# removed ${removed} Consolidations`);
    } else {
      console.log("\n# (dry run) pass --commit to delete");
    }
  } finally {
    await close();
  }
}

if (isCliEntry(import.meta.url)) {
  await runPagerankKneedleCut(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
