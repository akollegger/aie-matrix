/**
 * Id action stage — driven by the OpenAI Agents SDK.
 *
 * The roadmap's mechanical goal (`project_v2_surgical_roadmap`,
 * confirmed by [[project_sdk_handoff_regression]]): the Id is an
 * SDK Agent with tools and handoffs. Within one `run()` call the
 * model can make multiple tool calls and hand off to sub-agents,
 * producing a COMPOUND cascade — speak + act + recall — instead of
 * the old "one action per cascade" pattern.
 *
 * Per-ghost server-side conversation state lives in the Responses
 * API thread, threaded via `previousResponseId` between cascades.
 * Recall, voice, and world tools each capture their effects on the
 * shared `CascadeContext`, which the run-loop reads out for cascade
 * record / capture log.
 */

import { run, setTracingDisabled } from "@openai/agents";

// The SDK's tracing exports full agent runs (prompts, tool calls,
// monologues) to OpenAI's trace dashboard by default whenever an
// OpenAI key is present. Ghost cognition is not telemetry — and the
// stack now runs on OpenRouter. Off, unconditionally; the capture
// jsonl is our trace.
setTracingDisabled(true);

import type {
  NeedProfile,
  PersonalityState,
  PrimalDrive,
  Stimulus,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import type { MemoryClient } from "@aie-matrix/ghost-peppers-mem";
import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

import {
  inboundUtteranceLine,
  newCascadeContext,
  type CapturedAction,
  type CapturedHandoff,
  type CapturedRecall,
  type CascadeContext,
} from "./cognition/cascade-context.js";
import {
  isFallthroughError,
  resolveRoute,
  routerPolicy,
} from "@aie-matrix/ghost-peppers-router";

import {
  buildIdAgent,
  buildSubAgents,
  routedAgentModel,
} from "./cognition/sub-agents/index.js";
import {
  buildAgentMemoryTools,
  getAgentMemoryToolSchemas,
  getMemoryInventoryLine,
} from "./cognition/sdk-tools/memory-mcp-tools.js";
import { buildSpeakGateTool } from "./cognition/sdk-tools/speak-gate-tool.js";
import { scrubRawGhostIds } from "./runtime/name-resolver.js";
import { buildWorldTools } from "./cognition/sdk-tools/world-tools.js";
import { gateForNeeds } from "./cognition/need-gating.js";
import { renderItemsHereLine } from "./cognition/world-props.js";
import { DEFAULT_MODEL, VISION_MODEL, type ToolSchema } from "./llm-client.js";
import type { WorldContext } from "./reason-surface.js";

export interface IdActionRequest {
  readonly ghostId: string;
  readonly selfDisplayName?: string;
  readonly objective?: string;
  readonly monologue: string;
  readonly superObjective: string;
  readonly impulse: string;
  readonly tools: ReadonlyArray<ToolSchema>;
  readonly worldContext?: WorldContext;
  readonly memoryClient: MemoryClient;
  readonly mcp: GhostMcpClient;
  readonly needs: NeedProfile;
  readonly knownGhosts: ReadonlyMap<string, string>;
  readonly currentCascadeIndex: number;
  readonly personality: PersonalityState;
  readonly primalDrive?: PrimalDrive | null;
  /** The cascade's triggering stimulus. When it's an utterance, the
   *  peer's actual text is injected as a user-role message in the
   *  Id's Responses-API thread BEFORE the substrate prompt — making
   *  the thread an actual conversation, not a one-sided journal of
   *  paraphrased monologues. */
  readonly stimulus: Stimulus;
  /** Top-2 facets the Surface should render on the external axis.
   *  Threaded through the cascade context so voice_surface can pass
   *  it to `renderSurfaceSpeech` → `renderOuterSelf`. */
  readonly activeExternalFacets?: ReadonlyArray<import("@aie-matrix/ghost-peppers-inner").FacetName>;
  /** True when this ghost is mid-binge — the run-house has latched
   *  a high-Fuel episode and not yet seen Fuel fall back below the
   *  release threshold. `gateForNeeds` uses this to withdraw the
   *  feeding tools for the cascade. */
  readonly bingeActive?: boolean;
  /** Sleep-pipeline Skill match (Step D): full behavioural fragment
   *  of the matched procedure — the ghost's own distilled past
   *  pattern for this stimulus class. Injected as remembered
   *  know-how, never an override; the model still chooses. */
  readonly skillHint?: string;
  /** When set, the Id's run STREAMS: item events (tool calls, tool
   *  outputs, messages, worker forks) and output-text deltas are
   *  forwarded live as they happen — the observer-view feed. When
   *  absent, the run executes batch exactly as before. */
  readonly onRunEvent?: (ev: IdStreamEvent) => void;
  /** Self-narrative — woven into the Id agent's instructions as the
   *  ghost's own account of who it is. */
  readonly selfNarrative?: string;
  /** A single inherited word, passed BARE into the Id's instructions —
   *  no label, no framing, deliberately ambiguous. */
  readonly karmicWord?: string;
  /** Substrate push-recall: remembered exchanges with the speaking
   *  ghost, rendered into the action prompt. */
  readonly peerMemory?: string;
  /** A perception the ghost CHOSE to take last cascade and which can only
   *  land as actual model input this cascade (RFC-0031): a painting it looked
   *  at (`imageUrl` → a real multimodal image part) and/or a card it read
   *  (`pageText` → the page's text). Unframed — the picture/text is fed as-is.
   *  When an image is present, this cascade routes to the vision model. */
  readonly pendingPerception?: {
    readonly imageUrl?: string;
    readonly pageText?: string;
    readonly pageUrl?: string;
  };
}

/** Compact live event for observer views (overlay SSE). */
export interface IdStreamEvent {
  /** "tool_called" | "tool_output" | "message" | "reasoning" | "text_delta" | other item names */
  readonly type: string;
  /** Tool name where applicable (e.g. "go", "delegate_curiosity"). */
  readonly name?: string;
  /** Short human-readable head of args / output / text. */
  readonly detail?: string;
}

export interface IdActionResult {
  /** Every world action the SDK loop fired during this cascade,
   *  in execution order. May be empty if the loop ended without an
   *  action; may be many if the model composed (speak + go + eat). */
  readonly actions: ReadonlyArray<CapturedAction>;
  /** Every recall the model pulled, in order. */
  readonly recalls: ReadonlyArray<CapturedRecall>;
  /** Handoff trace (currently best-effort — the SDK doesn't expose
   *  a direct handoff event stream we hook here yet). */
  readonly handoffs: ReadonlyArray<CapturedHandoff>;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly userPrompt: string;
  readonly raw: string;
  /** The Id's speech gate this cascade: did it call `speak`? If so, the
   *  run-loop runs the Surface ONCE afterwards to compose the utterance. */
  readonly speakRequested: boolean;
  /** Optional addressee the Id hinted at; the Surface may use or ignore it. */
  readonly speakAddressee: string | null;
}

// ---- Per-ghost CLIENT-SIDE thread (was: OpenAI Responses-API
// `previousResponseId`). Client-side history is provider-independent —
// the Id can run on OpenRouter (chat completions) and even fall
// through to a different model MID-LIFE without losing its thread,
// which server-side state could never do.
//
// History is stored as SEGMENTS (one per cascade) so trimming never
// orphans a tool_call/tool_result pair across the boundary: we drop
// whole oldest cascades. The cap is a mechanical context bound; the
// ghost's real long-term memory lives in Neo4j, and Coherence already
// gates how much *recalled* history the Id sees — this cap is just
// the working-thread horizon. ----

type ThreadItem = Parameters<typeof run>[1] extends infer I
  ? I extends ReadonlyArray<infer T>
    ? T
    : never
  : never;

interface IdThreadState {
  readonly segments: ThreadItem[][];
}

const MAX_THREAD_SEGMENTS = 12;
const idThreadByGhost = new Map<string, IdThreadState>();
// Route-head bookkeeping — announce the Id's serving model once and on
// every change, not per cascade.
let announcedLeadModel: string | null = null;

export function resetIdThread(ghostId: string): void {
  idThreadByGhost.delete(ghostId);
}

// ---- Build the agent graph (per-cascade — cheap; the SDK Agent
// constructor is just metadata). Tool wrappers close over the world's
// schema list (which is stable per cascade), so we rebuild fresh.
// Future micro-opt: cache by `req.tools` identity. ----

function buildAgentGraph(
  worldTools: ReadonlyArray<ToolSchema>,
  agentMemoryTools: ReadonlyArray<ToolSchema>,
  workerModel: import("./cognition/sub-agents/index.js").WorkerModel,
  workerLabel: string,
  leadModel: import("./cognition/sub-agents/index.js").WorkerModel,
  selfNarrative?: string,
  karmicWord?: string,
) {
  const worldSdkTools = buildWorldTools(worldTools);
  const memorySdkTools = buildAgentMemoryTools(agentMemoryTools);
  const speakGate = buildSpeakGateTool();
  const allTools = [...worldSdkTools, ...memorySdkTools, speakGate];
  const subAgents = buildSubAgents(allTools, workerModel);
  const idAgent = buildIdAgent(allTools, subAgents, workerLabel, leadModel, selfNarrative, karmicWord);
  return { idAgent };
}

// ---- Entry point ----

export async function invokeIdAction(req: IdActionRequest): Promise<IdActionResult> {
  // C: substrate threads a one-line memory inventory into the prompt
  // so the model knows the corpus shape before deciding whether to
  // look anything up. Cached for several cascades so it's cheap.
  const memoryInventory = await getMemoryInventoryLine(
    req.memoryClient,
    req.ghostId,
    req.currentCascadeIndex,
  );
  const userPrompt = buildUserPrompt(req, memoryInventory);
  const cascade: CascadeContext = newCascadeContext({
    ghostId: req.ghostId,
    selfDisplayName: req.selfDisplayName,
    objective: req.objective,
    mcp: req.mcp,
    memoryClient: req.memoryClient,
    needs: req.needs,
    knownGhosts: req.knownGhosts,
    currentCascadeIndex: req.currentCascadeIndex,
    worldContext: req.worldContext,
    personality: req.personality,
    primalDrive: req.primalDrive ?? null,
    monologue: req.monologue,
    superObjective: req.superObjective,
    impulse: req.impulse,
    stimulus: req.stimulus,
    activeExternalFacets: req.activeExternalFacets ?? null,
    pendingImageUrl: req.pendingPerception?.imageUrl ?? null,
  });

  // Build this cascade's NEW input items. When the cascade was
  // triggered by an utterance, the peer's actual text goes in FIRST
  // as a user-role message — that's what makes the Id's thread a real
  // conversation instead of a stream of paraphrased substrate
  // prompts. The substrate prompt (monologue + super-obj + impulse +
  // world snapshot) comes after as the "thought you should act on"
  // framing.
  const peerLine = inboundUtteranceLine(req.stimulus);
  const baseItems =
    peerLine !== null
      ? [
          { role: "user" as const, content: peerLine },
          { role: "user" as const, content: userPrompt },
        ]
      : [{ role: "user" as const, content: userPrompt }];
  // RFC-0031: art the ghost engaged last cascade enters the Id HERE — the
  // INTERNAL vehicle — so it drives BEHAVIOUR (move toward, linger, recoil) per
  // the ghost's internal disposition. The painting is a real image part; the
  // card is its placard text. The Surface receives the same image separately
  // and speaks from the external face — the two reacting independently is the
  // internal/external nuance. The picture is fed as-is, no instruction.
  const pp = req.pendingPerception;
  const perceptionItems: Array<{ role: "user"; content: unknown }> = [];
  if (pp?.pageText) {
    perceptionItems.push({ role: "user", content: `You read the card beside a painting:\n${pp.pageText}` });
  }
  if (pp?.imageUrl) {
    perceptionItems.push({
      role: "user",
      content: [
        { type: "input_text", text: "You are looking at this painting." },
        { type: "input_image", image: pp.imageUrl },
      ],
    });
  }
  const newItems = [...perceptionItems, ...baseItems] as ThreadItem[];
  if (pp?.imageUrl || pp?.pageText) {
    console.info(
      `[peppers-art] ${req.selfDisplayName ?? req.ghostId} (Id) takes in art` +
        `${pp.imageUrl ? " (painting → vision model → behaviour)" : ""}${pp.pageText ? " (card text)" : ""}`,
    );
  }
  if (peerLine !== null) {
    cascade.injectedToIdThread = true;
  }

  // Need-gated tool menu. A starving ghost's affordance list narrows
  // to the corporeal essentials; a ghost mid-binge episode loses
  // the feeding tools until the body has digested. Everything in
  // the healthy band with no active episode sees the full menu.
  const gating = gateForNeeds(req.tools, req.needs, {
    bingeActive: req.bingeActive === true,
  });
  if (gating.note !== null) {
    console.info(`[peppers-id-action] ${req.selfDisplayName ?? req.ghostId}: ${gating.note}`);
  }
  // Agent-memory tools: raw passthrough of the neo4j-agent-memory MCP
  // surface (search, store, facts, entities, relations, raw Cypher).
  // Discovered once per ghost session via cached listTools.
  const agentMemoryTools = await getAgentMemoryToolSchemas(req.memoryClient);

  // Router-resolved lead: the Id (and its fork-join workers) run on
  // the same candidate, falling through the chain on transport/JSON
  // failures. The chain ends on the OpenAI default, so a fully-down
  // OpenRouter degrades to pre-router behaviour. Client-side history
  // makes mid-life model switches safe — the thread travels with us.
  // The Id action stage drives a multi-turn tool-loop — it must lead on a
  // capable model (DEFAULT_MODEL / Haiku) that converges within the turn
  // budget. Free models thrash to max-turns here (and max-turns is not a
  // fall-through trigger). Bulk cascade calls and fork-join workers stay on
  // the free-leaning chain; only this stage gets the capable lead.
  // PEPPERS_ID_MODEL pins the Id's capable lead independently of the bulk
  // chain and the fallback (DEFAULT_MODEL). Lets us trade the Id model
  // (the cost-dominant agentic stage) without touching bulk/worker routing.
  // A cascade carrying a painting routes the Id to the vision model so it can
  // actually see what it's reacting to; text-only cascades are unaffected.
  const idLeadModel = req.pendingPerception?.imageUrl
    ? VISION_MODEL
    : (process.env.PEPPERS_ID_MODEL ?? DEFAULT_MODEL);
  const candidates = await resolveRoute("bulk", DEFAULT_MODEL, [idLeadModel]);
  const priorSegments = idThreadByGhost.get(req.ghostId)?.segments ?? [];
  const priorItems = priorSegments.flat();

  let result;
  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const leadModel = routedAgentModel(c);
    const { idAgent } = buildAgentGraph(
      gating.tools,
      agentMemoryTools,
      leadModel,
      c.model,
      leadModel,
      req.selfNarrative,
      req.karmicWord,
    );
    if (routerPolicy() !== "off" && announcedLeadModel !== c.model) {
      announcedLeadModel = c.model;
      console.info(`[peppers-router] id → ${c.source} ${c.model}`);
    }
    const actionsBefore = cascade.capturedActions.length;
    try {
      if (req.onRunEvent !== undefined) {
        // Streamed run — forward compact live events to the observer
        // sink while the run progresses, then settle on the same
        // result surface (history/finalOutput) the batch path uses.
        const streamed = await run(idAgent, [...priorItems, ...newItems], {
          context: cascade,
          maxTurns: 20,
          stream: true,
        });
        for await (const ev of streamed) {
          const compact = compactStreamEvent(ev);
          if (compact !== null) req.onRunEvent(compact);
        }
        await streamed.completed;
        result = streamed;
      } else {
        result = await run(idAgent, [...priorItems, ...newItems], {
          context: cascade,
          maxTurns: 20,
        });
      }
      break;
    } catch (err) {
      lastErr = err;
      result = undefined;
      const actedAlready = cascade.capturedActions.length > actionsBefore;
      const maxTurnsExceeded =
        err instanceof Error && /max turns/i.test(err.message);
      // Cheaper/weaker models sometimes invent a tool name the Id doesn't
      // have ("Tool rest not found in agent Id") — the SDK escalates this to
      // a fatal ModelBehaviorError. Treat it like max-turns: a salvageable
      // model-behaviour outcome, not a transport failure.
      const badToolCall =
        err instanceof Error && /tool .+ not found/i.test(err.message);
      // Salvage: the run ended badly (turn cap, or a hallucinated tool), but
      // the world tools it DID call already executed — they're in
      // cascade.capturedActions, with real side effects. Discarding the
      // cascade would throw away genuine actions, and re-running on another
      // model would replay them. So we never fall through here; instead we
      // keep what was captured, persist the partial thread for continuity,
      // and end the cascade gracefully. The ghost acted — it just didn't
      // formally "finish".
      if (maxTurnsExceeded || badToolCall) {
        const reason = maxTurnsExceeded ? "max-turns" : "bad-tool-call";
        const state = (err as { state?: { history?: ThreadItem[] } }).state;
        const fullHistory = (state?.history ??
          [...priorItems, ...newItems]) as ThreadItem[];
        const newSegment = fullHistory.slice(priorItems.length);
        const segments = [...priorSegments, newSegment];
        while (segments.length > MAX_THREAD_SEGMENTS) segments.shift();
        idThreadByGhost.set(req.ghostId, { segments });
        console.warn(
          `[peppers-id-action] ${req.selfDisplayName ?? req.ghostId}: ${reason} — salvaged ${cascade.capturedActions.length} action(s), ${cascade.capturedHandoffs.length} delegation(s)`,
        );
        return {
          actions: cascade.capturedActions,
          recalls: cascade.capturedRecalls,
          handoffs: cascade.capturedHandoffs,
          usage: null,
          userPrompt,
          raw: `salvaged:${reason}`,
          speakRequested: cascade.speakRequested,
          speakAddressee: cascade.speakAddressee,
        };
      }
      // Fall-through is only safe while this attempt has NOT acted in the
      // world — re-running a partially executed cascade on the next model
      // would replay its side effects.
      const isLast = i === candidates.length - 1;
      if (isLast || actedAlready || !isFallthroughError(err)) {
        throw err;
      }
      console.warn(
        `[peppers-router] id ${c.model} failed (${err instanceof Error ? err.message.slice(0, 80) : err}) — falling through to ${candidates[i + 1]!.model}`,
      );
    }
  }
  if (result === undefined) {
    throw lastErr ?? new Error("id run: no candidates succeeded");
  }

  // Persist this cascade as one thread segment; trim whole oldest
  // cascades beyond the horizon so tool_call/result pairs never split.
  const fullHistory = (result.history ?? []) as ThreadItem[];
  const newSegment = fullHistory.slice(priorItems.length);
  const segments = [...priorSegments, newSegment];
  while (segments.length > MAX_THREAD_SEGMENTS) segments.shift();
  idThreadByGhost.set(req.ghostId, { segments });

  // Surface the cascade-context captures. The SDK's `result.history`
  // also has the items, but the typed CapturedAction shape is what
  // run-loop/capture-log already consumes.
  return {
    actions: cascade.capturedActions,
    recalls: cascade.capturedRecalls,
    handoffs: cascade.capturedHandoffs,
    usage: extractUsage(result),
    userPrompt,
    raw: stringifyResult(result),
    speakRequested: cascade.speakRequested,
    speakAddressee: cascade.speakAddressee,
  };
}

