/**
 * Reasoning-trace retrieval helpers.
 *
 * `memory_get_context` and `memory_search` find similar past traces by
 * embedding, but their default returned format only includes trace
 * summaries (task + outcome). The actual `thought` / `action` /
 * `observation` text on the connected `ReasoningStep` nodes is
 * dropped — which makes that retrieval shape unsuitable as direct
 * context for an LLM that needs to learn from past reasoning.
 *
 * Worse: `memory_search`'s `memory_types: ["reasoning"]` filter is
 * silently ignored — its results buckets only ever cover messages,
 * entities, and preferences. So semantic search over reasoning traces
 * isn't available through Agent Memory's standard tools as of the
 * version this code was written against.
 *
 * For v1 we expose `fetchRecentCascades` (chronological retrieval with
 * full text inline) and `fetchCascadeById` (direct fetch). Semantic
 * similarity over reasoning traces is a TODO — when needed, embed the
 * anchor text via the OpenAI API and run a vector-similarity Cypher
 * query against `ReasoningTrace.task_embedding`.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { callOrThrow } from "./persist.js";

/** A single reasoning step's textual content as stored in the graph. */
export interface CascadeReplayStep {
  readonly thought: string | null;
  readonly action: string | null;
  readonly observation: string | null;
}

/** A past reasoning trace expanded with its full step content. */
export interface CascadeReplay {
  readonly traceId: string;
  readonly task: string | null;
  readonly outcome: string | null;
  readonly success: boolean | null;
  /** Steps in original insertion order. */
  readonly steps: ReadonlyArray<CascadeReplayStep>;
}

/**
 * Fetch the most recent successful cascades for a ghost, expanded with
 * each one's full step content. Useful as the Id's working memory — a
 * concise journal of what just happened in the ghost's recent past.
 *
 * @param client     Connected Agent Memory MCP client (extended profile).
 * @param ghostId    Session id of the ghost whose history to read.
 * @param k          How many recent cascades to retrieve. Default 3.
 */
export async function fetchRecentCascades(
  client: Client,
  ghostId: string,
  k = 3,
): Promise<readonly CascadeReplay[]> {
  if (k < 1) return [];

  const result = await callOrThrow(client, "graph_query", {
    query: `
      MATCH (t:ReasoningTrace { session_id: $session_id })
      WITH t ORDER BY coalesce(t.completed_at, t.started_at) DESC LIMIT $k
      OPTIONAL MATCH (t)-[:HAS_STEP]->(s:ReasoningStep)
      WITH t, s
      ORDER BY coalesce(s.created_at, s.id) ASC
      WITH t, collect(CASE WHEN s IS NULL THEN null ELSE {
        thought: s.thought,
        action: s.action,
        observation: s.observation
      } END) AS steps
      RETURN
        t.id AS trace_id,
        t.task AS task,
        t.outcome AS outcome,
        t.success AS success,
        steps
      ORDER BY coalesce(t.completed_at, t.started_at) DESC
    `,
    parameters: { session_id: ghostId, k },
  });

  const rows = rowsOf(result);
  return rows.map(rowToReplay);
}

/**
 * Pull a single trace from the graph by id, with all of its connected
 * steps inline. Returns `null` if the trace doesn't exist.
 */
export async function fetchCascadeById(
  client: Client,
  traceId: string,
): Promise<CascadeReplay | null> {
  const result = await callOrThrow(client, "graph_query", {
    query: `
      MATCH (t:ReasoningTrace { id: $trace_id })
      OPTIONAL MATCH (t)-[:HAS_STEP]->(s:ReasoningStep)
      WITH t, s
      ORDER BY coalesce(s.created_at, s.id) ASC
      RETURN
        t.id AS trace_id,
        t.task AS task,
        t.outcome AS outcome,
        t.success AS success,
        collect(CASE WHEN s IS NULL THEN null ELSE {
          thought: s.thought,
          action: s.action,
          observation: s.observation
        } END) AS steps
    `,
    parameters: { trace_id: traceId },
  });

  const rows = rowsOf(result);
  return rows.length > 0 ? rowToReplay(rows[0]!) : null;
}

// ---------------------------------------------------------------------------
// Result-shape extraction
// ---------------------------------------------------------------------------

function rowsOf(graphQueryResult: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!graphQueryResult || typeof graphQueryResult !== "object") return [];
  const rows = (graphQueryResult as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is Record<string, unknown> => r !== null && typeof r === "object",
  );
}

function rowToReplay(row: Record<string, unknown>): CascadeReplay {
  return {
    traceId: stringOrFallback(row.trace_id, ""),
    task: stringOrNull(row.task),
    outcome: stringOrNull(row.outcome),
    success: typeof row.success === "boolean" ? row.success : null,
    steps: stepsFromRow(row.steps),
  };
}

function stepsFromRow(value: unknown): readonly CascadeReplayStep[] {
  if (!Array.isArray(value)) return [];
  const out: CascadeReplayStep[] = [];
  for (const s of value) {
    if (s === null) continue;
    if (typeof s !== "object") continue;
    const obj = s as Record<string, unknown>;
    out.push({
      thought: stringOrNull(obj.thought),
      action: stringOrNull(obj.action),
      observation: stringOrNull(obj.observation),
    });
  }
  return out;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function stringOrFallback(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Render a `CascadeReplay` as plain text for inclusion in an LLM
 * prompt. Designed to read like a brief journal entry rather than a
 * Cypher dump.
 */
export function formatCascadeReplay(replay: CascadeReplay): string {
  const lines: string[] = [];
  if (replay.task !== null) lines.push(`Task: ${replay.task}`);

  for (const s of replay.steps) {
    if (s.thought) lines.push(`  thought: ${s.thought}`);
    if (s.action) lines.push(`  action: ${s.action}`);
    if (s.observation) lines.push(`  observation: ${s.observation}`);
  }

  if (replay.outcome) lines.push(`  outcome: ${replay.outcome}`);
  return lines.join("\n");
}
