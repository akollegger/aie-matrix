/**
 * Per-session, multi-label sleep consolidation. Projects any subset of
 * {Message, ReasoningTrace, Observation, Entity, Fact} into one AGA
 * graph, KNN + Leiden over `intent_embedding`, then consolidates each
 * Leiden community with the experience-aware prompt.
 *
 * The source data model is preserved:
 *   - each clustered node keeps every property,
 *   - additive label only (Message → :ConsolidatedMessage, etc.),
 *   - upstream `MATCH (m:Message)` queries naturally skip them.
 *
 * Dry-run by default. Pass `--commit` to persist Consolidation nodes
 * and apply the relabel.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run try:consolidate:experience -- \
 *       --session=<sid> [--labels=ReasoningTrace,Message] [--commit]
 */
import neo4j from "neo4j-driver";
import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import {
  createConsolidation,
  relabelMixedAsConsolidated,
  type BaseLabel,
} from "../graph/consolidations.js";
import { deleteAgaSession } from "../graph/teardown.js";
import { gdsMode } from "../graph/gds-mode.js";
import { NanoClient } from "../llm/nano.js";
import {
  type CanonicalNode,
  type SourceLabel,
} from "../llm/canonical-text.js";
import {
  consolidateExperienceCluster,
  type ClusterMember,
} from "../pipeline/consolidate-experience.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const AGA_SESSION_NAME = "peppers-sleep-dev";
const KNN_REL = "EXP_KNN";
const KNN_UNDIR = "EXP_KNN_UNDIR";
const LEIDEN_SEED = 42;
const ALL_LABELS: SourceLabel[] = [
  "Message",
  "ReasoningTrace",
  "Observation",
  "Entity",
  "Fact",
];

interface Args {
  readonly sessionId: string;
  readonly labels: SourceLabel[];
  readonly commit: boolean;
}

function parseArgs(): Args {
  let sessionId: string | null = null;
  let labels: SourceLabel[] = ALL_LABELS;
  let commit = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session=")) sessionId = arg.slice("--session=".length);
    else if (arg.startsWith("--labels=")) {
      labels = arg
        .slice("--labels=".length)
        .split(",")
        .map((s) => s.trim())
        .filter((l): l is SourceLabel => (ALL_LABELS as string[]).includes(l));
    } else if (arg === "--commit") commit = true;
    else if (!arg.startsWith("--") && sessionId === null) sessionId = arg;
  }
  if (sessionId === null) throw new Error("--session=<sid> is required");
  return { sessionId, labels, commit };
}

function pickTopK(n: number): number {
  if (n <= 6) return Math.max(1, n - 1);
  if (n <= 20) return 8;
  if (n <= 60) return 12;
  if (n <= 200) return 25;
  return 50;
}

