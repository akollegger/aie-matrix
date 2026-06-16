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
 * Fetch the most recent cascades for a ghost (regardless of success
 * flag), expanded with each one's full step content. Useful as the
 * Id's working memory — a concise journal of recent past experience.
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
// Surface context: dialogue with cluster, action digest, occupant impressions
// ---------------------------------------------------------------------------

/**
 * One dialogue turn (incoming OR outgoing) involving the running ghost.
 * `cascadeIndex` is the absolute index at which the turn occurred — the
 * Surface renderer derives "X cascades ago" as (currentCascade - cascadeIndex)
 * so silences read as concrete gaps rather than rolling windows.
 */
export interface DialogueTurn {
  /** Speaker direction relative to the running ghost. */
  readonly by: "self" | "other";
  /** Absolute cascade index when the turn was recorded, or null if the
   *  trace was persisted before cascadeIndex was threaded through. */
  readonly cascadeIndex: number | null;
  /** Wall-clock ISO timestamp, used as fallback ordering when cascadeIndex
   *  is null. */
  readonly at: string | null;
  readonly text: string;
}

/**
 * For each other-ghost display name supplied, return the most recent N
 * dialogue turns between the running ghost and that ghost, ordered oldest →
 * newest. An empty array is a meaningful answer ("never spoken") and the
 * Surface renderer is expected to render it as such — the absence is the
 * signal.
 *
 * Matches dialogue by:
 *   - outgoing: messages with role="assistant" + metadata.to_ghost_id
 *   - incoming: messages with role="user" + metadata.from_display_name
 *
 * Older traces persisted before the metadata tagging shipped will be
 * silently skipped by the filters — that's fine; new dialogue surfaces
 * immediately and old dialogue ages out by attrition.
 */
export async function fetchRecentDialogueWith(
  client: Client,
  selfGhostId: string,
  others: ReadonlyArray<{ ghostId: string; displayName: string }>,
  perGhost = 3,
): Promise<Map<string, DialogueTurn[]>> {
  const out = new Map<string, DialogueTurn[]>();
  if (others.length === 0 || perGhost < 1) return out;

  // Agent Memory's storage for messages:
  //   (c:Conversation { session_id })-[:HAS_MESSAGE]->(m:Message)
  // where `m.metadata` is a JSON string (Python `json.dumps`, default
  // spaced format). The canonical "filter by metadata key/value" pattern
  // here is `m.metadata CONTAINS '"key": "value"'` (or no-space alt).
  // We do one round trip per other ghost — cluster size is small (≤cap).
  await Promise.all(
    others.map(async ({ ghostId: otherGhostId, displayName: otherDisplayName }) => {
      const toPat = `"to_ghost_id": "${otherGhostId}"`;
      const toPatAlt = `"to_ghost_id":"${otherGhostId}"`;
      const fromPat = `"from_display_name": "${otherDisplayName}"`;
      const fromPatAlt = `"from_display_name":"${otherDisplayName}"`;
      const result = await callOrThrow(client, "graph_query", {
        query: `
          MATCH (c:Conversation { session_id: $self_id })-[:HAS_MESSAGE]->(m:Message)
          WHERE m.metadata IS NOT NULL AND (
            (m.role = 'assistant' AND (m.metadata CONTAINS $to_pat OR m.metadata CONTAINS $to_pat_alt))
            OR
            (m.role = 'user' AND (m.metadata CONTAINS $from_pat OR m.metadata CONTAINS $from_pat_alt))
          )
          WITH m
          ORDER BY m.timestamp DESC
          LIMIT $k
          WITH m
          ORDER BY m.timestamp ASC
          RETURN
            m.role AS role,
            m.content AS content,
            m.metadata AS metadata,
            toString(m.timestamp) AS at
        `,
        parameters: {
          self_id: selfGhostId,
          to_pat: toPat,
          to_pat_alt: toPatAlt,
          from_pat: fromPat,
          from_pat_alt: fromPatAlt,
          k: perGhost,
        },
      });
      const rows = rowsOf(result);
      const turns: DialogueTurn[] = [];
      for (const r of rows) {
        const text = stringOrNull(r.content);
        if (text === null) continue;
        const role = stringOrNull(r.role);
        const by: "self" | "other" = role === "assistant" ? "self" : "other";
        // Incoming messages were stored as "<from>: <text>"; strip the
        // prefix so the Surface renderer doesn't double up the speaker name.
        const stripped =
          by === "other" && text.startsWith(`${otherDisplayName}: `)
            ? text.slice(`${otherDisplayName}: `.length)
            : text;
        turns.push({
          by,
          cascadeIndex: parseCascadeIndexFromMetadata(r.metadata),
          at: stringOrNull(r.at),
          text: stripped,
        });
      }
      out.set(otherGhostId, turns);
    }),
  );

  return out;
}

