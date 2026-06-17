/**
 * Diagnostic: what does the live Aura graph actually contain that
 * a sleep cycle would consolidate?
 *
 * Counts un-consolidated `:Message` and `:Observation` nodes per
 * ghost session, samples a few message contents per session, and
 * sanity-checks that GDS / AGA procedures are available.
 *
 * Run:
 *   pnpm --filter @aie-matrix/ghost-peppers-mem run inspect:sleep
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
        label: "Top-level label counts (all)",
        query: `MATCH (n) UNWIND labels(n) AS l RETURN l, count(*) AS n ORDER BY n DESC`,
      },
      {
        label: "Un-consolidated Messages per session (top 20)",
        query: `
          MATCH (m:Message)
          WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
          RETURN coalesce(m.session_id, '(no session_id)') AS session_id,
                 count(*) AS un_consolidated_messages
          ORDER BY un_consolidated_messages DESC
          LIMIT 20
        `,
      },
      {
        label: "Un-consolidated Observations per session (top 20)",
        query: `
          MATCH (n)
          WHERE 'Observation' IN labels(n)
            AND NOT EXISTS((n)-[:CONSOLIDATED_TO]->())
          RETURN coalesce(n.session_id, '(no session_id)') AS session_id,
                 count(*) AS un_consolidated_observations
          ORDER BY un_consolidated_observations DESC
          LIMIT 20
        `,
      },
      {
        label: "ReasoningTrace counts per session + success ratio",
        query: `
          MATCH (rt:ReasoningTrace)
          RETURN coalesce(rt.session_id, '(no session_id)') AS session_id,
                 count(*) AS traces,
                 sum(CASE WHEN rt.success THEN 1 ELSE 0 END) AS successes,
                 sum(CASE WHEN rt.success = false THEN 1 ELSE 0 END) AS failures
          ORDER BY traces DESC
          LIMIT 20
        `,
      },
      {
        label: "Sample message content shapes (first 8 from largest session)",
        query: `
          MATCH (m:Message)
          WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
          WITH m, m.session_id AS sid
          ORDER BY m.timestamp DESC
          WITH sid, collect(m)[..8] AS sampled
          UNWIND sampled AS m
          RETURN sid AS session_id,
                 m.role AS role,
                 left(coalesce(m.content, ''), 160) AS preview
          LIMIT 8
        `,
      },
      {
        label: "Any existing Consolidation nodes?",
        query: `MATCH (c:Consolidation) RETURN count(c) AS n`,
      },
      {
        label: "Any existing Skill nodes?",
        query: `MATCH (s:Skill) RETURN count(s) AS n`,
      },
      {
        label: "GDS / AGA sanity — list available procedures",
        query: `
          SHOW PROCEDURES
          YIELD name
          WHERE name STARTS WITH 'gds.'
          RETURN name
          ORDER BY name
          LIMIT 40
        `,
      },
      {
        label: "Embedding presence — count Messages with `embedding` property",
        query: `
          MATCH (m:Message)
          WHERE m.embedding IS NOT NULL
          RETURN count(*) AS messages_with_embedding
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