export async function runTryConsolidateExperience(
  opts: { sessionId: string; commit: boolean; labels?: SourceLabel[] },
): Promise<void> {
  const args = {
    sessionId: opts.sessionId,
    labels: opts.labels ?? ALL_LABELS,
    commit: opts.commit,
  };
  const graphName = `peppers-sleep-exp-${args.sessionId.replace(/[^a-z0-9]/gi, "-")}`;

  console.log(`# session_id:   ${args.sessionId}`);
  console.log(`# labels:       ${args.labels.join(", ")}`);
  console.log(`# mode:         ${args.commit ? "COMMIT" : "DRY RUN"}`);
  console.log(`# graph:        ${graphName}`);

  const { session, close } = await openSessionFromEnv();
  const nano = new NanoClient();
  console.log(`# nano model:   ${nano.model}`);

  try {
    // 0. Sanity — how many embeddable, un-consolidated nodes per label?
    let total = 0;
    for (const label of args.labels) {
      const r = await session.run(
        `MATCH (n:${label} { session_id: $sid })
         WHERE n.intent_embedding IS NOT NULL
           AND NOT EXISTS((n)-[:CONSOLIDATED_TO]->())
         RETURN count(n) AS n`,
        { sid: args.sessionId },
      );
      const n = neoNum(r.records[0]?.get("n"));
      console.log(`  ${label}: ${n}`);
      total += n;
    }
    if (total === 0) {
      console.log("\n# nothing to consolidate (check embedding first)");
      return;
    }
    const topK = pickTopK(total);

    // 1. AGA session up — only in Aura GDS-Sessions mode. In in-db mode the
    //    GDS plugin runs inside Neo4j, so there is no session to spin up.
    const mode = gdsMode();
    console.log(`# GDS mode: ${mode}`);
    let agaSessionId: string | null = null;
    if (mode === "sessions") {
      console.log("\n# Ensuring AGA session is up");
      const sessRes = await session.run(
        `CALL gds.session.getOrCreate($name, '2GB', duration({minutes: 30}))
         YIELD id, status RETURN id, status`,
        { name: AGA_SESSION_NAME },
      );
      agaSessionId = sessRes.records[0]!.get("id") as string;
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
    }

    // 2. Drop stale projection
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: graphName,
      });
    } catch { /* fine */ }

    // 3. Project all selected labels into ONE graph. Each node carries
    //    its source label (via labels(n)) so we can split later for relabel.
    console.log("\n# Projecting");
    const labelMatch = args.labels.map((l) => `'${l}' IN labels(n)`).join(" OR ");
    // The 5th arg ({ sessionId }) routes the projection to the Aura GDS
    // Session. In-db GDS has no session — use the 4-arg form.
    // In-db GDS additionally requires targetNodeLabels (NULL here — node-only
    // projection, no relationships) whenever sourceNodeLabels is provided.
    const projectConfig =
      mode === "sessions"
        ? `{ sourceNodeLabels: labels(n), sourceNodeProperties: n { .intent_embedding } },
           { sessionId: $agaId }`
        : `{ sourceNodeLabels: labels(n), targetNodeLabels: NULL, sourceNodeProperties: n { .intent_embedding }, targetNodeProperties: NULL }`;
    const projParams =
      mode === "sessions"
        ? { sid: args.sessionId, graph: graphName, agaId: agaSessionId }
        : { sid: args.sessionId, graph: graphName };
    const proj = await session.run(
      `
        CYPHER runtime=parallel
        MATCH (n)
        WHERE n.session_id = $sid
          AND n.intent_embedding IS NOT NULL
          AND NOT EXISTS((n)-[:CONSOLIDATED_TO]->())
          AND (${labelMatch})
        WITH n
        WITH gds.graph.project(
          $graph, n, NULL,
          ${projectConfig}
        ) AS g
        RETURN g.nodeCount AS nodes
      `,
      projParams,
    );
    console.log(`  nodes=${neoNum(proj.records[0]!.get("nodes"))}`);

    // 4. KNN
    console.log(`# KNN topK=${topK}`);
    await session.run(
      `CALL gds.knn.mutate($graph, {
         nodeProperties: ['intent_embedding'],
         topK: $topK,
         mutateRelationshipType: $rel,
         mutateProperty: 'score'
       }) YIELD relationshipsWritten RETURN relationshipsWritten`,
      { graph: graphName, rel: KNN_REL, topK: neo4j.int(topK) },
    );

    await session.run(
      `CALL gds.graph.relationships.toUndirected($graph, {
         relationshipType: $rel,
         mutateRelationshipType: $undir,
         aggregation: { score: 'SINGLE' }
       }) YIELD relationshipsWritten RETURN relationshipsWritten`,
      { graph: graphName, rel: KNN_REL, undir: KNN_UNDIR },
    );

    // 5. Leiden + collect into communities.
    console.log("# Leiden");
    const leiden = await session.run(
      `
        CALL gds.leiden.stream($graph, {
          relationshipTypes: [$rel],
          relationshipWeightProperty: 'score',
          randomSeed: $seed
        }) YIELD nodeId, communityId
        WITH gds.util.asNode(nodeId) AS n, communityId
        OPTIONAL MATCH (n)-[:HAS_STEP]->(s:ReasoningStep)
        WITH n, communityId, s ORDER BY coalesce(s.created_at, s.id) ASC
        WITH n, communityId, collect(properties(s)) AS steps
        RETURN
          communityId AS cid,
          n.id        AS id,
          labels(n)   AS labs,
          properties(n) AS props,
          steps       AS steps,
          toString(n.timestamp) AS ts_msg,
          toString(n.started_at) AS ts_trace
      `,
      { graph: graphName, rel: KNN_UNDIR, seed: neo4j.int(LEIDEN_SEED) },
    );

    const byCommunity = new Map<number, ClusterMember[]>();
    for (const r of leiden.records) {
      const cid = neoNum(r.get("cid"));
      const id = r.get("id") as string;
      const labs = r.get("labs") as string[];
      const baseLabel = pickBaseLabel(labs, args.labels);
      if (baseLabel === null) continue;
      const props = r.get("props") as Record<string, unknown>;
      const steps = r.get("steps") as Record<string, unknown>[];
      const tsMsg = (r.get("ts_msg") as string | null) ?? null;
      const tsTrace = (r.get("ts_trace") as string | null) ?? null;
      const timestamp = tsMsg ?? tsTrace ?? "";
      const node: CanonicalNode = { id, label: baseLabel, props, steps };
      const arr = byCommunity.get(cid) ?? [];
      arr.push({ node, timestamp });
      byCommunity.set(cid, arr);
    }
    console.log(
      `  ${byCommunity.size} communities from ${leiden.records.length} nodes`,
    );

    // 6. Consolidate each community.
    const sorted = [...byCommunity.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    let written = 0;
    for (const [cid, members] of sorted) {
      const counts: Record<string, number> = {};
      for (const m of members) counts[m.node.label] = (counts[m.node.label] ?? 0) + 1;
      console.log(
        `\n# ─── Community ${cid} (${members.length} traces — ${describeCounts(counts)}) ───`,
      );
      const content = await consolidateExperienceCluster(nano, members);
      console.log(content);

      if (args.commit) {
        const labelsInCluster = Object.keys(counts) as BaseLabel[];
        const consolidationId = await createConsolidation(session, {
          ghostId: args.sessionId,
          content,
          communityId: cid,
          sourceCount: members.length,
          sourceLabels: labelsInCluster,
          sourceLabelCounts: counts,
          cascadeIndexAtSleep: 0,
        });
        await relabelMixedAsConsolidated(session, {
          members: members.map((m) => ({
            id: m.node.id,
            baseLabel: m.node.label as BaseLabel,
          })),
          consolidationId,
        });
        written += 1;
        console.log(
          `  committed: Consolidation ${consolidationId} (${members.length} sources relabelled)`,
        );
      }
    }
    if (args.commit) console.log(`\n# Wrote ${written} Consolidations.`);
    else console.log(`\n# (dry run) — pass --commit to persist`);
  } finally {
    try {
      await session.run(`CALL gds.graph.drop($graph) YIELD graphName`, {
        graph: graphName,
      });
    } catch { /* fine */ }
    // Only the Aura session lifecycle needs teardown; in-db has none.
    if (gdsMode() === "sessions") {
      await deleteAgaSession(session, AGA_SESSION_NAME);
    }
    await close();
  }
}

function pickBaseLabel(
  labelsArr: string[],
  allowed: SourceLabel[],
): SourceLabel | null {
  for (const a of allowed) if (labelsArr.includes(a)) return a;
  return null;
}

function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
}

function neoNum(v: unknown): number {
  if (
    v !== null &&
    typeof v === "object" &&
    "toNumber" in v &&
    typeof (v as { toNumber: unknown }).toNumber === "function"
  ) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

if (isCliEntry(import.meta.url)) {
  await runTryConsolidateExperience(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
