/**
 * Diagnostic against the live Aura graph — driver-based (no MCP).
 *
 * Counts un-consolidated Messages per session (walking through
 * Conversation), confirms embedding presence + dim, and verifies
 * the GDS / AGA procedures we'll need are exposed.
 *
 * Run:
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run inspect:corpus
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";

loadRootEnv();

interface Query {
  readonly label: string;
  readonly cypher: string;
  readonly params?: Record<string, unknown>;
}

const QUERIES: ReadonlyArray<Query> = [
  {
    label: "Top-level label counts",
    cypher: `MATCH (n) UNWIND labels(n) AS l RETURN l, count(*) AS n ORDER BY n DESC LIMIT 30`,
  },
  {
    label: "Un-consolidated Messages per session (top 20)",
    cypher: `
      MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message)
      WHERE NOT EXISTS((m)-[:CONSOLIDATED_TO]->())
      RETURN c.session_id AS session_id, count(m) AS un_consolidated_messages
      ORDER BY un_consolidated_messages DESC
      LIMIT 20
    `,
  },
  {
    label: "Embedding dim sample (first 3 Messages)",
    cypher: `
      MATCH (m:Message) WHERE m.embedding IS NOT NULL
      WITH m LIMIT 3
      RETURN size(m.embedding) AS dim, left(coalesce(m.content,''), 80) AS preview
    `,
  },
  {
    label: "Existing :Consolidation / :Skill counts",
    cypher: `
      OPTIONAL MATCH (c:Consolidation)
      WITH count(c) AS consolidations
      OPTIONAL MATCH (s:Skill)
      RETURN consolidations, count(s) AS skills
    `,
  },
  {
    label: "GDS procedures we'll need",
    cypher: `
      SHOW PROCEDURES
      YIELD name
      WHERE name IN [
        'gds.graph.project',
        'gds.graph.drop',
        'gds.knn.mutate',
        'gds.knn.stream',
        'gds.leiden.mutate',
        'gds.leiden.stream',
        'gds.pageRank.stream',
        'gds.graph.nodeProperty.stream'
      ]
      RETURN name ORDER BY name
    `,
  },
  {
    label: "ReasoningTrace success distribution",
    cypher: `
      MATCH (rt:ReasoningTrace)
      RETURN
        sum(CASE WHEN rt.success = true THEN 1 ELSE 0 END) AS true_traces,
        sum(CASE WHEN rt.success = false THEN 1 ELSE 0 END) AS false_traces,
        sum(CASE WHEN rt.success IS NULL THEN 1 ELSE 0 END) AS null_traces,
        count(rt) AS total
    `,
  },
];

async function main(): Promise<void> {
  const { session, close } = await openSessionFromEnv();
  try {
    for (const q of QUERIES) {
      console.log(`\n— ${q.label} —`);
      try {
        const result = await session.run(q.cypher, q.params ?? {});
        if (result.records.length === 0) {
          console.log("  (empty)");
          continue;
        }
        for (const r of result.records) {
          const obj: Record<string, unknown> = {};
          for (const key of r.keys) {
            obj[String(key)] = neoToJs(r.get(key));
          }
          console.log("  " + JSON.stringify(obj));
        }
      } catch (err) {
        console.log(
          `  ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    await close();
  }
}

/** Convert neo4j-driver runtime types to plain JS for JSON.stringify. */
function neoToJs(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  if (Array.isArray(v)) return v.map(neoToJs);
  return v;
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
