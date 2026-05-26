/**
 * Map a `CascadeTrace` from `peppers-inner` onto Agent Memory's MCP
 * tool surface. Every event in the trace becomes one message in the
 * ghost's session, tagged with a role string that identifies the event
 * type, and accompanied by structured metadata for later reconstruction.
 *
 * Uses the reasoning-trace tier (`memory_start_trace`,
 * `memory_record_step`, `memory_complete_trace`) so each cascade
 * lands as a `ReasoningTrace` with linked `ReasoningStep` nodes,
 * making cascades retrievable via Cypher for future Id-pipeline
 * context. Spoken utterances are also written to the conversation
 * tier via `memory_store_message`.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type {
  CascadeTrace,
  Commitment,
  Event,
  Stimulus,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";

/**
 * Persist every event in a cascade to the Agent Memory MCP server,
 * using the appropriate memory tier for each event:
 *
 *  - **Conversation tier** (`memory_store_message`): the triggering
 *    utterance (so it appears in the ghost's chat history) and any
 *    Surface `say` actions (so the ghost's outgoing speech does too).
 *  - **Reasoning tier** (`memory_start_trace` → `memory_record_step` →
 *    `memory_complete_trace`): everything cognitive — the Id's
 *    monologue / reflections, the Surface's actions as decisions with
 *    observations, and slider adjustments. These become
 *    `ReasoningTrace` and `ReasoningStep` nodes in the graph.
 *
 * Throws on the first tool failure rather than partially persisting.
 * Requires the **extended** profile (default in `connectMemory`).
 */
export async function persistCascade(client: Client, trace: CascadeTrace): Promise<void> {
  const trigger = trace.events[0];
  if (!trigger) {
    throw new Error("persistCascade: cascade has no events");
  }

  // 1. The trigger appears in the conversation tier when it's an
  //    incoming utterance (so it shows up in chat history).
  if (trigger.type === "EXTERNAL_STIMULUS" && trigger.stimulus.kind === "utterance") {
    await callOrThrow(client, "memory_store_message", {
      session_id: trace.ghostId,
      role: "user",
      content: `${trigger.stimulus.from}: ${trigger.stimulus.text}`,
      metadata: { event_id: trigger.id, event_type: trigger.type },
    });
  }

  // 2. Open a reasoning trace for this cascade.
  const task = describeTriggerAsTask(trigger);
  const startResult = await callOrThrow(client, "memory_start_trace", {
    session_id: trace.ghostId,
    task,
    metadata: {
      root_event_id: trigger.id,
      started_at: trace.startedAt,
      ghost_id: trace.ghostId,
    },
  });
  const traceId = extractTraceId(startResult);

  // 3. Each non-trigger event becomes a ReasoningStep.
  for (let i = 1; i < trace.events.length; i++) {
    const event = trace.events[i]!;
    await recordEventAsStep(client, traceId, trace.ghostId, event);
  }

  // 4. Close out the trace.
  await callOrThrow(client, "memory_complete_trace", {
    trace_id: traceId,
    outcome: summarizeOutcome(trace),
    success: true,
  });
}