/**
 * Legacy single-action accessor — picks the LAST world action the
 * cascade emitted (the "exit action") for callers that still expect
 * one. Returns null when the cascade produced no world actions
 * (recall-only or pure-speech-no-deliver-failures).
 */
export function lastAction(result: IdActionResult): SurfaceAction | null {
  if (result.actions.length === 0) return null;
  return result.actions[result.actions.length - 1]!.action;
}

function buildUserPrompt(req: IdActionRequest, memoryInventory: string): string {
  const sections: string[] = [];
  if (req.objective !== undefined && req.objective.length > 0) {
    sections.push(`Objective (the thing you exist to do):\n${req.objective}`);
  }
  // The Id drives BEHAVIOUR from the structured internal state — the
  // slider-derived super-objective (emotional flavour) + the primal impulse —
  // NOT the prose monologue. The old peppers leaned on the monologue and it
  // spat meaningless poetics; the monologue is now the Id's PRIVATE felt state
  // (it still feeds the commitment/lying evaluator), not an action driver. To
  // revert: sections.push(`Inner monologue (the felt now): ${req.monologue}`);
  sections.push(
    `Super-objective (the emotional flavor coloring how you pursue things): ${req.superObjective}`,
  );
  sections.push(`Impulse (the primal pull toward an action): ${req.impulse}`);
  sections.push(`Memory right now: ${memoryInventory}`);
  if (req.skillHint !== undefined && req.skillHint.length > 0) {
    sections.push(`Remembered know-how (surfaced from your own consolidated past):\n${req.skillHint}`);
  }
  if (req.peerMemory !== undefined && req.peerMemory.length > 0) {
    sections.push(req.peerMemory);
  }
  const ctx = req.worldContext;
  if (ctx) {
    const wlines: string[] = [];
    if (ctx.availableExits && ctx.availableExits.length > 0) {
      wlines.push(`exits: ${ctx.availableExits.join(", ")}`);
    } else if (ctx.availableExits) {
      wlines.push("exits: none");
    }
    if (ctx.nearbyGhostIds && ctx.nearbyGhostIds.length > 0) {
      wlines.push(`others present: ${ctx.nearbyGhostIds.join(", ")}`);
    }
    const itemsLine = renderItemsHereLine(ctx.takeableItemRefs, ctx.takeableItemsHere);
    if (itemsLine !== null) wlines.push(itemsLine);
    if (ctx.inventoryItemRefs && ctx.inventoryItemRefs.length > 0) {
      wlines.push(`carrying: ${ctx.inventoryItemRefs.join(", ")}`);
    }
    if (ctx.bearings && ctx.bearings.length > 0) {
      const sorted = [...ctx.bearings].sort((a, b) => a.distance - b.distance);
      for (const b of sorted) {
        wlines.push(
          b.distance === 0
            ? `bearing — ${b.label}: HERE`
            : `bearing — ${b.label}: ${b.direction} (${b.distance} hex${b.distance === 1 ? "" : "es"} away)`,
        );
      }
    }
    if (wlines.length > 0) sections.push(`World now:\n  ${wlines.join("\n  ")}`);
  }
  // Consideration step — the planning anchor that makes the SDK's
  // plan-then-act loop actually fire. Without this the model treats
  // the prompt above as a decision-ready package and skips memory
  // entirely; with it, the model reaches for `memory_search` /
  // `memory_get_context` before committing to an action. A/B/C
  // tested 2026-06-05 — this variant produced 4× the call rate of
  // the baseline and was the only one that produced reads at all.
  sections.push(
    "Before you act: review the memory tools listed for you. Check whether anything in memory could inform this turn — a name you might recognise, a topic you've discussed, an action you've already tried. If yes, pull it up first. If not, proceed with the action.",
  );
  return scrubRawGhostIds(sections.join("\n\n"));
}

