/**
 * Map a `CascadeTrace` from `peppers-inner` onto Agent Memory's MCP
 * tool surface. Every event in the trace becomes one message in the
 * ghost's session, tagged with a role string that identifies the event
 * type, and accompanied by structured metadata for later reconstruction.
 *
 * v1 uses only `memory_store_message` — the simplest mapping that
 * preserves causal ordering via timestamps and keeps the cascade
 * retrievable through `memory_get_context` and `memory_search`.
 * Richer mappings (entities for ghosts/McGuffins, fact triples for
 * adjustments) can layer on later without changing the call site.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type {
  CascadeTrace,
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
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        action: formatSurfaceAction(event.action),
        tool_name: event.action.kind,
        // tool_args is a dict (Pydantic), tool_result is a string. Cast
        // through Record<string, unknown> for the MCP layer.
        tool_args: event.action as unknown as Record<string, unknown>,
        tool_result: JSON.stringify(event.outcome),
        observation,
      });
      // Outgoing speech also goes to the conversation tier.
      if (event.action.kind === "say" && event.outcome.ok) {
        await callOrThrow(client, "memory_store_message", {
          session_id: ghostId,
          role: "assistant",
          content: event.action.text,
          metadata: { event_id: event.id, event_type: event.type },
        });
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
  switch (a.kind) {
    case "say":
      return `say: ${a.text}`;
    case "go":
      return `go ${a.toward}`;
    case "take":
      return `take ${a.itemRef}`;
    case "drop":
      return `drop ${a.itemRef}`;
    case "inspect":
      return `inspect ${a.itemRef}`;
    case "look":
      return `look ${a.at}`;
    case "exits":
      return "exits";
    case "inventory":
      return "inventory";
    case "whoami":
      return "whoami";
    case "whereami":
      return "whereami";
    case "bye":
      return "bye";
    default:
      return unreachable(a);
  }
}