/** Pull a trace id out of memory_start_trace's response, defensively. */
function extractTraceId(result: unknown): string {
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    for (const key of ["trace_id", "id", "traceId"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  throw new Error(`memory_start_trace returned no trace_id: ${JSON.stringify(result)}`);
}

function describeTriggerAsTask(trigger: Event): string {
  switch (trigger.type) {
    case "EXTERNAL_STIMULUS":
      return `respond to: ${formatStimulus(trigger.stimulus)}`;
    case "SURFACE_ACTION":
      return `reflect on own action: ${formatSurfaceAction(trigger.action)}`;
    case "ID_THOUGHT":
    case "ID_ADJUSTMENT":
      // These shouldn't be cascade triggers in practice, but the type
      // system allows them; describe defensively.
      return `process ${trigger.type.toLowerCase()}`;
    default:
      return unreachable(trigger);
  }
}

function summarizeOutcome(trace: CascadeTrace): string {
  const counts = { thoughts: 0, actions: 0, adjustments: 0, stimuli: 0 };
  for (const e of trace.events.slice(1)) {
    if (e.type === "ID_THOUGHT") counts.thoughts++;
    else if (e.type === "SURFACE_ACTION") counts.actions++;
    else if (e.type === "ID_ADJUSTMENT") counts.adjustments++;
    else if (e.type === "EXTERNAL_STIMULUS") counts.stimuli++;
  }
  return `cascade closed: ${counts.thoughts} thoughts, ${counts.actions} actions, ${counts.adjustments} adjustments`;
}

async function recordEventAsStep(
  client: Client,
  traceId: string,
  ghostId: string,
  event: Event,
): Promise<void> {
  switch (event.type) {
    case "ID_THOUGHT":
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        thought: event.thought.content,
      });
      return;
    case "SURFACE_ACTION": {
      const observation = event.outcome.ok
        ? "completed"
        : `denied: ${event.outcome.code}${event.outcome.reason ? ` (${event.outcome.reason})` : ""}`;
      // Split tool name from args — `kind` is the tool name and
      // shouldn't be duplicated inside `tool_args`. Persisting them as
      // separate structured fields means Cypher queries can filter by
      // `tool_name` directly instead of parsing a stringified action.
      const { kind: _kind, ...toolArgs } = event.action;
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        tool_name: event.action.kind,
        tool_args: toolArgs as Record<string, unknown>,
        tool_result: JSON.stringify(event.outcome),
        observation,
      });
      // Outgoing speech also goes to the conversation tier. The say
      // tool's MCP input schema names the spoken text `content`; older
      // SurfaceAction shapes used `text`. Accept either so we don't
      // crash on the shape transition.
      if (event.action.kind === "say" && event.outcome.ok) {
        const spoken =
          (event.action as { content?: unknown }).content ??
          (event.action as { text?: unknown }).text;
        if (typeof spoken === "string" && spoken.length > 0) {
          await callOrThrow(client, "memory_store_message", {
            session_id: ghostId,
            role: "assistant",
            content: spoken,
            metadata: { event_id: event.id, event_type: event.type },
          });
        }
      }
      return;
    }
    case "ID_ADJUSTMENT": {
      const a = event.adjustment;
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        thought: `nudge ${a.facet}.${a.axis} ${a.direction}`,
        observation: `${a.facet}.${a.axis}: ${a.beforeDisplay.toFixed(2)} → ${a.afterDisplay.toFixed(2)}`,
      });
      return;
    }
    case "EXTERNAL_STIMULUS": {
      // Mid-cascade stimuli (rare) are recorded as observations.
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        observation: formatStimulus(event.stimulus),
      });
      return;
    }
    default:
      unreachable(event);
  }
}

/**
 * Invoke an MCP tool and surface failures uniformly. Distinguishes:
 *  - protocol failures (`isError: true`)
 *  - in-band tool errors (e.g., `{"error": "..."}` in the JSON content)
 *  - successes (returns parsed JSON if available, else the raw result)
 */
