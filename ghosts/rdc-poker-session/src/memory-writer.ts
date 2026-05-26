/**
 * Persist a completed poker hand as a memory for each player.
 *
 * The Neo4j Agent Memory MCP server only allows writes through its
 * trace API (`memory_start_trace` → `memory_record_step`* →
 * `memory_complete_trace`); raw Cypher via `graph_query` is read-only.
 * So each ghost gets one ReasoningTrace per hand, with steps for the
 * deal, the action sequence, and the outcome.
 *
 * The social brain already pulls recent ReasoningTraces via
 * `fetchRecentCascades`, so poker memories appear in the same stream
 * as ordinary cascades — exactly what we want for the "social brain
 * remembers last hand with ghost_X" behaviour.
 */

import {
  callOrThrow,
  connectMemory,
  type MemoryClientHandle,
  type MemoryConnection,
} from "@aie-matrix/ghost-peppers-mem";

import type {
  Card,
  GameState,
  PlayerAction,
} from "@aie-matrix/ghost-rdc-poker";

/** Per-turn LLM output captured live during the hand and replayed
 *  into the persistence layer afterwards. We keep both the private
 *  reasoning (the model's stated thought process) and the public
 *  speech (what it said at the table, including its addressee) so a
 *  later audit can distinguish intentional bluff-via-chat from
 *  accidentally-misleading roleplay flavor.
 *
 *  Indexed positionally — `actionAnnotations[i]` describes the same
 *  turn as `actions[i]`. Caller is responsible for keeping the two
 *  arrays in lockstep. */
export interface ActionAnnotation {
  /** Mirror of PlayerAction so the consumer can sanity-check alignment. */
  readonly playerId: string;
  readonly action: "fold" | "check" | "call" | "raise" | "all-in";
  readonly amount: number;
  /** The LLM's private reasoning for this turn — verbatim from the
   *  brain's JSON output. Goes into the persisted ReasoningStep's
   *  `thought` field. */
  readonly reasoning: string;
  /** What the LLM said aloud, if anything. Empty string means silent. */
  readonly tableTalk: string;
  /** Resolved addressee displayName if the speech started with
   *  "@<Name>:"; otherwise null (general table-talk). */
  readonly tableTalkTo: string | null;
}

export interface PokerHandRecord {
  readonly handId: string;
  readonly handNumber: number;
  readonly tableId: string;
  readonly finalState: GameState;
  readonly actions: ReadonlyArray<PlayerAction>;
  /** Optional — when present, length must equal `actions.length`. */
  readonly actionAnnotations?: ReadonlyArray<ActionAnnotation>;
  readonly perGhost: ReadonlyArray<{
    readonly ghostId: string;
    readonly ghostName: string;
    readonly holeCards: ReadonlyArray<Card>;
    readonly netChange: number;
    readonly won: boolean;
    readonly finalHandDescription: string | null;
  }>;
  readonly atIso: string;
}

let memorySingleton: Promise<MemoryClientHandle> | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function envConnection(): MemoryConnection {
  return {
    uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
    username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
    password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
    database: process.env.GHOST_MINDS_NEO4J_DATABASE,
  };
}

export async function getMemoryHandle(): Promise<MemoryClientHandle> {
  if (memorySingleton === null) {
    memorySingleton = connectMemory({ connection: envConnection() });
  }
  return memorySingleton;
}

export async function closeMemory(): Promise<void> {
  if (memorySingleton === null) return;
  const handle = await memorySingleton;
  await handle.close();
  memorySingleton = null;
}

function cardToString(c: Card): string {
  const suitMap: Record<string, string> = {
    hearts: "h",
    diamonds: "d",
    clubs: "c",
    spades: "s",
  };
  const r = c.rank === "10" ? "T" : c.rank;
  return `${r}${suitMap[c.suit] ?? c.suit[0]!}`;
}

function cardsToString(cs: ReadonlyArray<Card>): string {
  return cs.map(cardToString).join(" ");
}

function actionLine(a: PlayerAction, players: GameState["players"]): string {
  const player = players.find((p) => p.id === a.playerId);
  const name = player?.name ?? a.playerId.slice(0, 8);
  if (a.action === "raise" || a.action === "call") {
    return `${name} ${a.action} ${a.amount}`;
  }
  return `${name} ${a.action}`;
}

