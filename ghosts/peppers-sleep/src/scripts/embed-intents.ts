/**
 * Backfill `intent_embedding` on every `:Message` in the live graph.
 *
 *   1. Find Messages that don't have `intent_embedding` yet (resumable).
 *   2. Strip the speaker prefix from `content` (so the embedding
 *      captures intent, not voice).
 *   3. Embed via OpenAI `text-embedding-3-small` (native 1536 dims).
 *   4. Write the vector back as `intent_embedding`.
 *
 * Resumable — re-run after a network glitch and it picks up where it
 * left off (skips messages that already have `intent_embedding`).
 *
 * Cost: ~6,482 messages × ~60 tokens × $0.02 / 1M tokens ≈ $0.01.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run embed:intents
 */

import neo4j from "neo4j-driver";

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { IntentEmbedder } from "../llm/embedder.js";
import { stripSpeakerPrefix } from "../llm/strip-prefix.js";

loadRootEnv();

const BATCH_SIZE = 100;

async function main(): Promise<void> {
  const { session, close } = await openSessionFromEnv();
  const embedder = new IntentEmbedder();
  console.log(`# Using model: ${embedder.model}`);

  let totalEmbedded = 0;
  try {
    // 0. How many messages need work?
    const remainingRes = await session.run(`
      MATCH (m:Message)
      WHERE m.content IS NOT NULL
        AND m.intent_embedding IS NULL
      RETURN count(m) AS n
    `);
    const remaining = neoNum(remainingRes.records[0]?.get("n"));
    console.log(`# Messages needing intent_embedding: ${remaining}`);
    if (remaining === 0) {
      console.log("Nothing to do.");
      return;
    }

    // 1. Loop in BATCH_SIZE chunks.
    while (true) {
      const batchRes = await session.run(
        `
          MATCH (m:Message)
          WHERE m.content IS NOT NULL
            AND m.intent_embedding IS NULL
          WITH m LIMIT $batch
          RETURN m.id AS id, m.content AS content
        `,
        { batch: neo4j.int(BATCH_SIZE) },
      );
      if (batchRes.records.length === 0) break;

      const items = batchRes.records.map((r) => ({
        id: r.get("id") as string,
        content: r.get("content") as string,
      }));
      const stripped = items.map((i) => stripSpeakerPrefix(i.content));

      const embeddings = await embedder.embedBatch(stripped);
      if (embeddings.length !== items.length) {
        throw new Error(
          `embedBatch returned ${embeddings.length} vectors for ${items.length} inputs`,
        );
      }

      await session.run(
        `
          UNWIND $payload AS row
          MATCH (m:Message) WHERE m.id = row.id
          SET m.intent_embedding = row.embedding
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
  console.log(`\n# Done — embedded ${totalEmbedded} messages.`);
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

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
