/**
 * Surface reasoning: renders the ghost's spoken line in response to a stimulus.
 *
 * The Surface reads the EXTERNAL slider — the ghost's outward self — translated
 * to felt vocabulary at this boundary so the LLM never sees raw numbers. This
 * is genuinely who the ghost is outwardly; it is NOT a performance or a mask.
 * The Id reads the INTERNAL slider (felt disposition) and drives behaviour;
 * when the outward self and the inner disposition diverge, that divergence is
 * REAL — surfaced by the commitment evaluator — not the Surface play-acting.
 */

import {
  STARTER_FACETS,
  type CommitmentLedger,
  type NeedProfile,
  type PersonalityState,
  type PrimalDrive,
  type Stimulus,
  type SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import { renderItemsHereLine } from "./cognition/world-props.js";
import { scrubRawGhostIds } from "./runtime/name-resolver.js";
import {
  hasFacetData,
  resolveFacetExpression,
} from "./reason-id-facets-resolver.js";
import type {
  ActionDigestEntry,
  DialogueTurn,
  ImpressionView,
  MemoryClient,
} from "@aie-matrix/ghost-peppers-mem";
import { fetchRecentConversation } from "@aie-matrix/ghost-peppers-mem";

import { renderViaSdk } from "./cognition/surface-sdk.js";

import {
  chatToolsStatefulLoop,
  isStaleResponseIdError,
  type ToolSchema,
} from "./llm-client.js";
import {
  surfaceTemperature,
  surfaceTokenCap,
} from "./cognition/need-gating.js";
// `feltDurationFromGap` / `unknownFeltDuration` are no longer used
// here after Step 6 retired the Memory timeline block. They remain
// the boundary-translation primitives — now consumed by the recall
// tool executors in `memory-tools.ts`.
import {
  executeAgentMemoryTool,
  getAgentMemoryToolSchemas,
} from "./cognition/sdk-tools/memory-mcp-tools.js";

/**
 * Lightweight snapshot of what the ghost can perceive *right now* in
 * the world. Used to ground the Surface's action choice in reality —
 * e.g., listing valid `go` directions so the LLM doesn't blindly pick
 * an exit that doesn't exist.
 */
export interface WorldContext {
  /** Compass tokens (n/s/ne/nw/se/sw) the ghost can `go` toward. */
  readonly availableExits?: ReadonlyArray<string>;
  /** Item refs the ghost can `take` from the current tile. The
   *  string is the item's class (`Food`, `Bench`, `Mural`, …). */
  readonly takeableItemRefs?: ReadonlyArray<string>;
  /** Same items as `takeableItemRefs`, with the world's reported
   *  per-object `name` attached. Aligned by index. Used by the
   *  prompt-builder to render `Name — Description` via the
   *  `world-props` catalog instead of the bare class. */
  readonly takeableItemsHere?: ReadonlyArray<{
    readonly class: string;
    readonly name: string | null;
  }>;
  /** Other ghosts present on the current tile, by display name.
   *  Used for the human-readable "Ghosts nearby" prompt line. */
  readonly nearbyGhostIds?: ReadonlyArray<string>;
  /** Same set as `nearbyGhostIds`, but preserves the (ghostId, displayName)
   *  pairing the memory retrieval helpers need. Outgoing dialogue is
   *  filtered by recipient ghostId; incoming is filtered by speaker
   *  display name. */
  readonly nearbyGhosts?: ReadonlyArray<{
    readonly ghostId: string;
    readonly displayName: string;
  }>;
  /** One spatial observation per cluster occupant, computed by the
   *  snapshot aggregator from the look-here / look-around / exits
   *  responses. These are the CURRENT cascade's impressions; the
   *  run-loop persists them so they appear in future cascades' Memory
   *  timeline as historical impressions of each ghost. */
  readonly impressions?: ReadonlyArray<{
    readonly observedGhostId: string;
    readonly observedDisplayName: string;
    /** Free-text spatial snippet — "here on a Blue tile" or
     *  "to the n of you, on a Wall tile, Crumbs on the tile". */
    readonly snippet: string;
  }>;
  /** Item refs the ghost is currently carrying. */
  readonly inventoryItemRefs?: ReadonlyArray<string>;
  /** Subset of inventory items that still hold consumable energy
   *  (tokens). Surfaced separately so the ghost knows they're carrying
   *  something that could be eaten themselves OR dropped for another
   *  ghost. Empty / omitted when nothing carriable-with-energy. */
  readonly inventoryConsumables?: ReadonlyArray<{
    readonly itemRef: string;
    readonly tokens: number;
  }>;
  /**
   * Whether the world-api considers this ghost to be in conversational
   * mode. While true, `go` is rejected with `IN_CONVERSATION` — the
   * ghost must `bye` before moving.
   */
  readonly inConversationalMode?: boolean;
  /**
   * Number of consecutive cascades since the last `say`, with no
   * incoming utterance. Helps the Surface decide when a conversation
   * has died and it's time to `bye` and move on.
   */
  readonly turnsSinceLastSayWithNoReply?: number;
  /**
   * Bounded "social anchor" countdown. When a new ghost enters the
   * cluster, we set this to a small N. While > 0, the Surface should
   * stay still (so the other ghost has time to engage and so the
   * speaker's say lands in a still-valid cluster). Decrements each
   * cascade; reaches 0 → free to move.
   */
  readonly socialAnchorTurnsLeft?: number;
  /**
   * IMPETUS: number of consecutive cascades the ghost has chosen `say`.
   * Resets on any non-`say` action. Surfaced into the prompt as a
   * rising urgency to leave conversation and act on the standing plan —
   * the structural fix for "agree to go somewhere, then talk about
   * going there forever". The prompt uses thresholds; this value is
   * the raw counter.
   */
  readonly consecutiveSayTurns?: number;
  /**
   * Pre-computed bearings to known points of interest. Saves the LLM
   * a tool call (one cascade) when it has a destination in mind. Each
   * bearing is the result of `nearest` for a single target spec.
   */
  readonly bearings?: ReadonlyArray<{
    readonly label: string;
    readonly distance: number;
    /** "here" when distance === 0, otherwise a compass token. */
    readonly direction: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw";
  }>;
}

export interface InvokeSurfaceRequest {
  /** Stable per-ghost id. Step 5 keys the server-side Responses-API
   *  thread by this. The first call for a ghostId sends instructions
   *  (system prompt); subsequent calls reference the prior response_id
   *  and only send the delta. */
  readonly ghostId: string;
  readonly monologue: string;
  readonly stimulus: Stimulus;
  readonly worldContext?: WorldContext;
  /** What this ghost is in the world to do. Shapes the action choice. */
  readonly objective?: string;
  /** This ghost's persistent name (e.g. "Django Decypher"). Threaded
   *  into the user prompt as the self-identity anchor so the model
   *  never reaches for a routing UUID — there's only the name. */
  readonly selfDisplayName?: string;
  /** The authoritative tool menu, discovered at startup via
   *  GhostMcpClient.listTools(). The LLM picks from this — there is
   *  NO hardcoded action list in the prompt. New tools (mini-games,
   *  future world primitives) become available to the agent the
   *  moment they're registered on the server. */
  readonly tools: ReadonlyArray<ToolSchema>;
  /** Open self-debts. Rendered in the prompt as "Debts to yourself"
   *  so the Surface biases tool choice toward whatever pays down the
   *  oldest commitment. Empty/omitted ledger emits nothing. */
  readonly commitments?: CommitmentLedger;
  /** Active primal drive (the body's call). When present, competes
   *  with the surface objective for the Surface's tool choice. At
   *  high urgency, the drive should win. Null when all needs are in
   *  the healthy band. */
  readonly primalDrive?: PrimalDrive | null;
  /** Accumulated metabolic strain from chronic overeating. The
   *  substrate mechanically tracks this independently of streaks. We
   *  surface it as a felt experience to the Surface so the LLM can
   *  *perceive* the consequence and optionally choose differently —
   *  but the mechanic enforces the harm whether or not the Surface
   *  responds. 0 = no strain; ~30 = imminent metabolic collapse. */
  readonly metabolicStrain?: number;
  /** Absolute cascade counter for the running ghost. Combined with the
   *  cascade indices on each `recentDialogue` turn / `recentActions`
   *  entry, the Surface can render concrete gaps ("3 cascades ago",
   *  "silent for 4 cascades since") rather than fuzzy "recently". */
  readonly currentCascadeIndex?: number;
  /** Last N dialogue turns per nearby ghost (keyed by ghostId).
   *  An empty array for a present cluster occupant is meaningful —
   *  it tells the Surface "you've never spoken with this ghost." */
  readonly recentDialogue?: ReadonlyMap<string, ReadonlyArray<DialogueTurn>>;
  /** Last N actions the Surface itself took, oldest first. Surfaces
   *  "I just tried X and it was denied" so the LLM doesn't repeat the
   *  same losing move. */
  readonly recentActions?: ReadonlyArray<ActionDigestEntry>;
  /** Most recent spatial impression of each nearby ghost (keyed by
   *  ghostId). Written each cascade by `persistImpressions` from the
   *  snapshot aggregator; carries its own cascadeIndex so the renderer
   *  can show the gap. */
  readonly clusterImpressions?: ReadonlyMap<string, ImpressionView>;
  /** Full personality state. The Surface reads the EXTERNAL axis of
   *  each facet — the performed/projected face — translated to felt
   *  vocabulary in the prompt. The INTERNAL axis (the felt state) is
   *  the Id's purview. */
  readonly personality?: PersonalityState;
  /** Felt-vocabulary description of memory truncation, when the
   *  substrate's memory gate (Step 4) shrunk the horizon. Rendered as
   *  a "Memory feels:" line so the LLM perceives the truncation as
   *  felt experience rather than as missing data. */
  readonly memoryFog?: string;
  /** Memory client used by the Step-6 pull-tools. Required; the
   *  Surface tool menu always includes the recall_* tools. */
  readonly memoryClient: MemoryClient;
  /** Current need profile — needed by the pull-tools so the Step-4
   *  gate can fog/truncate recall results in real time. */
  readonly needs: NeedProfile;
  /** Display-name → ghostId map for ghosts the running ghost knows
   *  by name. Built by the run-loop from worldContext.nearbyGhosts
   *  (v1) and, eventually, from a persistent `:Acquaintance` set. */
  readonly knownGhosts: ReadonlyMap<string, string>;
}

export interface SurfaceReasoning {
  /** Whatever tool the LLM picked from the live MCP menu. `kind` is
   *  the tool name; the remaining properties are the tool's arguments.
   *  No curated action union — any tool the server exposes is fair
   *  game. */
  readonly action: SurfaceAction;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  /** Dynamic user-prompt text. */
  readonly userPrompt: string;
  /** Raw assistant response text. */
  readonly raw: string;
}

// ---- Step 8: voice-only Surface ----
//
// After Step 8 the Surface is invoked ONLY when the Id's action is
// `say_intent` — its job is to translate the intent into actual text
// in the ghost's voice. World action selection moved to the Id.
// Stateful per-ghost speech thread (Step 5 mechanism) persists across
// speech cascades so the ghost's voice has continuity; silent
// cascades simply don't extend the thread.

export interface SurfaceRenderRequest {
  /** Stable per-ghost id — keys the speech thread. */
  readonly ghostId: string;
  readonly selfDisplayName?: string;
  /** The ghost's objective — context for register choice. */
  readonly objective?: string;
  /** The Id's inner monologue. CURRENTLY NOT THREADED through to the
   *  voice render — the Surface derives its voice from the character
   *  (external sliders) + the conversation thread + the intent. The
   *  monologue is the Id's private working state. Kept on the
   *  request type as an optional backup so we can revert if voicing
   *  loses too much specificity without it. */
  readonly monologue?: string;
  /** Optional addressee (display name) — the Id's hint, or the run-loop's pick
   *  from who's present. The Surface speaks to whoever the conversation implies;
   *  this just routes the `say`. */
  readonly to?: string;
  /** World snapshot — for grounding ("the wet stone smell" etc.). */
  readonly worldContext?: WorldContext;
  /** Memory access for recall_* pull-tools. */
  readonly memoryClient: MemoryClient;
  readonly needs: NeedProfile;
  readonly knownGhosts: ReadonlyMap<string, string>;
  readonly currentCascadeIndex: number;
  /** External slider readings (Step 3) — the outward self. */
  readonly personality?: PersonalityState;
  /** Top-2 facets to render in the performed-face block. When set,
   *  only these facets contribute their archetype + character
   *  anchors. When undefined / empty, all 8 facets are rendered
   *  (legacy fallback). */
  readonly activeExternalFacets?: ReadonlyArray<import("@aie-matrix/ghost-peppers-inner").FacetName>;
  /** RFC-0031: a painting the ghost is looking at — fed to the Surface as a
   *  multimodal part so SPEECH reacts to what it sees, on the external face,
   *  independently of how the Id (internal) behaves toward the same painting. */
  readonly imageUrl?: string;
  /** Inbound peer messages to inject into the Surface's stateful
   *  thread as user-role items, BEFORE the render prompt. This is
   *  what makes the thread into an actual conversation — the
   *  Surface model sees what its peer said, replies in context. The
   *  caller (voice_surface tool) is responsible for not double-
   *  injecting the same line within one cascade. */
  readonly priorPeerLines?: ReadonlyArray<string>;
}

export interface SurfaceRenderResult {
  /** The actual sentence(s) the ghost says. */
  readonly text: string;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly userPrompt: string;
  readonly raw: string;
}

/** Tool name that exits the speech-render loop with the rendered text. */
const COMMIT_SPEECH_TOOL = "commit_speech";
const COMMIT_SPEECH_SCHEMA: ToolSchema = {
  name: COMMIT_SPEECH_TOOL,
  description:
    "Submit the actual sentence(s) the ghost says. Call this exactly once when you've decided on the words.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The actual sentence the ghost says, in their voice.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

/**
 * Spoken-line model. The speech stage is identity-sensitive (it must hold
 * the ghost's own name + the addressee's) but LOW VOLUME, so it can run on
 * a slightly more capable model than the cost-dominant Id without material
 * cost. `PEPPERS_SPEECH_MODEL` pins it; unset → the call's DEFAULT_MODEL.
 */
const SPEECH_MODEL = process.env.PEPPERS_SPEECH_MODEL || undefined;

/**
 * Surface execution route. `sdk` (default) = Agents SDK + bounded client-side
 * conversation thread (short-term voice memory that persists through
 * OpenRouter). `responses` = legacy OpenAI Responses server thread
 * (`previous_response_id`) — kept for direct-OpenAI deployments where it works
 * natively. See `cognition/surface-sdk.ts`.
 */
const SURFACE_ROUTE = (process.env.PEPPERS_SURFACE_ROUTE || "sdk").toLowerCase();

/**
 * Render speech for a `say_intent` action. Returns the actual text
 * the ghost should say. Uses the Surface's stateful per-ghost speech
 * thread for voice continuity (Step 5) and the recall pull-tools
 * (Step 6) so the model can ground phrasing in remembered context.
 */
export async function renderSurfaceSpeech(
  req: SurfaceRenderRequest,
): Promise<SurfaceRenderResult> {
  const sections: string[] = [];
  if (req.objective !== undefined && req.objective.length > 0) {
    sections.push(`Objective (context for tone): ${req.objective}`);
  }
  // The Id's monologue is intentionally NOT threaded into the Surface
  // prompt. Voice derives from the character (external sliders) + the
  // conversation thread + the intent. To revert, restore:
  //   if (req.monologue) sections.push(`Felt now: ${req.monologue}`);
  if (
    req.to !== undefined &&
    req.to.length > 0 &&
    req.to !== req.selfDisplayName
  ) {
    sections.push(
      req.selfDisplayName
        ? `You are speaking TO ${req.to}. ${req.to} is the other ghost — not you. You remain ${req.selfDisplayName}; never call yourself ${req.to}.`
        : `You are speaking to ${req.to}.`,
    );
  }
  sections.push("You're speaking this turn. Say what you genuinely would right now — shaped by how you're coming across and the conversation in front of you. You choose what to say; there is no script.");
  const outerSelf = renderOuterSelf(req.personality, req.activeExternalFacets);
  if (outerSelf !== null) sections.push(outerSelf);
  if (req.worldContext) {
    const ctx = req.worldContext;
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
    if (itemsLine !== null) {
      wlines.push(itemsLine);
    }
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
  // Conversation memory — the actual recent dialogue with the ghosts present,
  // read straight from the graph's conversation tier (`fetchRecentDialogueWith`
  // over the un-consolidated `:Message` window; sleep consolidation relabels
  // older turns to `:ConsolidatedMessage`, so this naturally bounds). This is
  // the Surface's short-term conversation memory: the real transcript, not a
  // local cache or a render-machinery thread. Deliberately NO "don't
  // re-introduce" instruction — the model sees what was actually said and
  // continues from it; the absence of a transcript is itself the "we haven't
  // met" signal.
  try {
    const turns = await fetchRecentConversation(req.memoryClient, req.ghostId, 14);
    const lines = turns.map((t) =>
      t.by === "self" ? `you: ${t.text.slice(0, 200)}` : t.text.slice(0, 220),
    );
    if (lines.length > 0) {
      sections.push(`What you've said and heard recently (oldest first):\n  ${lines.join("\n  ")}`);
    }
    console.info(
      `[surface-conv] ${req.ghostId.slice(0, 8)} transcript_turns=${lines.length}`,
    );
  } catch (err) {
    console.warn(`[surface] conversation read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  sections.push("Render the actual sentence and submit it via commit_speech.");
  const userPrompt = scrubRawGhostIds(sections.join("\n\n"));

  // Raw passthrough of the agent-memory MCP surface — same set the
  // Id sees, but the Surface speaks to it via chatToolsStatefulLoop's
  // recall-callback path rather than the @openai/agents SDK.
  const agentMemoryTools = await getAgentMemoryToolSchemas(req.memoryClient);
  const tools: ReadonlyArray<ToolSchema> = [
    COMMIT_SPEECH_SCHEMA,
    ...agentMemoryTools,
  ];
  const memoryToolNames: ReadonlySet<string> = new Set(
    agentMemoryTools.map((t) => t.name),
  );
  const runRecall = (name: string, args: Record<string, unknown>) =>
    executeAgentMemoryTool(req.memoryClient, name, args);

  const instructions = buildSurfaceSystemPrompt(req.selfDisplayName);
  const prior = surfaceThreadByGhost.get(req.ghostId);
  // Close out the previous cascade's commit_speech call with a
  // synthetic "(delivered)" output so the thread is in a valid
  // state for the next user turn. Otherwise the Responses API
  // rejects continuation.
  const pendingFunctionCallOutput =
    prior !== undefined
      ? { callId: prior.pendingCallId, output: "(delivered)" }
      : undefined;
  const priorPeerLines = req.priorPeerLines && req.priorPeerLines.length > 0
    ? req.priorPeerLines
    : undefined;
  // Fuel-distance-shaped Surface call parameters. The token cap is
  // a gentle linear glide with an 80-token floor (enough for a
  // fragmentary sentence) — a starving ghost should still talk,
  // just terser. Temperature ramps the opposite way: 0.7 at the
  // setpoint, up to 1.5 at the far edge of the distance band,
  // turning controlled speech into jagged erratic speech under
  // bodily stress.
  const surfaceMaxTokens = surfaceTokenCap(req.needs);
  const surfaceTemp = surfaceTemperature(req.needs);

  // Route selection. `sdk` (default) drives the Agents SDK with a bounded
  // client-side conversation thread — short-term voice memory that actually
  // persists through OpenRouter. `responses` keeps the legacy server-side
  // Responses thread (`previous_response_id`) for anyone running directly on
  // OpenAI, where it persists natively. Same prompt + tools either way; only
  // the execution + memory mechanism differ.
  if (SURFACE_ROUTE === "sdk") {
    const sdk = await renderViaSdk({
      ghostId: req.ghostId,
      instructions,
      userPrompt,
      agentMemoryToolSchemas: agentMemoryTools,
      memoryClient: req.memoryClient,
      ...(priorPeerLines !== undefined ? { priorPeerLines } : {}),
      ...(req.imageUrl !== undefined ? { imageUrl: req.imageUrl } : {}),
      ...(SPEECH_MODEL ? { speechModel: SPEECH_MODEL } : {}),
      // Fuel-scaled temperature — normal when fed, wild when starving. Without
      // this the SDK route ran at the model default and the lever did nothing.
      temperature: surfaceTemp,
    });
    // Mirror the exchange into the durable conversation tier is handled by
    // persistCascade (run-loop); the bounded SDK thread is the voice cache.
    return { text: sdk.text, usage: sdk.usage, userPrompt, raw: sdk.raw };
  }

  let resp;
  try {
    resp = await chatToolsStatefulLoop({
      // Identity instructions sent EVERY turn (not just the first) — the
      // Responses thread alone can't be trusted to carry them on OpenRouter.
      instructions,
      ...(prior !== undefined
        ? { previousResponseId: prior.responseId }
        : {}),
      input: userPrompt,
      tools,
      recallToolNames: memoryToolNames,
      runRecall,
      maxTokens: surfaceMaxTokens,
      temperature: surfaceTemp,
      ...(SPEECH_MODEL ? { model: SPEECH_MODEL } : {}),
      ...(req.imageUrl !== undefined ? { imageUrl: req.imageUrl } : {}),
      ...(pendingFunctionCallOutput !== undefined
        ? { pendingFunctionCallOutput }
        : {}),
      ...(priorPeerLines !== undefined
        ? { priorUserMessages: priorPeerLines }
        : {}),
    });
  } catch (err) {
    if (prior !== undefined && isStaleResponseIdError(err)) {
      surfaceThreadByGhost.delete(req.ghostId);
      resp = await chatToolsStatefulLoop({
        instructions,
        input: userPrompt,
        tools,
        recallToolNames: memoryToolNames,
        runRecall,
        maxTokens: surfaceMaxTokens,
        temperature: surfaceTemp,
        ...(SPEECH_MODEL ? { model: SPEECH_MODEL } : {}),
        ...(req.imageUrl !== undefined ? { imageUrl: req.imageUrl } : {}),
        ...(priorPeerLines !== undefined
          ? { priorUserMessages: priorPeerLines }
          : {}),
      });
    } else {
      throw err;
    }
  }
  surfaceThreadByGhost.set(req.ghostId, {
    responseId: resp.responseId,
    pendingCallId: resp.pendingCallId,
  });
  if (resp.toolCall.name !== COMMIT_SPEECH_TOOL) {
    throw new Error(
      `Surface speech-render expected ${COMMIT_SPEECH_TOOL}, got ${resp.toolCall.name}`,
    );
  }
  const text = typeof resp.toolCall.arguments["text"] === "string"
    ? (resp.toolCall.arguments["text"] as string)
    : "";
  // Record this exchange (inbound peer line(s) + our reply) so the next
  // turn sees the history and stops re-introducing. Explicit buffer because
  // the Responses thread can't be trusted to carry it on OpenRouter.
  {
    const buf = dialogueByGhost.get(req.ghostId) ?? [];
    for (const inbound of priorPeerLines ?? []) buf.push(inbound);
    if (text.trim().length > 0) buf.push(`You said: ${text.trim()}`);
    while (buf.length > 6) buf.shift();
    dialogueByGhost.set(req.ghostId, buf);
  }
  return {
    text,
    usage: resp.usage,
    userPrompt,
    raw: resp.raw,
  };
}

/**
 * Static portion of the Surface's system prompt — the rules and voice
 * register. Identity (who this ghost IS) is prepended per-ghost by
 * `buildSurfaceSystemPrompt` so the LLM sees "You are <Name>" exactly
 * once per call, in the system message, never re-stated in the user
 * prompt.
 */
const SURFACE_RULES_PROMPT = `You are this character. You are in a conversation. Call commit_speech({text}) when you have your line.`;

/**
 * Build the full Surface system prompt: identity (when known) + rules.
 *
 * Identity lives in the system message — set once per call by the
 * orchestrator, never restated in the user prompt. This is what the
 * earlier user-prompt anchor (line 258 in v1) used to do; moving it
 * here removes the priming pressure that was making agents keep
 * introducing themselves in their spoken output.
 *
 * When `displayName` is undefined (test paths, anonymous spawns) we
 * fall back to the rules-only prompt so the behaviour matches v1.
 */
export function buildSurfaceSystemPrompt(displayName?: string): string {
  if (!displayName) return SURFACE_RULES_PROMPT;
  const identity =
    `You are ${displayName}. That is your only name. ` +
    `You have no other identifier — no UUID, no ghost_<hash> handle. ` +
    `When you speak about yourself, you are ${displayName}.\n\n`;
  return identity + SURFACE_RULES_PROMPT;
}

/** Back-compat alias for callers that still import the constant
 *  (e.g., run-house.ts's verbose system-prompt logger). Equivalent to
 *  the rules-only build — verbose output sees the static block, not a
 *  particular ghost's identity. */
export const SURFACE_SYSTEM_PROMPT = SURFACE_RULES_PROMPT;

// Step 8 retired the action-picking Surface. The legacy `invokeSurface`
// body has been removed; its types (`InvokeSurfaceRequest`,
// `SurfaceReasoning`) remain exported because run-loop still uses
// `SurfaceReasoning` for the speech-trace shape on RunRecord.

// ---- Per-ghost Responses-API thread cache (Step 5) ----

/**
 * Per-ghost server-side Responses-API thread state. Each entry holds:
 *   - `responseId` for `previous_response_id` on the next call
 *   - `pendingCallId` for the previous commit_speech tool call that
 *     still needs a function_call_output to close out the thread
 * Reincarnation is handled at the registry layer (new ghostId per
 * new life), so we don't need to GC stale entries here — they're
 * orphaned naturally.
 */
interface SurfaceThreadState {
  readonly responseId: string;
  readonly pendingCallId: string;
}

const surfaceThreadByGhost = new Map<string, SurfaceThreadState>();

/**
 * Per-ghost recent-dialogue buffer (last few lines, both sides). The
 * Responses-API thread (previous_response_id) is meant to carry this, but
 * OpenRouter does not reliably maintain thread state for non-OpenAI models,
 * so without an explicit buffer the speech model re-introduces itself every
 * turn ("Hello, I'm Dario" on a loop). Kept SEPARATE from the thread cache
 * so it survives stale-thread resets. Capped to the last 6 lines.
 */
const dialogueByGhost = new Map<string, string[]>();

/** Drop the cached thread state for a ghost. */
export function resetSurfaceThread(ghostId: string): void {
  surfaceThreadByGhost.delete(ghostId);
}

/** Test/debug — current cached response_id for a ghost. */
export function peekSurfaceResponseId(ghostId: string): string | undefined {
  return surfaceThreadByGhost.get(ghostId)?.responseId;
}

// Legacy `callSurfaceModel` removed — `renderSurfaceSpeech` does its
// own thread management directly via `surfaceThreadByGhost`.

// Step 6: `renderMemoryTimeline` + its helpers (formatDialogueHeader,
// formatDialogueTurn, relativeCascade, lastTurnIndex) have been
// retired. Memory is now pulled via the recall_* tools defined in
// `memory-tools.ts`; the felt-vocabulary rendering lives inside each
// tool's executor, with the Step-4 gate fogging results inline.

/**
 * Render who the ghost IS right now, per facet, from the external slider — the
 * outward self. This is NOT a performance or a mask: the Surface genuinely is
 * this self and speaks as it. (The divergence from the Id's internal disposition
 * is real behaviour, surfaced by the commitment evaluator — not the Surface
 * "putting on a face".) The same authored archetype data the Id's facet-agent
 * reads, expressed as the ghost's own self:
 *   - the outward-summary + character anchors (named characters the LLM has
 *     rich training-corpus associations for — the tone-of-voice signal),
 *   - the COMPOUND archetype name + description when this corner has one
 *     authored ("Walter White", "manic pixie", etc.).
 *
 * Numbers stop at the substrate boundary as ever; the model sees archetype
 * prose, not band labels, not raw display values. Unauthored facets fall back
 * to a minimal summary line so each facet still has something concrete.
 */
function renderOuterSelf(
  personality?: PersonalityState,
  activeFacets?: ReadonlyArray<import("@aie-matrix/ghost-peppers-inner").FacetName>,
): string | null {
  if (!personality) return null;
  // Only the facets the run-loop selected (by prior-cascade movement
  // on the external axis) get to express. When the gate is empty,
  // fall back to all 8 — that's the legacy behaviour and keeps
  // first-cascade renders sane while the slider-movement gate
  // hasn't gathered any signal yet.
  const facets =
    activeFacets && activeFacets.length > 0 ? activeFacets : STARTER_FACETS;
  const lines: string[] = [];
  lines.push("Who you are right now:");
  for (const facet of facets) {
    lines.push("");
    if (!hasFacetData(facet)) {
      lines.push(`${facet}: no anchor yet — just be plain on this one.`);
      continue;
    }
    const r = resolveFacetExpression(facet, personality);
    const c = r.compoundArchetype;
    // Literal-template render — Stage 6. When the corner has been
    // migrated (trait + anchor + outward + inward all present),
    // emit four short sentences in role-play voice. Otherwise fall
    // back to the legacy directive paragraph until the data lands.
    if (
      c !== null &&
      c.trait !== undefined &&
      c.anchor !== undefined &&
      c.outward !== undefined &&
      c.inward !== undefined
    ) {
      const framing =
        c.literal === false
          ? `Metaphorically, you are like ${c.trait}.`
          : `You are ${c.trait}.`;
      lines.push(
        `${facet}: ${framing} Think ${c.anchor}. You ${c.outward}. ${c.inward}.`,
      );
      continue;
    }
    if (c !== null && c.name !== undefined && c.description !== undefined) {
      lines.push(`${facet}: You're like ${c.name}. ${c.description}`);
      continue;
    }
    // No compound at this corner — fall back to the projected summary.
    lines.push(`${facet}: You're like ${r.projectedSummary}.`);
  }
  return lines.join("\n");
}

export function formatStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return s.intent === undefined
        ? `${s.from} says: "${s.text}"`
        : `${s.from} [intent: ${s.intent}] says: "${s.text}"`;
    case "cluster-entered":
      return `Other ghosts entered the cluster: ${s.ghostIds.join(", ")}`;
    case "cluster-left":
      return `Other ghosts left the cluster: ${s.ghostIds.join(", ")}`;
    case "mcguffin-in-view":
      return `${s.itemRef} is in view at ${s.at}`;
    case "tile-entered":
      return `Stepped onto a ${s.tileClass} tile.`;
    case "idle":
      return `(quiet for ${Math.round(s.quietForMs / 1000)}s — nothing new outside. Choose a verb that gets you living again — typically "go" toward a direction.)`;
    case "primal":
      return `(quiet for ${Math.round(s.quietForMs / 1000)}s — your body asserts itself: ${s.drive})`;
  }
}