function extractTraceId(result: unknown): string {
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    for (const key of ["trace_id", "id", "traceId"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  throw new Error(
    `memory_start_trace returned no trace_id: ${JSON.stringify(result)}`,
  );
}

/**
 * Write the hand to Neo4j as one ReasoningTrace per ghost. Each trace
 * is opened with a "played hand N at table T" task, gets steps for
 * deal / actions / outcome, and is closed with a one-line outcome.
 */
export async function persistHand(record: PokerHandRecord): Promise<void> {
  const handle = await getMemoryHandle();
  const board = cardsToString(record.finalState.communityCards);

  for (const g of record.perGhost) {
    const opponents = record.perGhost
      .filter((other) => other.ghostId !== g.ghostId)
      .map((other) => other.ghostName);
    const task = `Played poker hand ${record.handNumber} at table ${record.tableId.slice(0, 8)} vs ${opponents.join(", ")}`;

    let traceId: string;
    try {
      const startResult = await callOrThrow(handle.client, "memory_start_trace", {
        session_id: g.ghostId,
        task,
        metadata: {
          kind: "poker-hand",
          hand_id: record.handId,
          hand_number: record.handNumber,
          table_id: record.tableId,
          ghost_name: g.ghostName,
          opponents: opponents,
          atIso: record.atIso,
        },
      });
      traceId = extractTraceId(startResult);
    } catch (err) {
      // Don't let memory writes block the hand pipeline.
      console.warn(
        JSON.stringify({
          kind: "rdc-orch.memory-trace-start-failed",
          ghostId: g.ghostId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }

    try {
      // Step 1: the deal — what we were dealt and what hit the board.
      await callOrThrow(handle.client, "memory_record_step", {
        trace_id: traceId,
        thought: `Dealt ${cardsToString(g.holeCards)} at the saloon.`,
        observation: board.length > 0 ? `Board: ${board}` : "Hand ended pre-flop.",
      });

      // Step 2..N: the action sequence. When annotations are present,
      // attach the LLM's reasoning + tableTalk per turn so a later
      // audit can see how speech tracked (or diverged from) the bet.
      // This is the layer that lets us detect bluff-via-chat — e.g.
      // "raising 18 chips while claiming 6-high" — by reading the
      // reasoning back from the graph.
      const annotations = record.actionAnnotations;
      for (let i = 0; i < record.actions.length; i++) {
        const a = record.actions[i]!;
        const ann = annotations?.[i];
        // Safety: annotations are positional. If they don't line up
        // (count mismatch or playerId divergence) we still log the
        // action but skip the annotation to avoid attaching the
        // wrong thought to the wrong turn.
        const aligned = ann && ann.playerId === a.playerId;
        const step: Record<string, unknown> = {
          trace_id: traceId,
          action: actionLine(a, record.finalState.players),
        };
        if (aligned) {
          if (ann.reasoning && ann.reasoning.length > 0) {
            step.thought = ann.reasoning;
          }
          if (ann.tableTalk && ann.tableTalk.length > 0) {
            step.observation = ann.tableTalkTo
              ? `Said to ${ann.tableTalkTo}: "${ann.tableTalk}"`
              : `Said to the table: "${ann.tableTalk}"`;
          }
        }
        await callOrThrow(handle.client, "memory_record_step", step);
      }

      // Final step: outcome.
      const outcomeText = g.won
        ? `Won ${g.netChange} cyphers${g.finalHandDescription ? ` with ${g.finalHandDescription}` : ""}.`
        : `Lost ${Math.abs(g.netChange)} cyphers.`;
      await callOrThrow(handle.client, "memory_record_step", {
        trace_id: traceId,
        observation: outcomeText,
      });

      await callOrThrow(handle.client, "memory_complete_trace", {
        trace_id: traceId,
        outcome: outcomeText,
        success: g.won,
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          kind: "rdc-orch.memory-step-failed",
          ghostId: g.ghostId,
          traceId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      // Try to close the trace even if a step failed.
      try {
        await callOrThrow(handle.client, "memory_complete_trace", {
          trace_id: traceId,
          outcome: "incomplete (write error mid-trace)",
          success: false,
        });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Pull the most recent N reasoning traces for a ghost. Used by the
 * overlay's `/memories/:ghostId` endpoint — light summaries only.
 */
export async function fetchRecentHands(
  ghostId: string,
  k = 10,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const handle = await getMemoryHandle();
  const result = (await callOrThrow(handle.client, "graph_query", {
    query: `
      MATCH (t:ReasoningTrace { session_id: $ghostId })
      WHERE t.metadata_kind = "poker-hand" OR t.task STARTS WITH "Played poker hand"
      RETURN t.id AS trace_id, t.task AS task, t.outcome AS outcome,
             t.started_at AS started_at, t.completed_at AS completed_at
      ORDER BY coalesce(t.completed_at, t.started_at) DESC
      LIMIT $k
    `,
    parameters: { ghostId, k },
  })) as { rows?: ReadonlyArray<Record<string, unknown>> };
  return result.rows ?? [];
}

/**
 * Build per-opponent memory lines in the format pokerswarm's brain
 * expects:
 *
 *   - <Name>: Recent — <action1>, <action2>, ... Tendencies: <action> (Nx), ...
 *
 * Lifted from pokerswarm-ai/src/lib/agents/memory.ts:buildMemoryContext
 * with one structural change: pokerswarm's Cypher hits a per-game
 * `Player -[:TOOK_ACTION]-> Hand` graph, ours hits the Agent Memory
 * MCP's `ReasoningTrace -[:HAS_STEP]-> ReasoningStep` schema. The
 * action strings on our steps come from the line-builder in
 * `persistHand`, which writes things like "Black Bart raise 50" — we
 * parse those back out by ghost name.
 *
 * Called once per hand-start (per seated agent) and passed forward in
 * the turn payload as `opponentReads`. One MCP round-trip per call;
 * read-only `graph_query`, allowed by the agent-memory server.
 */
export async function fetchOpponentReads(
  ghostId: string,
  opponentNames: ReadonlyArray<string>,
  recentLimit = 5,
): Promise<ReadonlyArray<string>> {
  if (opponentNames.length === 0) return [];
  const handle = await getMemoryHandle();

  // 1. Pull recent traces for this ghost where ANY named opponent
  //    appears in the task line, plus the steps under each.
  const result = (await callOrThrow(handle.client, "graph_query", {
    query: `
      MATCH (t:ReasoningTrace { session_id: $ghostId })
      WHERE t.task STARTS WITH "Played poker hand"
        AND any(opp IN $opponents WHERE t.task CONTAINS opp)
      WITH t ORDER BY coalesce(t.completed_at, t.started_at) DESC LIMIT $traceLimit
      OPTIONAL MATCH (t)-[:HAS_STEP]->(s:ReasoningStep)
      WITH t, s ORDER BY coalesce(s.created_at, s.id) ASC
      WITH t,
           collect(CASE WHEN s IS NULL THEN null ELSE {
             action: s.action,
             observation: s.observation
           } END) AS steps
      RETURN t.task AS task, steps
      ORDER BY t.completed_at DESC
    `,
    parameters: {
      ghostId,
      opponents: [...opponentNames],
      // Pull a few more traces than we'll show, so each opponent has
      // some action history even when only one or two recent hands
      // include them.
      traceLimit: opponentNames.length * recentLimit + 5,
    },
  })) as {
    rows?: ReadonlyArray<{
      task?: string;
      steps?: ReadonlyArray<{
        action?: string | null;
        observation?: string | null;
      } | null>;
    }>;
  };

  // 2. Walk each trace and bucket the per-opponent action verbs by
  //    name. We can't reconstruct phase from our step strings (we
  //    didn't write phase as structured metadata), so we drop the
  //    "phase" tag pokerswarm includes — recent actions and tendency
  //    counts still come through.
  type ActionRow = { verb: string; amount: number };
  const recentByOpponent = new Map<string, ActionRow[]>();
  const tendenciesByOpponent = new Map<string, Map<string, number>>();

  for (const row of result.rows ?? []) {
    for (const step of row.steps ?? []) {
      if (!step?.action) continue;
      const parsed = parseStepAction(step.action);
      if (!parsed) continue;
      const matchedName = opponentNames.find((n) => parsed.actor === n);
      if (!matchedName) continue;
      const recent = recentByOpponent.get(matchedName) ?? [];
      recent.push({ verb: parsed.verb, amount: parsed.amount });
      recentByOpponent.set(matchedName, recent);
      const counts = tendenciesByOpponent.get(matchedName) ?? new Map<string, number>();
      counts.set(parsed.verb, (counts.get(parsed.verb) ?? 0) + 1);
      tendenciesByOpponent.set(matchedName, counts);
    }
  }

  // 3. Format one line per opponent in pokerswarm's shape.
  const lines: string[] = [];
  for (const name of opponentNames) {
    const recent = (recentByOpponent.get(name) ?? []).slice(0, recentLimit);
    const counts = tendenciesByOpponent.get(name) ?? new Map();
    if (recent.length === 0 && counts.size === 0) continue;

    const recentText =
      recent.length > 0
        ? `Recent — ${recent
            .map((a) => (a.amount > 0 ? `${a.verb} ${a.amount}` : a.verb))
            .join(", ")}`
        : "";
    const tendencyEntries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const tendenciesText =
      tendencyEntries.length > 0
        ? `Tendencies: ${tendencyEntries
            .map(([verb, count]) => `${verb} (${count}x)`)
            .join(", ")}`
        : "";

    const parts = [recentText, tendenciesText].filter((s) => s.length > 0);
    if (parts.length > 0) lines.push(`- ${name}: ${parts.join(". ")}.`);
  }
  return lines;
}

/**
 * Parse a step.action string back into structured form.
 * Format from `persistHand`: `"<actor name> <verb> [amount]"`, e.g.
 *   "Black Bart raise 50"
 *   "Cassidy fold"
 *
 * Verbs: fold, check, call, raise, all-in. Names can contain spaces,
 * so we match the verb token and split on it.
 */
function parseStepAction(raw: string): {
  actor: string;
  verb: string;
  amount: number;
} | null {
  const verbs = ["fold", "check", "call", "raise", "all-in"];
  for (const verb of verbs) {
    const idx = raw.indexOf(` ${verb}`);
    if (idx === -1) continue;
    const actor = raw.slice(0, idx).trim();
    const tail = raw.slice(idx + 1 + verb.length).trim();
    const amount = tail.length > 0 ? Number.parseInt(tail, 10) : 0;
    return {
      actor,
      verb,
      amount: Number.isFinite(amount) ? amount : 0,
    };
  }
  return null;
}
