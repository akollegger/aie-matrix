/**
 * Embed `:Consolidation` content into a vector property so the
 * second AGA pass (contradiction detection) has a similarity signal
 * to project on.
 *
 *   - Find all :Consolidation nodes without `embedding`.
 *   - Embed `content` via OpenAI text-embedding-3-small (1536 dims).
 *   - Write back as `embedding` (matches the property name on
 *     agent-memory's Messages so downstream Cypher can use the
 *     same projection config).
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run embed:consolidations
 */

import neo4j from "neo4j-driver";

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { IntentEmbedder } from "../llm/embedder.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const BATCH_SIZE = 50;

export async function runEmbedConsolidations(opts: {} = {}): Promise<void> {
  void opts;
  const { session, close } = await openSessionFromEnv();
  const embedder = new IntentEmbedder();
  console.log(`# Using model: ${embedder.model}`);

  let totalEmbedded = 0;
  try {
    const remainingRes = await session.run(`
      MATCH (c:Consolidation)
      WHERE c.embedding IS NULL AND c.content IS NOT NULL
      RETURN count(c) AS n
    `);
    const remaining = neoNum(remainingRes.records[0]?.get("n"));
    console.log(`# Consolidations needing embedding: ${remaining}`);
    if (remaining === 0) {
      console.log("Nothing to do.");
      return;
    }

    while (true) {
      const batchRes = await session.run(
        `
          MATCH (c:Consolidation)
          WHERE c.embedding IS NULL AND c.content IS NOT NULL
          WITH c LIMIT $batch
          RETURN c.id AS id, c.content AS content
        `,
        { batch: neo4j.int(BATCH_SIZE) },
      );
      if (batchRes.records.length === 0) break;

      const items = batchRes.records.map((r) => ({
        id: r.get("id") as string,
        content: r.get("content") as string,
      }));

      let embeddings: number[][];
      try {
        embeddings = await embedder.embedBatch(items.map((i) => i.content));
      } catch (err) {
        // Don't let an embeddings hiccup abort the whole blackout — the rest
        // of the sleep (distillation, self-narrative) doesn't need these
        // vectors, and the un-embedded consolidations are retried next sleep.
        console.warn(
          `# embed-consolidations: skipping ${items.length} this round — ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }

      await session.run(
        `
          UNWIND $payload AS row
          MATCH (c:Consolidation) WHERE c.id = row.id
          SET c.embedding = row.embedding
        `,
        {
          payload: items.map((it, i) => ({
            id: it.id,
            embedding: embeddings[i],
          })),
        },
      );
      totalEmbedded += items.length;
      console.log(`  embedded ${items.length} (total ${totalEmbedded}/${remaining})`);
    }
  } finally {
    await close();
  }
  console.log(`\n# Done — embedded ${totalEmbedded} Consolidations.`);
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
  await runEmbedConsolidations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