/**
 * Reduce an SDK stream event to a small observer-safe payload, or
 * null to drop it. Defensive throughout — item shapes vary by event
 * and we never let a malformed event break the run.
 */
function compactStreamEvent(ev: unknown): IdStreamEvent | null {
  try {
    const e = ev as {
      type?: string;
      name?: string;
      item?: { rawItem?: Record<string, unknown> };
      data?: { type?: string; delta?: unknown };
    };
    if (e.type === "run_item_stream_event") {
      const raw = e.item?.rawItem ?? {};
      const name =
        typeof raw["name"] === "string" ? (raw["name"] as string) : undefined;
      let detail: string | undefined;
      const args = raw["arguments"];
      if (typeof args === "string" && args.length > 0) detail = args.slice(0, 160);
      const output = raw["output"] as { text?: unknown } | string | undefined;
      if (detail === undefined) {
        if (typeof output === "string") detail = output.slice(0, 160);
        else if (output && typeof output.text === "string") detail = output.text.slice(0, 160);
      }
      if (detail === undefined) {
        const content = raw["content"];
        if (Array.isArray(content)) {
          const text = content.find(
            (c) => typeof (c as { text?: unknown })?.text === "string",
          ) as { text?: string } | undefined;
          if (text?.text) detail = text.text.slice(0, 160);
        }
      }
      return {
        type: e.name ?? "item",
        ...(name !== undefined ? { name } : {}),
        ...(detail !== undefined ? { detail } : {}),
      };
    }
    if (
      e.type === "raw_model_stream_event" &&
      e.data?.type === "output_text_delta" &&
      typeof e.data.delta === "string" &&
      e.data.delta.length > 0
    ) {
      return { type: "text_delta", detail: e.data.delta };
    }
    return null;
  } catch {
    return null;
  }
}

function extractUsage(
  result: unknown,
): { prompt: number; completion: number; total: number } | null {
  // RunResult doesn't expose a top-level usage in v0.11; this is
  // best-effort: dig into state if shape allows, else null.
  const r = result as { state?: { usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } } };
  const u = r.state?.usage;
  if (!u) return null;
  return {
    prompt: u.inputTokens ?? 0,
    completion: u.outputTokens ?? 0,
    total: u.totalTokens ?? 0,
  };
}

function stringifyResult(result: unknown): string {
  try {
    const r = result as { finalOutput?: unknown; lastResponseId?: string };
    return JSON.stringify({
      finalOutput: r.finalOutput,
      lastResponseId: r.lastResponseId,
    }).slice(0, 4000);
  } catch {
    return "";
  }
}