export async function callOrThrow(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`MCP tool ${name} returned isError: ${JSON.stringify(result)}`);
  }
  const content = result.content as ReadonlyArray<{ type: string; text?: string }> | undefined;
  const first = content?.[0];
  if (first?.type === "text" && typeof first.text === "string") {
    try {
      const parsed = JSON.parse(first.text);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        throw new Error(
          `MCP tool ${name} reported in-band error: ${(parsed as { error: unknown }).error}`,
        );
      }
      return parsed;
    } catch (err) {
      // Not JSON; fall through and return raw result.
      if (err instanceof Error && err.message.startsWith("MCP tool ")) throw err;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Commitment ledger persistence
// ---------------------------------------------------------------------------

/**
 * Persist the result of one cascade's commitment evaluation. Opens a
 * dedicated short-lived trace per evaluation so that:
 *   - new commitments appear as ReasoningStep nodes with metadata
 *     `{ kind: "commitment.open", commitment_id, owed,
 *        recognizes_satisfaction, born_at_cascade }`
 *   - satisfactions appear as ReasoningStep nodes with metadata
 *     `{ kind: "commitment.satisfied", commitment_id }`
 *
 * Both are queryable in Cypher without scanning cascade traces. When
 * the evaluation produced nothing (no new, no satisfied), the call is
 * a no-op — we don't open an empty trace.
 */
export async function persistCommitmentEvaluation(
  client: Client,
  ghostId: string,
  cascadeIndex: number,
  satisfied: ReadonlyArray<{ id: string; owed: string }>,
  newCommitments: ReadonlyArray<Commitment>,
): Promise<void> {
  if (satisfied.length === 0 && newCommitments.length === 0) return;

  const startResult = await callOrThrow(client, "memory_start_trace", {
    session_id: ghostId,
    task: `commitment evaluation @ cascade ${cascadeIndex}`,
    metadata: {
      kind: "commitment_evaluation",
      cascade_index: cascadeIndex,
      ghost_id: ghostId,
    },
  });
  const traceId = extractTraceId(startResult);

  for (const s of satisfied) {
    await callOrThrow(client, "memory_record_step", {
      trace_id: traceId,
      observation: `commitment satisfied: "${s.owed}"`,
      tool_name: "commitment.satisfied",
      tool_args: { commitment_id: s.id, owed: s.owed },
    });
  }

  for (const c of newCommitments) {
    await callOrThrow(client, "memory_record_step", {
      trace_id: traceId,
      observation: `commitment opened: "${c.owed}"`,
      tool_name: "commitment.open",
      tool_args: {
        commitment_id: c.id,
        owed: c.owed,
        recognizes_satisfaction: c.recognizesSatisfaction,
        born_at_cascade: c.bornAtCascade,
      },
    });
  }

  await callOrThrow(client, "memory_complete_trace", {
    trace_id: traceId,
    outcome: `opened ${newCommitments.length}, satisfied ${satisfied.length}`,
    success: true,
  });
}

// ---------------------------------------------------------------------------
// Event → message mapping
// ---------------------------------------------------------------------------

function unreachable(value: never): never {
  throw new Error(`unreachable case: ${JSON.stringify(value)}`);
}


function formatStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return `${s.from}: ${s.text}`;
    case "cluster-entered":
      return `cluster entered: ${s.ghostIds.join(", ")}`;
    case "cluster-left":
      return `cluster left: ${s.ghostIds.join(", ")}`;
    case "mcguffin-in-view":
      return `${s.itemRef} in view at ${s.at}`;
    case "tile-entered":
      return `entered ${s.tileClass} at ${s.h3Index}`;
    case "idle":
      return `idle for ${Math.round(s.quietForMs / 1000)}s`;
    default:
      return unreachable(s);
  }
}

function formatSurfaceAction(a: SurfaceAction): string {
  // Known shapes get a friendly compact rendering; everything else
  // falls through to `<name> <json-args>` so new mini-game tools are
  // legible without needing to extend this file.
  switch (a.kind) {
    case "say": {
      const intent = (a as { intent?: unknown }).intent;
      const content =
        (a as { content?: unknown }).content ?? (a as { text?: unknown }).text;
      const intentTag = typeof intent === "string" && intent.length > 0 ? `[${intent}] ` : "";
      return `say: ${intentTag}${String(content ?? "")}`;
    }
    case "go":
      return `go ${String((a as { toward?: unknown }).toward ?? "")}`;
    case "take":
      return `take ${String((a as { itemRef?: unknown }).itemRef ?? "")}`;
    case "drop":
      return `drop ${String((a as { itemRef?: unknown }).itemRef ?? "")}`;
    case "inspect":
      return `inspect ${String((a as { itemRef?: unknown }).itemRef ?? "")}`;
    case "look":
      return `look ${String((a as { at?: unknown }).at ?? "")}`;
    case "exits":
    case "inventory":
    case "whoami":
    case "whereami":
    case "bye":
      return a.kind;
    default: {
      const { kind: _kind, ...args } = a;
      const argStr = Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : "";
      return `${a.kind}${argStr}`;
    }
  }
}