/** Parse Agent Memory's JSON-string metadata and pull `cascade_index`.
 *  Returns null on any malformed/absent input rather than throwing — a
 *  missing index just degrades the renderer to "earlier" instead of a
 *  concrete gap. */
function parseCascadeIndexFromMetadata(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const ci = parsed.cascade_index;
    return typeof ci === "number" ? ci : null;
  } catch {
    return null;
  }
}

/** A single past action, compacted for the Surface's "what did I just try" view. */
export interface ActionDigestEntry {
  readonly cascadeIndex: number | null;
  readonly at: string | null;
  readonly tool: string;
  readonly outcome: "ok" | "denied" | "failed";
  /** Brief one-line summary of args + result, suitable for inclusion
   *  in a prompt without a JSON dump. */
  readonly summary: string;
}

/**
 * Last K Surface actions across the most recent traces — what the ghost
 * just tried, in chronological-oldest-first order. Lets the Surface
 * notice "I just tried go and got denied; try something else."
 */
export async function fetchRecentActionDigest(
  client: Client,
  ghostId: string,
  k = 5,
): Promise<readonly ActionDigestEntry[]> {
  if (k < 1) return [];
  // Agent Memory stores tool calls on a separate (:ToolCall) node linked
  // from the (:ReasoningStep) via [:USES_TOOL]. ToolCall carries
  // `tool_name`, `arguments` (JSON string), `status`, `result`, `timestamp`.
  // Trace metadata (also JSON string) holds our `cascade_index`. We pull
  // the JSON-encoded fields verbatim and parse them on the JS side.
  const result = await callOrThrow(client, "graph_query", {
    query: `
      MATCH (t:ReasoningTrace { session_id: $session_id })-[:HAS_STEP]->(s:ReasoningStep)-[:USES_TOOL]->(tc:ToolCall)
      WITH t, tc
      ORDER BY tc.timestamp DESC
      LIMIT $k
      WITH t, tc
      ORDER BY tc.timestamp ASC
      RETURN
        t.metadata AS trace_metadata,
        tc.tool_name AS tool,
        tc.arguments AS arguments,
        tc.status AS status,
        toString(tc.timestamp) AS at
    `,
    parameters: { session_id: ghostId, k },
  });
  const rows = rowsOf(result);
  return rows.map(rowToActionDigest).filter((e): e is ActionDigestEntry => e !== null);
}

function rowToActionDigest(row: Record<string, unknown>): ActionDigestEntry | null {
  const tool = stringOrNull(row.tool);
  if (tool === null) return null;
  const status = stringOrNull(row.status);
  // Agent Memory's ToolCall.status is one of "success" / "error" / "timeout"
  // (per neo4j_agent_memory/memory/reasoning.py). Map to our 3-way digest.
  const outcome: "ok" | "denied" | "failed" =
    status === "success"
      ? "ok"
      : status === "error" || status === "timeout"
        ? "failed"
        : "ok";
  // Arguments are stored JSON-stringified. Decode and pull one compact
  // descriptor for the prompt; the full args still live in the graph.
  let argsBrief = "";
  const argsRaw = row.arguments;
  if (typeof argsRaw === "string" && argsRaw.length > 0) {
    try {
      const a = JSON.parse(argsRaw) as Record<string, unknown>;
      if (typeof a.toward === "string") argsBrief = a.toward;
      else if (typeof a.itemRef === "string") argsBrief = a.itemRef;
      else if (typeof a.at === "string") argsBrief = a.at;
      else if (typeof a.to === "string") argsBrief = `to:${a.to.slice(0, 12)}`;
    } catch {
      /* ignore — fall back to tool name only */
    }
  }
  const summary = argsBrief.length > 0 ? `${tool}(${argsBrief})` : tool;
  return {
    cascadeIndex: parseCascadeIndexFromMetadata(row.trace_metadata),
    at: stringOrNull(row.at),
    tool,
    outcome,
    summary,
  };
}

