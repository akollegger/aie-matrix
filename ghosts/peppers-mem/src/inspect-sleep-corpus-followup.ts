/**
 * Follow-up on inspect-sleep: verify two key findings.
 *   1. Embeddings exist on every Message — what model / dimension?
 *   2. Messages have `session_id: null` directly — does agent-memory
 *      store the session via the parent Conversation?
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { connectMemory } from "./client.js";
import { callOrThrow } from "./persist.js";

loadRootEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main(): Promise<void> {
  const handle = await connectMemory({
    connection: {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    },
    profile: "extended",
  });

  try {
    const queries: { label: string; query: string }[] = [
      {
        label: "Embedding dimensions across a few sample Messages",
        query: `
          MATCH (m:Message)
          WHERE m.embedding IS NOT NULL
          WITH m LIMIT 5
          RETURN
            size(m.embedding) AS embedding_dim,
            left(coalesce(m.content, ''), 80) AS preview
        `,
      },
      {
        label: "Message → Conversation → session_id (sample)",
        query: `
          MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
          WITH c, m LIMIT 5
          RETURN
            c.session_id AS conversation_session_id,
            m.session_id AS message_session_id,
            keys(m) AS message_keys
        `,
      },
      {
        label: "Conversation properties — what session-identifying fields exist?",
        query: `
          MATCH (c:Conversation)
          WITH c LIMIT 1
          RETURN keys(c) AS conversation_keys
        `,
      },
      {
        label: "Sample Message keys",
        query: `
          MATCH (m:Message)
          WITH m LIMIT 1
          RETURN keys(m) AS message_keys
        `,
      },
      {
        label: "Count Messages per conversation session_id (top 20)",
        query: `
          MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
          RETURN c.session_id AS session_id, count(m) AS messages
          ORDER BY messages DESC
          LIMIT 20
        `,
      },
      {
        label: "KNN / Leiden / PageRank available?",
        query: `
          SHOW PROCEDURES
          YIELD name
          WHERE name =~ 'gds\\\\.(knn|leiden|pageRank|graph\\\\.project|graph\\\\.drop|graph\\\\.nodeProperty\\\\.stream)\\\\..*'
          RETURN name
          ORDER BY name
        `,
      },
    ];

    for (const q of queries) {
      console.log(`\n— ${q.label} —`);
      try {
        const result = await callOrThrow(handle.client, "graph_query", {
          query: q.query,
        });
        const rows = extractRows(result);
        if (rows.length === 0) {
          console.log("  (empty)");
          continue;
        }
        for (const row of rows) {
          console.log("  " + JSON.stringify(row));
        }
      } catch (err) {
        console.log(
          `  ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    await handle.close();
  }
}

function extractRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!result || typeof result !== "object") return [];
  const r = result as { rows?: unknown };
  if (!Array.isArray(r.rows)) return [];
  return r.rows.filter(
    (x): x is Record<string, unknown> => x !== null && typeof x === "object",
  );
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
