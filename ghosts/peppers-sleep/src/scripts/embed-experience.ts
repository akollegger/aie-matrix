/**
 * Generalized backfill of `intent_embedding` across all sleep-source
 * labels. Per-label canonical text comes from `llm/canonical-text.ts`
 * so adding a new label is one map entry, not a new script.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run embed:experience [-- --labels=ReasoningTrace,Message --session=<sid>]
 *
 * Resumable: skips nodes that already have `intent_embedding`.
 */

import neo4j from "neo4j-driver";
import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { IntentEmbedder } from "../llm/embedder.js";
import {
  toCanonicalText,
  type SourceLabel,
} from "../llm/canonical-text.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const BATCH_SIZE = 100;
const ALL_LABELS: SourceLabel[] = [
  "Message",
  "ReasoningTrace",
  "Observation",
  "Entity",
  "Fact",
];

interface Args {
  readonly labels: SourceLabel[];
  readonly sessionId: string | null;
}

function parseArgs(): Args {
  let labels: SourceLabel[] = ALL_LABELS;
  let sessionId: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--labels=")) {
      const ls = arg.slice("--labels=".length).split(",").map((s) => s.trim());
      labels = ls.filter((l): l is SourceLabel =>
        (ALL_LABELS as string[]).includes(l),
      );
    } else if (arg.startsWith("--session=")) {
      sessionId = arg.slice("--session=".length);
    }
  }
  return { labels, sessionId };
}

export async function runEmbedExperience(
  opts: { sessionId?: string | null; labels?: SourceLabel[] } = {},
): Promise<void> {
  const args = {
    labels: opts.labels ?? ALL_LABELS,
    sessionId: opts.sessionId ?? null,
  };
  console.log(
    `# Labels: ${args.labels.join(", ")}${args.sessionId ? ` (session=${args.sessionId})` : " (all sessions)"}`,
  );
  const { session, close } = await openSessionFromEnv();
  const embedder = new IntentEmbedder();
  console.log(`# Model: ${embedder.model}`);

  let grandTotal = 0;
  try {
    for (const label of args.labels) {
      const filter = args.sessionId
        ? `WHERE n.session_id = $sid AND n.intent_embedding IS NULL`
        : `WHERE n.intent_embedding IS NULL`;
      const sidParam = args.sessionId ? { sid: args.sessionId } : {};

      const remainingRes = await session.run(
        `MATCH (n:${label}) ${filter} RETURN count(n) AS n`,
        sidParam,
      );
      const remaining = neoNum(remainingRes.records[0]?.get("n"));
      if (remaining === 0) {
        console.log(`# ${label}: nothing to embed`);
        continue;
      }
      console.log(`# ${label}: ${remaining} to embed`);

      let labelTotal = 0;
      while (true) {
        const batchRes = await session.run(
          `MATCH (n:${label}) ${filter}
           WITH n LIMIT $batch
           OPTIONAL MATCH (n)-[:HAS_STEP]->(s:ReasoningStep)
           WITH n, s ORDER BY coalesce(s.created_at, s.id) ASC
           WITH n, collect(properties(s)) AS steps
           RETURN n.id AS id, properties(n) AS props, steps`,
          { ...sidParam, batch: neo4j.int(BATCH_SIZE) },
        );
        if (batchRes.records.length === 0) break;

        const items = batchRes.records
          .map((r) => {
            const id = r.get("id") as string;
            const props = r.get("props") as Record<string, unknown>;
            const steps = r.get("steps") as Record<string, unknown>[];
            const text = toCanonicalText({ id, label, props, steps });
            return text === null ? null : { id, text };
          })
          .filter((x): x is { id: string; text: string } => x !== null);

        if (items.length === 0) {
          // Skip-only batch: nothing embed-worthy. Mark them with a
          // sentinel so we don't re-fetch — but actually safer to
          // just break out, otherwise an infinite loop on un-embeddable
          // rows. Mark by writing an empty-vector? No — just stop.
          console.log(
            `  ${label}: batch of ${batchRes.records.length} had no embed-worthy text; stopping this label`,
          );
          break;
        }

        const embeddings = await embedder.embedBatch(items.map((i) => i.text));
        if (embeddings.length !== items.length) {
          throw new Error(
            `embedBatch returned ${embeddings.length} for ${items.length} inputs`,
          );
        }

        await session.run(
          `UNWIND $payload AS row
           MATCH (n:${label}) WHERE n.id = row.id
           SET n.intent_embedding = row.embedding`,
          {
            payload: items.map((it, i) => ({
              id: it.id,
              embedding: embeddings[i],
            })),
          },
        );

        labelTotal += items.length;
        console.log(`  ${label}: ${items.length} embedded (running ${labelTotal})`);
      }
      grandTotal += labelTotal;
    }
  } finally {
    await close();
  }
  console.log(`\n# Done — ${grandTotal} nodes embedded across ${args.labels.length} label(s).`);
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
  await runEmbedExperience(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