/**
 * For each cluster occupant supplied, the most recent observation the
 * running ghost recorded that mentions them. Grounds the Surface in
 * "who these ghosts are right now" without re-deriving from raw look
 * data each cascade.
 *
 * Looks for observation strings on look-step ReasoningSteps that
 * contain the occupant's display name OR ghost id. Returns the
 * observation text verbatim — the Surface renderer can decide whether
 * to render it.
 */
/**
 * For each cluster occupant supplied, the most recent impression Fact
 * the observer recorded about them (written by `persistImpressions`).
 *
 * Filters by `(:Fact { subject: <displayName> })` AND the JSON-encoded
 * metadata fields `observer_id` and `observed_ghost_id` — the latter
 * disambiguates when display names happen to collide.
 *
 * Returns Map<ghostId, { snippet, cascadeIndex }>. The renderer turns
 * "5 cascades ago" into the gap string from `cascadeIndex`.
 */
export interface ImpressionView {
  readonly snippet: string;
  readonly cascadeIndex: number | null;
  readonly at: string | null;
}

export async function fetchOccupantImpressions(
  client: Client,
  observerGhostId: string,
  others: ReadonlyArray<{ ghostId: string; displayName: string }>,
): Promise<Map<string, ImpressionView>> {
  const out = new Map<string, ImpressionView>();
  if (others.length === 0) return out;

  // Single Cypher round trip per other ghost. Cluster is small (typically
  // 1-3). Spaced and no-space alt patterns mirror Agent Memory's own
  // metadata-filter convention (see _build_metadata_filter_clause_json).
  await Promise.all(
    others.map(async ({ ghostId: otherGhostId, displayName: otherDisplayName }) => {
      const observerPat = `"observer_id": "${observerGhostId}"`;
      const observerPatAlt = `"observer_id":"${observerGhostId}"`;
      const observedPat = `"observed_ghost_id": "${otherGhostId}"`;
      const observedPatAlt = `"observed_ghost_id":"${otherGhostId}"`;
      const result = await callOrThrow(client, "graph_query", {
        query: `
          MATCH (f:Fact)
          WHERE f.subject = $observed_name
            AND f.predicate = 'was_observed'
            AND f.metadata IS NOT NULL
            AND (f.metadata CONTAINS $observer_pat OR f.metadata CONTAINS $observer_pat_alt)
            AND (f.metadata CONTAINS $observed_pat OR f.metadata CONTAINS $observed_pat_alt)
          WITH f
          ORDER BY coalesce(f.valid_from, toString(f.created_at)) DESC
          LIMIT 1
          RETURN
            f.object AS snippet,
            f.metadata AS metadata,
            toString(coalesce(f.valid_from, f.created_at)) AS at
        `,
        parameters: {
          observed_name: otherDisplayName,
          observer_pat: observerPat,
          observer_pat_alt: observerPatAlt,
          observed_pat: observedPat,
          observed_pat_alt: observedPatAlt,
        },
      });
      const rows = rowsOf(result);
      if (rows.length === 0) return;
      const snippet = stringOrNull(rows[0]!.snippet);
      if (snippet === null) return;
      out.set(otherGhostId, {
        snippet,
        cascadeIndex: parseCascadeIndexFromMetadata(rows[0]!.metadata),
        at: stringOrNull(rows[0]!.at),
      });
    }),
  );

  return out;
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
