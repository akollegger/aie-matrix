/**
 * Per-cascade shared context passed to the Agents SDK via
 * `run(agent, input, { context })`. Every SDK tool gets this
 * object through `RunContext<CascadeContext>.context`.
 *
 * What used to be ad-hoc threading of args into our hand-rolled
 * tool-loop becomes a single typed bag. Tools mutate the
 * `captured*` arrays as side effects; the action stage reads
 * them out after `run()` returns.
 */

import type {
  FacetName,
  NeedProfile,
  PersonalityState,
  PrimalDrive,
  Stimulus,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import type { MemoryClient } from "@aie-matrix/ghost-peppers-mem";

import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { WorldContext } from "../reason-surface.js";

export interface CapturedRecall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly output: string;
}

export interface CapturedAction {
  readonly action: SurfaceAction;
  /** Outcome string returned from the world MCP, normalised for the
   *  capture log. */
  readonly outcome: string;
  /** True only if the world reported success. */
  readonly ok: boolean;
  /** The raw, unstringified world result — energy fields and all
   *  (`consumed`, `itemRef`, `remaining`, …). The substrate's needs
   *  crediting reads this; `outcome` is truncated for logging and must
   *  NOT be relied on for those fields. Undefined on world error. */
  readonly result?: unknown;
}

export interface CapturedHandoff {
  readonly from: string;
  readonly to: string;
  /** Fork-join delegation fields (handoffs → isolated workers).
   *  Present on delegate_* tool invocations; absent on legacy SDK
   *  handoffs. */
  readonly task?: string;
  /** First ~300 chars of the worker's report (the Id receives the
   *  full report as the tool result). */
  readonly report?: string;
  readonly ms?: number;
  readonly workerModel?: string;
}

export interface CascadeContext {
  // --- Identity / static config ---
  readonly ghostId: string;
  readonly selfDisplayName: string | undefined;
  readonly objective: string | undefined;

  // --- Live cascade state (read-only to tools) ---
  readonly mcp: GhostMcpClient;
  readonly memoryClient: MemoryClient;
  readonly needs: NeedProfile;
  readonly knownGhosts: ReadonlyMap<string, string>;
  readonly currentCascadeIndex: number;
  readonly worldContext: WorldContext | undefined;
  readonly personality: PersonalityState;
  readonly primalDrive: PrimalDrive | null;

  // --- Id-pipeline outputs available to voice ---
  readonly monologue: string;
  readonly superObjective: string;
  readonly impulse: string;

  // --- THE CONVERSATION ---
  // The cascade's stimulus — when it's an utterance, voice_surface
  // injects "<from> said: '<text>'" as a user-role message into the
  // Surface's Responses-API thread (and the Id's thread is fed it
  // upstream by `invokeIdAction`). This is the missing piece that
  // makes the Surface's stateful thread an actual conversation, not
  // a one-sided journal of past renders.
  readonly stimulus: Stimulus;

  // --- ACTIVE-FACETS GATE ---
  // The top-2 facets the Surface should render on its external axis
  // this cascade — picked by the run-loop from prior-cascade slider
  // movement. Null means "render everything" (legacy fallback).
  readonly activeExternalFacets: ReadonlyArray<FacetName> | null;

  // RFC-0031: a painting the ghost looked at last cascade. The Id reacts to it
  // as behaviour (internal); voice_surface passes it to the Surface so SPEECH
  // reacts to it on the external face — the two independently. Null when none.
  readonly pendingImageUrl: string | null;

  // --- Per-cascade "have we already injected the peer line into
  // each model's thread this cascade?" guards. Mutable. Read+set by
  // SDK tools. The Id sets `injectedToIdThread` when it builds its
  // initial run() input; voice_surface sets `injectedToSurfaceThread`
  // on the first speech render of the cascade so subsequent
  // voice_surface calls within the same cascade don't double-inject.
  injectedToIdThread: boolean;
  injectedToSurfaceThread: boolean;

  // The Id's single speech GATE for this cascade. The `speak` tool sets this
  // true (idempotent — the Id grants permission, it does not produce words).
  // After the Id run, if true, the run-loop runs the Surface ONCE to generate
  // the actual utterance from its own external sliders + the conversation.
  speakRequested: boolean;
  /** Optional addressee the Id hinted at when granting speech. The Surface is
   *  free to ignore it and pick its own from the conversation it sees. */
  speakAddressee: string | null;

  // --- Side-effect capture (mutated by tool execute callbacks) ---
  readonly capturedActions: CapturedAction[];
  readonly capturedRecalls: CapturedRecall[];
  readonly capturedHandoffs: CapturedHandoff[];
}

/** Build a fresh CascadeContext for one `run(idAgent, …)` invocation. */
export function newCascadeContext(
  args: Omit<
    CascadeContext,
    | "capturedActions"
    | "capturedRecalls"
    | "capturedHandoffs"
    | "injectedToIdThread"
    | "injectedToSurfaceThread"
    | "speakRequested"
    | "speakAddressee"
  >,
): CascadeContext {
  return {
    ...args,
    capturedActions: [],
    capturedRecalls: [],
    capturedHandoffs: [],
    injectedToIdThread: false,
    injectedToSurfaceThread: false,
    speakRequested: false,
    speakAddressee: null,
  } as CascadeContext;
}

/**
 * Render an incoming utterance stimulus as the user-role line we
 * want to inject into a model's thread. Format mirrors what a
 * "straight chat" looks like — the peer's name as speaker and their
 * literal text in quotes — so the Responses-API thread reads as a
 * conversation, not as a series of substrate prompts.
 *
 * Returns null when the stimulus isn't an utterance (idle / look /
 * tile-entered / cluster-entered / etc.) — those don't carry peer
 * speech and so need no injection.
 */
export function inboundUtteranceLine(stimulus: import("@aie-matrix/ghost-peppers-inner").Stimulus): string | null {
  if (stimulus.kind !== "utterance") return null;
  const speaker = (stimulus as { from?: string }).from ?? "Someone";
  const text = (stimulus as { text?: string }).text ?? "";
  if (text.length === 0) return null;
  return `${speaker} said: "${text}"`;
}
