/**
 * Diagnostic: query PeppersGhosts directly via the extended-profile
 * `graph_query` tool to see what node labels and relationship types
 * actually exist. Useful for checking that we're hitting the right
 * memory tiers (conversation messages vs ReasoningTrace vs facts vs
 * entities).
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
        label: "Node label counts",
        query: `MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count ORDER BY count DESC`,
      },
      {
        label: "Relationship type counts",
        query: `MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC`,
      },
      {
        label: "Sessions present",
        query: `MATCH (n:Conversation) RETURN n.session_id AS session_id, n.created_at AS created_at LIMIT 20`,
      },
      {
        label: "ReasoningTrace nodes",
        query: `MATCH (t:ReasoningTrace) RETURN t.id AS id, t.task AS task, t.success AS success LIMIT 20`,
      },
      {
        label: "ReasoningStep nodes",
        query: `MATCH (s:ReasoningStep) RETURN s.thought AS thought, s.action AS action LIMIT 20`,
      },
    ];

    for (const { label, query } of queries) {
      console.log(`\n=== ${label} ===`);
      console.log(`-- ${query}`);
      try {
        const result = await callOrThrow(handle.client, "graph_query", { query });
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.log("(error)", err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
