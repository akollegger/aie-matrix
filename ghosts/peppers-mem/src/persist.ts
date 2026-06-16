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
export async function persistCascade(
  client: Client,
  trace: CascadeTrace,
  cascadeIndex?: number,
): Promise<void> {
  const trigger = trace.events[0];
  if (!trigger) {
    throw new Error("persistCascade: cascade has no events");
  }

  // 1. The trigger appears in the conversation tier when it's an
  //    incoming utterance (so it shows up in chat history). We tag
  //    the speaker into metadata so dialogue-with-a-specific-ghost
  //    queries don't have to parse the formatted content string.
  if (trigger.type === "EXTERNAL_STIMULUS" && trigger.stimulus.kind === "utterance") {
    await callOrThrow(client, "memory_store_message", {
      session_id: trace.ghostId,
      role: "user",
      content: `${trigger.stimulus.from}: ${trigger.stimulus.text}`,
      metadata: {
        event_id: trigger.id,
        event_type: trigger.type,
        from_display_name: trigger.stimulus.from,
        cascade_index: cascadeIndex ?? null,
      },
    });
  }

  // 2. Open a reasoning trace for this cascade. cascade_index lets
  //    retrieval compute "X cascades ago" as a hard integer rather
  //    than inferring from row position.
  const task = describeTriggerAsTask(trigger);
  const startResult = await callOrThrow(client, "memory_start_trace", {
    session_id: trace.ghostId,
    task,
    metadata: {
      root_event_id: trigger.id,
      started_at: trace.startedAt,
      ghost_id: trace.ghostId,
      cascade_index: cascadeIndex ?? null,
    },
  });
  const traceId = extractTraceId(startResult);

  // 3. Each non-trigger event becomes a ReasoningStep.
  for (let i = 1; i < trace.events.length; i++) {
    const event = trace.events[i]!;
    await recordEventAsStep(client, traceId, trace.ghostId, event, cascadeIndex);
  }

  // 4. Close out the trace. Success is computed from the actual
  //    action outcomes recorded on this cascade — `true` iff every
  //    SURFACE_ACTION event landed with `outcome.ok === true`. The
  //    outcome string describes WHAT was done and which (if any)
  //    failed, so future consolidation/Skill distillation passes
  //    can distinguish clean-exit cascades from troubled ones.
  const { success, outcome } = computeTraceOutcome(trace);
  await callOrThrow(client, "memory_complete_trace", {
    trace_id: traceId,
    outcome,
    success,
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

/**
 * Compute the trace's success flag and human-readable outcome string
 * from the actual action events captured in the cascade. Used by
 * `persistCascade` to write meaningful `memory_complete_trace` data
 * — the previous `success: true` hardcoding has been retired.
 *
 *   - `success` is `true` iff every SURFACE_ACTION on the cascade
 *     landed with `outcome.ok === true`. A cascade with zero actions
 *     (recall-only, pure speech that failed deliver, etc.) is still
 *     counted as success — there was nothing to fail.
 *   - `outcome` lists action kinds in order, marking any failed step
 *     with `(denied)` / `(failed)` so future consolidation passes can
 *     read the chain at a glance.
 */
function computeTraceOutcome(trace: CascadeTrace): {
  success: boolean;
  outcome: string;
} {
  const parts: string[] = [];
  let success = true;
  for (const e of trace.events.slice(1)) {
    if (e.type !== "SURFACE_ACTION") continue;
    const kind = (e.action as { kind?: unknown }).kind;
    const name = typeof kind === "string" ? kind : "action";
    if (e.outcome.ok === true) {
      parts.push(name);
    } else {
      success = false;
      const code = (e.outcome as { code?: unknown }).code;
      const marker = typeof code === "string" ? `(${code})` : "(failed)";
      parts.push(`${name} ${marker}`);
    }
  }
  if (parts.length === 0) {
    return { success: true, outcome: "cascade closed: no surface action" };
  }
  return {
    success,
    outcome: `cascade closed: ${parts.join(", ")}`,
  };
}

async function recordEventAsStep(
  client: Client,
  traceId: string,
  ghostId: string,
  event: Event,
  cascadeIndex?: number,
): Promise<void> {
  switch (event.type) {
    case "ID_THOUGHT":
      await callOrThrow(client, "memory_record_step", {
        trace_id: traceId,
        thought: event.thought.content,
      });
      return;
    case "SURFACE_ACTION": {
      // The Agent-Memory MCP only persists `thought`/`observation` on a step
      // (NOT tool_name/tool_args/tool_result), so the meaningful record of
      // what happened — what was bought, for how much, how nourishing, what
      // was eaten — must live in `observation` or it never reaches memory
      // (and therefore never reaches consolidation or the death reflection).
      const observation = describeActionMemory(event.action, event.outcome);
      // Split tool name from args — `kind` is the tool name and shouldn't be
      // duplicated inside `tool_args`. (These are dropped by the current MCP
      // but kept for the capture log + a future tool-aware write surface.)
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
      // crash on the shape transition. We also tag the recipient and
      // cascade_index into metadata so dialogue retrieval can filter
      // by who-said-what-to-whom-when without parsing tool_args.
      if (event.action.kind === "say" && event.outcome.ok) {
        const spoken =
          (event.action as { content?: unknown }).content ??
          (event.action as { text?: unknown }).text;
        if (typeof spoken === "string" && spoken.length > 0) {
          const toGhostId = (event.action as { to?: unknown }).to;
          await callOrThrow(client, "memory_store_message", {
            session_id: ghostId,
            role: "assistant",
            content: spoken,
            metadata: {
              event_id: event.id,
              event_type: event.type,
              to_ghost_id: typeof toGhostId === "string" ? toGhostId : null,
              cascade_index: cascadeIndex ?? null,
            },
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
      // Mid-cascade incoming utterances also go to the conversation
      // tier, tagged with the speaker, so dialogue history queries
      // see them symmetrically with trigger-utterances above.
      if (event.stimulus.kind === "utterance") {
        await callOrThrow(client, "memory_store_message", {
          session_id: ghostId,
          role: "user",
          content: `${event.stimulus.from}: ${event.stimulus.text}`,
          metadata: {
            event_id: event.id,
            event_type: event.type,
            from_display_name: event.stimulus.from,
            cascade_index: cascadeIndex ?? null,
          },
        });
      }
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

/** One spatial observation of another ghost, ready for persistence as a
 *  Fact triple. The observer / cascade index come from the caller. */
export interface ImpressionWrite {
  readonly observedGhostId: string;
  readonly observedDisplayName: string;
  readonly snippet: string;
}

/**
 * Persist this cascade's per-occupant impressions as `:Fact` nodes via
 * `memory_add_fact`. Each impression is one fact:
 *
 *   subject = observed ghost's display name
 *   predicate = "was_observed"
 *   object = the spatial snippet
 *   metadata = { observer_id, observed_ghost_id, cascade_index }
 *
 * Display name is the subject so a future Cypher query reads naturally
 * ("facts about Romantic Brown Sheep"); ghost id lives in metadata so
 * retrieval can filter precisely without ambiguity when display names
 * collide. Each fact carries `valid_from` so chronology survives even
 * when cascade_index isn't usable.
 *
 * Note: Agent Memory's `memory_add_fact` triggers embedding generation
 * per call. For ~3 impressions per cascade per ghost this is acceptable;
 * if it ever becomes hot, the right fix is a thin custom node type — but
 * that requires Agent Memory to expose a write tool that skips
 * embedding, or APOC, or both.
 */
export async function persistImpressions(
  client: Client,
  observerGhostId: string,
  impressions: ReadonlyArray<ImpressionWrite>,
  cascadeIndex: number,
): Promise<void> {
  if (impressions.length === 0) return;
  const validFrom = new Date().toISOString();
  for (const imp of impressions) {
    await callOrThrow(client, "memory_add_fact", {
      subject: imp.observedDisplayName,
      predicate: "was_observed",
      object_value: imp.snippet,
      confidence: 1.0,
      valid_from: validFrom,
      metadata: {
        kind: "impression",
        observer_id: observerGhostId,
        observed_ghost_id: imp.observedGhostId,
        observed_display_name: imp.observedDisplayName,
        cascade_index: cascadeIndex,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Event → message mapping
// ---------------------------------------------------------------------------

function unreachable(value: never): never {
  throw new Error(`unreachable case: ${JSON.stringify(value)}`);
}


/**
 * Exported as the canonical stimulus→text rendering for anything that
 * must live in the SAME lexical space as ReasoningTrace.task (which is
 * built from this function via `describeTriggerAsTask`). The sleep
 * pipeline's cascade-time skill matching embeds this exact text —
 * using agent-v2's Id-prompt variant instead cost lab run 4 every
 * match ("Food appears at here" vs trace "Food in view at here").
 */
export function formatStimulus(s: Stimulus): string {
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
    case "primal":
      return `primal ${s.need} ${s.direction} (urgency ${s.urgency.toFixed(2)})`;
    default:
      return unreachable(s);
  }
}

/**
 * Render one action + its world outcome into a plain-language memory line —
 * the durable record of what the ghost actually DID and what came of it. The
 * world result (`paid`, `nourishment`, `consumed`, `itemRef`, …) rides on
 * `outcome` (the run-loop now passes the structured result through), so the
 * purchase/consume/energy detail is preserved here. This is what lands in the
 * `:ReasoningStep.observation` the MCP persists — and what consolidation then
 * folds into the self-narrative.
 */
function describeActionMemory(action: SurfaceAction, outcome: { ok: boolean } & Record<string, unknown>): string {
  const o = outcome as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const arg = (k: string): unknown => (action as unknown as Record<string, unknown>)[k];
  if (outcome.ok !== true) {
    const code = str(o["code"]) ?? "failed";
    const reason = str(o["reason"]);
    return `tried to ${formatSurfaceAction(action)} but ${code}${reason ? `: ${reason}` : ""}`;
  }
  switch (action.kind) {
    case "request": {
      // Buy from a vendor — world returns { purchased, vendor, itemRef, paid, nourishment }.
      if (o["purchased"] === true) {
        const item = str(o["itemRef"]) ?? str(arg("want_resource")) ?? "food";
        const paid = num(o["paid"]);
        const nour = str(o["nourishment"]);
        return `bought ${item}${paid !== null ? ` for ${paid} gold` : ""} from ${str(o["vendor"]) ?? "a vendor"}${nour ? ` — ${nour}` : ""}`;
      }
      return `requested ${str(arg("want_resource")) ?? "a trade"}`;
    }
    case "consume": {
      const item = str(o["itemRef"]) ?? str(arg("itemRef")) ?? "something";
      const nour = str(o["nourishment"]);
      return `ate ${item}${nour ? ` — ${nour}` : ""}`;
    }
    case "nearest": {
      const cls = str(arg("itemClass")) ?? "something";
      const dir = str(o["bearing"]) ?? str(o["toward"]) ?? str(o["at"]);
      return dir ? `found nearest ${cls} toward ${dir}` : `looked for the nearest ${cls}`;
    }
    default:
      // go / look / take / drop / inspect / … already render cleanly.
      return formatSurfaceAction(action);
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

