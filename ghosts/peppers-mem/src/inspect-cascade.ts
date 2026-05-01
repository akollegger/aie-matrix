/**
 * Diagnostic: pull the FULL content of a single cascade — trace
 * metadata + every connected step's thought/action/observation/
 * tool fields — directly from the graph. Demonstrates that the
 * reasoning content is in fact stored, just not surfaced by
 * `memory_get_context`'s default rendering.
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
  });
  try {
    // 1. What relationship type connects ReasoningTrace -> ReasoningStep?
    console.log("\n=== Relationships emanating from a ReasoningTrace ===");
    const relTypes = await callOrThrow(handle.client, "graph_query", {
      query: `
        MATCH (t:ReasoningTrace)-[r]->(n)
        RETURN DISTINCT type(r) AS rel_type, labels(n) AS target_labels
      `,
    });
    console.log(JSON.stringify(relTypes, null, 2));

    // 2. Most recent successful trace, with all of its step text inline.
    console.log("\n=== Latest successful trace + every step's text ===");
    const fullTrace = await callOrThrow(handle.client, "graph_query", {
      query: `
        MATCH (t:ReasoningTrace { success: true })
        WITH t ORDER BY t.completed_at DESC LIMIT 1
        OPTIONAL MATCH (t)-[r]->(s:ReasoningStep)
        RETURN
          t.id AS trace_id,
          t.task AS task,
          t.outcome AS outcome,
          collect({
            rel: type(r),
            thought: s.thought,
            action: s.action,
            observation: s.observation,
            tool_name: s.tool_name,
            tool_args: s.tool_args,
            tool_result: s.tool_result
          }) AS steps
      `,
    });
    console.log(JSON.stringify(fullTrace, null, 2));
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
