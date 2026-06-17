/**
 * Top-level live ghost orchestrator.
 *
 * Registers with the running combined server, adopts one ghost,
 * connects to the world-api MCP, and drives a bounded stimulus loop:
 * each tick polls the world, runs a cascade if there's something to
 * react to, executes the Surface action against the real world.
 *
 * Stops on Ctrl+C, on max-stimuli-reached, or when the optional
 * AbortSignal is aborted (e.g. from the A2A cancelTask path).
 */


import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

import {
  adjustNeed,
  incrementNeedTolerance,
  midpointNeeds,
  midpointPersonality,
  samplePersonality,
  selectPrimalDrive,
  STARTER_FACETS,
  STARTER_NEEDS,
  toDisplay,
  type ActionOutcome,
  type NeedProfile,
  type PersonalityState,
  type Stimulus,
} from "@aie-matrix/ghost-peppers-inner";

import {
  connectMemory,
  formatStimulusForTrace,
  type MemoryConnection,
} from "@aie-matrix/ghost-peppers-mem";

import { SkillRecall } from "./cognition/skill-recall.js";
import { captureRecord } from "./debug-capture.js";
import type { OverlayServer } from "./overlay-server.js";
import { ID_SYSTEM_PROMPT } from "./reason-id.js";
import { METABOLIC_STRAIN_DEATH_THRESHOLD, runOneStimulus } from "./run-loop.js";
import {
  prefetchDisplayName,
  primeDisplayName,
  resolveDisplayNameSync,
} from "./runtime/name-resolver.js";
import { SURFACE_SYSTEM_PROMPT, type WorldContext } from "./reason-surface.js";
import { reflectOnDeath } from "./cognition/death-reflection.js";
import {
  loadKarmicLessonFromEnv,
  loadAllNarrativesFromEnv,
  runBlackout,
} from "@aie-matrix/ghost-peppers-sleep";
import {
  adoptUnderHouse,
  emptyStimulusContext,
  executeViaMcp,
  pollNextStimulus,
  registerAndAdopt,
  type AdoptedGhost,
  type StimulusContext,
} from "./runtime/index.js";

export interface RunHouseOptions {
  readonly registryBase: string;
  /** Neo4j creds for the local-dev (stdio uvx) memory path. Optional
   *  when `memoryServiceUrl` is set (production SSE service path). */
  readonly memoryConnection?: MemoryConnection;
  /** SSE endpoint of the shared agent-memory service. When set, memory
   *  connects over SSE and `memoryConnection` is unused (production). */
  readonly memoryServiceUrl?: string;
  /** Wall-time between polls when nothing happened. Default 1500 ms. */
  readonly idleTickMs?: number;
  /** Cap on how many stimuli will be processed before exit. Default 40. */
  readonly maxStimuli?: number;
  /**
   * After this many consecutive ticks with no external stimulus, the
   * loop generates an `idle` stimulus to keep the ghost living. Default 3.
   */
  readonly idleStimulusEveryK?: number;
  /**
   * Optional birth personality. Default: midpoint. Pass a seed to vary
   * starting personality across runs.
   */
  readonly initialPersonality?: PersonalityState;
  /**
   * Starting primal-need profile. Default: every need at midpoint 5
   * (satiated). Pass the previously-evolved state to survive
   * pause/resume cycles — without this, a ghost that was nearly
   * starving before a Barnacle handoff would come back satiated.
   */
  readonly initialNeeds?: NeedProfile;
  /**
   * Callback fired after every cascade with the post-depletion +
   * post-replenishment need profile. The caller (typically the
   * executor) persists this onto its per-ghost state record so the
   * next `runHouse` invocation can pick up where this one left off.
   */
  readonly onNeedsUpdate?: (needs: NeedProfile) => void;
  /**
   * Starting commitment ledger. Default: empty. Pass the previously-
   * evolved ledger to survive pause/resume cycles — without this,
   * open self-debts evaporate every Barnacle handoff.
   */
  readonly initialCommitments?: import("@aie-matrix/ghost-peppers-inner").CommitmentLedger;
  /**
   * Callback fired after every cascade with the post-reconciliation
   * commitment ledger. Same pattern as `onNeedsUpdate`.
   */
  readonly onCommitmentsUpdate?: (
    ledger: import("@aie-matrix/ghost-peppers-inner").CommitmentLedger,
  ) => void;
  /**
   * Callback fired after every cascade with the post-cascade
   * personality state (birth + accumulated drift). Same pattern as the
   * other update hooks — persists drift across pause/resume so a
   * ghost that's evolved over many cascades doesn't snap back to
   * birth on every Barnacle handoff.
   */
  readonly onPersonalityUpdate?: (state: PersonalityState) => void;
  /**
   * Starting primal→personality streak state. Default: empty (zero
   * per edge). Pass the previously-evolved streaks to survive
   * pause/resume so accumulated stress (or windfall) doesn't reset
   * mid-life.
   */
  readonly initialPrimalStreaks?: import("@aie-matrix/ghost-peppers-inner").PrimalPersonalityStreaks;
  /**
   * Callback fired after every cascade with the post-update streaks.
   * Same pattern as the other update hooks; persists per-ghost.
   */
  readonly onPrimalStreaksUpdate?: (
    streaks: import("@aie-matrix/ghost-peppers-inner").PrimalPersonalityStreaks,
  ) => void;
  /**
   * Starting metabolic strain. Default 0. Threaded so pause/resume
   * preserves accumulated chronic-overeating damage.
   */
  readonly initialMetabolicStrain?: number;
  /**
   * Callback fired after every cascade with the post-update strain.
   * Same pattern as the other update hooks; persists per-ghost.
   */
  readonly onMetabolicStrainUpdate?: (strain: number) => void;
  /**
   * Item refs the ghost is BLIND to. Items matching any ref here are
   * filtered out of `worldContext.takeableItemRefs` and never trigger
   * `mcguffin-in-view` stimuli. This is the architectural mechanism
   * that keeps the substrate ignorant of house-specific content —
   * default peppers passes nothing; house-flavoured variants populate
   * this with the platform classes their world contains that they
   * don't engage with (e.g. a default peppers running in a world
   * with a PokerTable passes `["PokerTable"]` so they walk over it
   * blind). Empty default means the substrate has no built-in
   * knowledge of any platform class.
   */
  readonly ignoredItemRefs?: ReadonlyArray<string>;
  /**
   * Pre-computed bearings to label-tagged points of interest. Each
   * entry triggers a `nearest` MCP call per cascade and the result
   * goes into `worldContext.bearings` for the Surface to use without
   * spending its own tool call. Empty default — the substrate has
   * no built-in destinations. House variants pass house-specific
   * targets (e.g. RDC-peppers would pass `[{ label: "Black Bart's",
   * spec: { itemClass: "PokerTable" } }]`).
   */
  readonly bearingTargets?: ReadonlyArray<{
    readonly label: string;
    readonly spec: { itemClass?: string; tileClass?: string };
  }>;
  /**
   * What this ghost is in the world to do. Shapes monologue framing and
   * action selection. If omitted, the ghost has no goal and tends to
   * wander.
   */
  readonly objective?: string;
  /**
   * When true, every cascade prints the full Id and Surface user
   * prompts and raw responses so you can see what the agents actually
   * saw and emitted. Defaults to false (clean output).
   */
  readonly verbose?: boolean;
  /**
   * Optional pre-started overlay server owned by the caller (executor).
   * runHouse rebinds the init payload at startup and broadcasts cascade
   * / tool_call events, but does NOT start or close the server — that
   * lifecycle is decoupled so the overlay survives pause/resume cycles
   * during Barnacle mini-game handoffs.
   */
  readonly overlay?: OverlayServer;
  /**
   * Optional log-line prefix label, e.g. `"#0"` or `"#1"` when running
   * multiple peppers ghosts in parallel. When set, log lines read
   * `[peppers-agent #0] …` instead of `[peppers-agent] …`.
   */
  readonly label?: string;
  /**
   * Pre-registered agent-host id. When running multiple peppers
   * ghosts in one process, register the house ONCE in the CLI and pass
   * the same id to all `runHouse` calls — otherwise ghosts can't read
   * each other's conversation messages (the conversation router only
   * allows cross-thread reads within a single house).
   */
  readonly preRegisteredHouseId?: string;
  /**
   * Pre-provisioned ghost credentials from an A2A spawn context (IC-006).
   * When set, skips the registry register/adopt flow and uses these
   * values directly — the MCP URL and token come from agent-host's proxy.
   */
  readonly preProvisionedGhost?: {
    readonly ghostId: string;
    readonly worldApiBaseUrl: string;
    readonly token: string;
    readonly agentHostId?: string;
    /** Persistent display name (e.g. "Django Decypher"). Primed into
     *  the name resolver and included in cascade payloads so the
     *  overlay/prompts use this label instead of `ghost_<prefix>`. */
    readonly displayName?: string;
  };
  /**
   * Optional AbortSignal. When aborted the stimulus loop exits cleanly
   * after the current cascade finishes (or before the next poll).
   * Wired by the A2A executor so cancelTask can stop the loop.
   */
  readonly signal?: AbortSignal;
  /**
   * Sleep pipeline (Step E): when set, the ghost enters BLACKOUT once
   * its cascade counter reaches this value — the stimulus loop pauses,
   * the full consolidation pipeline runs on the ghost's own session
   * (embed → consolidate → contradict → cut → distill), Skills reload,
   * and the loop resumes. Sleeping costs a little Fuel and restores
   * Rest — reduced metabolic burn, not free. One blackout per life.
   */
  readonly sleepAtCascade?: number;
}

export interface ConversationalState {
  readonly inConversationalMode: boolean;
  readonly turnsSinceLastSayWithNoReply: number;
  readonly socialAnchorTurnsLeft: number;
  /**
   * IMPETUS counter — increments every consecutive cascade where the
   * action was `say` (regardless of whether there was a reply). Resets
   * on any non-`say` action. Surfaced into the Surface prompt as a
   * rising urgency to leave the conversation once it's clear the ghost
   * is stuck in a talk loop. Pure observation, not a hard cap —
   * the prompt uses it to push toward `bye` (and then `go`).
   */
  readonly consecutiveSayTurns: number;
}

export const SOCIAL_ANCHOR_DURATION = 4;
/** Threshold above which the Surface prompt starts pushing for `bye`
 *  to break out of conversational lock. 3 is enough back-and-forth to
 *  feel like a real exchange before the impetus kicks in. */
export const IMPETUS_TALK_THRESHOLD = 3;
/**
 * Primal-drive urgency at which the body itself becomes a stimulus —
 * fires when the world poll returns nothing. 2.0 means the need is
 * already 2 display-units off its 5 sweet spot (e.g. Fuel ≤ 3.0 or
 * ≥ 7.0). Below this, idle still wins; above, the body wakes the
 * brain up regardless of world silence.
 *
 * Same scale `selectPrimalDrive` uses: distance from sweet spot, 0..5.
 * `selectPrimalDrive` itself uses 1.5 as "any drive at all" (healthy
 * band); 2.0 here is "the drive is loud enough to be the trigger."
 */
export const PRIMAL_STIMULUS_URGENCY = 2.0;

/**
 * Fuel display below which a cascade counts toward acute starvation. 1.0 is
 * the "starving past the point of useful action" line (the body has firmly
 * taken the wheel).
 */
export const CRITICAL_FUEL_DISPLAY = 1.0;

/**
 * Max critical-fuel cascades a ghost survives over its lifetime before acute
 * starvation death. Anchored to the human limit: the longest documented
 * survival without food is ~73 days (1981 Irish hunger strike — Kieran
 * Doherty, 73 days; that strike's deaths ranged 46–73 days). One
 * critical-fuel cascade ≈ one day of starvation.
 */
export const STARVATION_DEATH_CASCADES = (() => {
  const n = parseInt(process.env.PEPPERS_STARVATION_DEATH_CASCADES ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 73;
})();

/**
 * Pure state transition after one cascade. Given the previous state and the
 * cascade result (action + outcome + triggering stimulus), returns the next
 * conversational state. Does not handle the pre-cascade arm (cluster-entered
 * / new-peer detection); callers apply those before passing in.
 */
export function nextConversationalState(
  prev: ConversationalState,
  action: import("@aie-matrix/ghost-peppers-inner").SurfaceAction,
  outcome: import("@aie-matrix/ghost-peppers-inner").ActionOutcome,
  stimulus: import("@aie-matrix/ghost-peppers-inner").Stimulus,
): ConversationalState {
  let {
    inConversationalMode,
    turnsSinceLastSayWithNoReply,
    socialAnchorTurnsLeft,
    consecutiveSayTurns,
  } = prev;

  if (action.kind === "say" && outcome.ok) {
    inConversationalMode = true;
    turnsSinceLastSayWithNoReply = 0;
    consecutiveSayTurns++;
  } else if (action.kind === "bye" && outcome.ok) {
    inConversationalMode = false;
    turnsSinceLastSayWithNoReply = 0;
    consecutiveSayTurns = 0;
  } else if (outcome.ok === false && outcome.code === "IN_CONVERSATION") {
    inConversationalMode = true;
  } else if (stimulus.kind === "utterance") {
    turnsSinceLastSayWithNoReply = 0;
    socialAnchorTurnsLeft = SOCIAL_ANCHOR_DURATION;
  } else if (inConversationalMode) {
    turnsSinceLastSayWithNoReply++;
  }

  // Any non-`say` action breaks the talk streak.
  if (action.kind !== "say") {
    consecutiveSayTurns = 0;
  }

  if (socialAnchorTurnsLeft > 0) socialAnchorTurnsLeft--;

  return {
    inConversationalMode,
    turnsSinceLastSayWithNoReply,
    socialAnchorTurnsLeft,
    consecutiveSayTurns,
  };
}

/**
 * Run a single peppers-house ghost end-to-end against the live server.
 * Returns when the loop exits (max stimuli, max idle, or bye action).
 */
/** How a life ended — drives the executor's reincarnation decision. */
export interface RunHouseOutcome {
  /** "died" → the executor reincarnates; others end the task normally. */
  readonly ended: "completed" | "aborted" | "died";
  /** Death cause tag, e.g. "fuel-critical" / "metabolic-collapse". */
  readonly deathCause?: string;
  /** The single karmic word distilled at death, carried into the next life. */
  readonly karmicWord?: string;
  /** The q1–q3 reasoning behind the word, for the lineage record. */
  readonly reflection?: string;
  /** The corrective skill seeded into the next life — an instructional
   *  procedure (not a reflection) the new ghost is born already knowing. */
  readonly karmicSkill?: { readonly procedureJson: string; readonly triggerSummary: string };
}

export async function runHouse(opts: RunHouseOptions): Promise<RunHouseOutcome> {
  const idleTickMs = opts.idleTickMs ?? 1500;
  // Generous defaults for live demos — the ghost runs cascades until
  // it hits the total cap or the user Ctrl+Cs. Idle stimuli kick in
  // every K silent ticks so the ghost stays alive even when the world
  // around it has nothing new to offer.
  const maxStimuli = opts.maxStimuli ?? 40;
  const idleStimulusEveryK = opts.idleStimulusEveryK ?? 3;
  const verbose = opts.verbose ?? false;
  const objective = opts.objective;
  const overlay: OverlayServer | null = opts.overlay ?? null;
  const tag = opts.label ? `peppers-agent ${opts.label}` : "peppers-agent";
  const log = (msg: string): void => console.info(`[${tag}] ${msg}`);
  const warn = (msg: string, err?: unknown): void =>
    console.warn(`[${tag}] ${msg}`, err ?? "");

  let stopRequested = false;
  const stop = (): void => {
    stopRequested = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // 1. Resolve ghost credentials: A2A spawn context takes priority, then
  //    shared house pre-registration, then fresh register+adopt.
  const adopted: AdoptedGhost = await (opts.preProvisionedGhost !== undefined
    ? (() => {
        const p = opts.preProvisionedGhost!;
        log(`using pre-provisioned ghost=${p.ghostId} from A2A spawn context`);
        return Promise.resolve({
          ghostId: p.ghostId,
          caretakerId: "a2a",
          agentHostId: p.agentHostId ?? "a2a",
          worldApiBaseUrl: p.worldApiBaseUrl,
          token: p.token,
        } satisfies AdoptedGhost);
      })()
    : opts.preRegisteredHouseId !== undefined
    ? (() => {
        log(`adopting under shared house ${opts.preRegisteredHouseId} …`);
        return adoptUnderHouse({
          registryBase: opts.registryBase,
          agentHostId: opts.preRegisteredHouseId,
        });
      })()
    : (() => {
        log(`registering with ${opts.registryBase} …`);
        return registerAndAdopt({ registryBase: opts.registryBase });
      })());
  log(`adopted ghost=${adopted.ghostId} (caretaker=${adopted.caretakerId})`);

  // Prime the name resolver with self — avoids the cascade ever
  // referring to itself as `ghost_<prefix>` and bootstraps the cache
  // for any peer ghost that subsequently asks about us.
  const selfDisplayName = opts.preProvisionedGhost?.displayName;
  if (selfDisplayName) {
    primeDisplayName(adopted.ghostId, selfDisplayName);
  }

  // 2. Open MCP world connection. Overlay (if any) is owned by the
  // caller and reused across pause/resume cycles.
  const mcp = new GhostMcpClient({
    worldApiBaseUrl: adopted.worldApiBaseUrl,
    token: adopted.token,
    onToolCall: (obs) => {
      if (overlay !== null) overlay.broadcast("tool_call", obs);
    },
  });
  await mcp.connect();
  const executeAction = executeViaMcp(mcp);

  // Discover the authoritative tool menu from the MCP server. This is
  // what the Surface LLM picks from — no hardcoded action list in any
  // prompt, no per-tool switch in any dispatcher. New tools (mini-game
  // primitives, future world verbs) register on the server and become
  // visible to every agent on the next cascade.
  const tools = await mcp.listTools();
  log(`discovered ${tools.length} MCP tool(s): ${tools.map((t) => t.name).join(", ")}`);

  // 3. Open Agent Memory connection.
  const memoryHandle = await connectMemory(
    opts.memoryServiceUrl !== undefined && opts.memoryServiceUrl.length > 0
      ? { serviceUrl: opts.memoryServiceUrl }
      : { connection: opts.memoryConnection! },
  );

  // 3b. Sleep-pipeline Skill recall (Step D). Loads this ghost's
  // distilled :Skill nodes (none at birth; minted by blackouts) and
  // matches them against each cascade's stimulus. Non-fatal on
  // failure — a ghost without skill recall still lives.
  const skillRecall = new SkillRecall(adopted.ghostId);
  try {
    const n = await skillRecall.reload();
    if (n > 0) log(`skill recall: ${n} skill(s) loaded`);
  } catch (err) {
    warn("skill recall unavailable:", err);
  }
  // One blackout per life — latched after it fires.
  let hasSlept = false;

  // Reincarnation seed: if this ghostId was born carrying a karmic lesson
  // from a past life, load the single word. It rides the self-narrative
  // channel as this life's only inheritance — the prior life's actual
  // memories (narrative, skills, conversations — all under the old
  // ghostId) are never loaded; only the word crosses over.
  // The karmic word crosses over as JUST a word — no framing, no "lesson",
  // no "past life", no claim that it shapes you. It is deliberately
  // ambiguous: the ghost is handed a single word and told nothing about
  // what it is or why. Whether it surfaces, and how, is left entirely to
  // the ghost. (It is NOT folded into the self-narrative — that channel is
  // "who you wrote yourself to be", which a reborn ghost never authored.)
  let karmicWord: string | null = null;
  try {
    const karmic = await loadKarmicLessonFromEnv(adopted.ghostId);
    if (karmic) {
      karmicWord = karmic.word;
      log(`☯ reborn carrying one word: "${karmic.word}"`);
    }
  } catch {
    /* GHOST_MINDS unavailable — first life or no graph; no karmic word */
  }

  // Tracks how this life ends; the executor reincarnates only on "died".
  let outcome: RunHouseOutcome = { ended: "completed" };

  // Time-awake clock for Rest depletion. Updated each cascade; reset after
  // a blackout so sleep isn't counted as awake.
  let lastCascadeMs = Date.now();
  // Rest display below which the ghost is exhausted enough to sleep
  // (drive-triggered consolidation). Tunable.
  const REST_SLEEP_THRESHOLD = (() => {
    const n = parseFloat(process.env.PEPPERS_REST_SLEEP_THRESHOLD ?? "");
    return Number.isFinite(n) && n > 0 ? n : 3.0;
  })();
  // The un-consolidated tail of this life — monologue/goal snippets since
  // the last sleep. Consolidations fold the prior tail into the narrative
  // (cleared on sleep); at death this is the "final round" the karmic word
  // reviews alongside the full narrative chain.
  const finalRoundLog: string[] = [];

  // 4. Initial state + ID.
  let state = opts.initialPersonality ?? midpointPersonality();
  if (objective) {
    log(`objective: ${objective}`);
  }
  log("starting personality:");
  printPersonality(state, tag);

  if (verbose) {
    printSystemPrompts(tag);
  }

  const ctx: StimulusContext = emptyStimulusContext(
    adopted.ghostId,
    opts.registryBase,
    adopted.agentHostId,
    tag,
    opts.ignoredItemRefs ?? [],
  );
  let stimuliRun = 0;
  let consecutiveQuietTicks = 0;
  // Local mirror of the world-api's per-ghost conversational-mode flag.
  // Toggled by our own `say`/`bye` actions and corrected when the world
  // sends back IN_CONVERSATION on a denied `go`.
  let inConversationalMode = false;
  let turnsSinceLastSayWithNoReply = 0;
  // Bounded anchor window — set when a ghost enters the cluster, ticks
  // down each cascade. While > 0, surface should not pick `go`. Lets
  // the conversation actually start without forever-trapping us when
  // the world is dense.
  let socialAnchorTurnsLeft = 0;
  // IMPETUS: tracks consecutive `say` actions. Once it crosses
  // IMPETUS_TALK_THRESHOLD, the Surface prompt starts pushing for
  // `bye` (and then `go`) so the ghost can actually execute the plan
  // that all the talk has been building toward. Resets on any non-`say`
  // action.
  let consecutiveSayTurns = 0;
  // Tracks which peers we saw last cascade so we can detect first-sighting
  // transitions (peer appears in look-around when we hadn't seen them before)
  // and re-arm the anchor — covers ghosts that started already-clustered
  // and so never received a `cluster-entered` event.
  let lastNearbyGhosts: Set<string> = new Set();
  // In-process ring buffer of the last few super-objectives. Fed back
  // into convergence so committed plans persist across cascades; this
  // is the architectural counterweight to "every tick regenerates the
  // emotional drive from scratch and ghosts get stuck in talk loops".
  // Kept to 3 entries — matches the recent-cascades depth.
  const recentSuperObjectives: string[] = [];
  // Per-ghost commitment ledger — debts the inner voice resolved on
  // but hasn't yet paid down. Threads across cascades; the run-loop
  // returns the next ledger after every step. Survives pause/resume
  // via `initialCommitments` — without that, open debts evaporate
  // on every Barnacle handoff.
  let commitmentLedger: import("@aie-matrix/ghost-peppers-inner").CommitmentLedger =
    opts.initialCommitments ?? [];
  let cascadeIndex = 0;
  // Primal need state. Survives pause/resume cycles via the
  // `initialNeeds` option — the caller (executor) passes the ghost's
  // last known profile so depletion is continuous across Barnacle
  // handoffs. Without this, every poker-table encounter silently
  // reset every ghost's Fuel back to 5.0 mid-demo.
  let needs: NeedProfile = opts.initialNeeds ?? midpointNeeds();
  // Primal→personality streaks — per-edge signed counters that
  // accumulate the dynamic flux of each primal. Default to empty
  // (all zero) at birth; survive pause/resume via initialPrimalStreaks.
  let primalStreaks: import("@aie-matrix/ghost-peppers-inner").PrimalPersonalityStreaks =
    opts.initialPrimalStreaks ?? {};
  // Metabolic strain — state-based counter that accrues while Fuel
  // sits above the binge threshold and decays slowly when below. Drives
  // the "metabolic-collapse" decommission path, distinct from acute
  // Fuel=0 starvation.
  let metabolicStrain: number = opts.initialMetabolicStrain ?? 0;
  // Delayed need effects scheduled by earlier cascades (e.g. a cake's
  // sugar crash, due a few cascades after it was eaten). Threaded through
  // the loop like metabolicStrain; the run-loop fires due entries.
  let pendingEffects: import("@aie-matrix/ghost-peppers-inner").PendingNeedEffect[] = [];
  // RFC-0031: a painting/card the ghost engaged last cascade, fed as real model
  // input next cascade (image part / page text). Threaded like pendingEffects.
  let pendingPerception:
    | { readonly imageUrl?: string; readonly pageText?: string; readonly pageUrl?: string }
    | null = null;
  // Starvation clock. Fuel's display is a sigmoid that asymptotes to 0 but
  // never reaches it, so the old `fuelDisplay <= 0` death gate was
  // mathematically unreachable (ghosts plateaued near-starving forever).
  // Instead: tally the TOTAL cascades spent below the critical-fuel line over
  // the ghost's lifetime — death once that tally hits the human limit. This
  // is a cumulative budget, NOT a consecutive streak: eating back above the
  // line pauses the clock (no further accrual while fed) but does not undo
  // prior damage. Chronic starvation exposure is what kills. See
  // STARVATION_DEATH_CASCADES.
  let starvationCascades = 0;
  // Binge-episode latch (Stage 4). True while Fuel has crossed the
  // high threshold (relative to its current setpoint) and not yet
  // dropped back below the low threshold. During an active episode
  // the feeding tools are withdrawn (substrate-enforced digest
  // pause); when the episode resolves, Fuel.tolerance ticks up,
  // shifting the setpoint higher — addiction-shaped drift.
  let bingeActive = false;
  // Movement from the previous cascade (facet adjustments + primal
  // forces). The Id pipeline reads it to pick which 2 facets get to
  // speak this cascade; the Surface reads it to pick which 2
  // external archetypes to render. Undefined on the very first
  // cascade — pipelines fall back to "most extreme from midpoint".
  let recentMovement: import("./facet-selection.js").RecentMovement | undefined;
  const startedAt = new Date().toISOString();

  // Rebind the externally-owned overlay's init payload to this run's
  // current state, so any browser connecting (or reconnecting across a
  // pause/resume cycle) sees the live snapshot instead of whichever
  // snapshot was captured the first time the overlay was started.
  if (overlay !== null) {
    overlay.setInit(() => ({
      ghostId: adopted.ghostId,
      // Spawn-context name only — never reach for resolver fallback
      // here, the overlay should render its own fallback if absent.
      displayName: selfDisplayName ?? null,
      objective: objective ?? null,
      personality: personalityForUi(state),
      // Initial need profile — every ghost spawns satiated at 5/10.
      needs: STARTER_NEEDS.map((n) => ({
        need: n,
        urgency: needs[n].display,
      })),
      startedAt,
    }));
  }

  try {
    // Note: we used to exit the loop when the Surface picked `bye`, but
    // the LLM picks it spuriously (no actual conversation to exit) and
    // killed long demos. Now `bye` is just an action like any other —
    // the world-api handles it, the loop continues until Ctrl+C or
    // maxStimuli.
    while (!stopRequested && !opts.signal?.aborted && stimuliRun < maxStimuli) {
      let stimulus: Stimulus | null = await pollNextStimulus(mcp, ctx);

      if (stimulus === null) {
        consecutiveQuietTicks++;
        // The body asserts itself. When no world stimulus arrives,
        // a strong primal drive (urgency ≥ PRIMAL_STIMULUS_URGENCY)
        // becomes the trigger itself — preempts both the idle wait
        // and the idle stimulus. Without this, a starving ghost
        // sitting alone never gets a cascade and just expires while
        // looking calm. With it, the lizard wakes the brain up.
        const bodyDrive = selectPrimalDrive(needs);
        if (
          bodyDrive !== null &&
          bodyDrive.urgency >= PRIMAL_STIMULUS_URGENCY
        ) {
          stimulus = {
            kind: "primal",
            need: bodyDrive.need,
            direction: bodyDrive.direction,
            urgency: bodyDrive.urgency,
            currentDisplay: bodyDrive.currentDisplay,
            drive: bodyDrive.drive,
            quietForMs: consecutiveQuietTicks * idleTickMs,
          };
          consecutiveQuietTicks = 0;
        } else if (consecutiveQuietTicks >= idleStimulusEveryK) {
          // After K silent polls AND no strong body call, emit an idle
          // stimulus so the ghost has something to react to.
          stimulus = {
            kind: "idle",
            quietForMs: consecutiveQuietTicks * idleTickMs,
          };
          consecutiveQuietTicks = 0;
        } else {
          await delay(idleTickMs);
          continue;
        }
      } else {
        consecutiveQuietTicks = 0;
      }

      stimuliRun++;
      log(`\n────── stimulus #${stimuliRun}: ${describeStimulus(stimulus)} ──────`);

      // Cluster-entered → arm the anchor; cluster-left and idle let it
      // tick down naturally below.
      if (stimulus.kind === "cluster-entered") {
        socialAnchorTurnsLeft = SOCIAL_ANCHOR_DURATION;
      }

      // Snapshot world context for the Surface so it can ground "go" /
      // "take" / "say" choices in what's actually available right now.
      const snapshot = await snapshotWorldContext(
        mcp,
        adopted.ghostId,
        opts.registryBase,
        opts.ignoredItemRefs ?? [],
        opts.bearingTargets ?? [],
      );

      // Re-arm the anchor when a peer first appears in the cluster.
      // `cluster-entered` covers events that fire mid-run, but ghosts
      // that spawned already-clustered never get one — so detect the
      // transition manually here.
      const currentNearby = new Set(snapshot.nearbyGhostIds ?? []);
      const sawNewPeer = [...currentNearby].some((g) => !lastNearbyGhosts.has(g));
      if (sawNewPeer) {
        socialAnchorTurnsLeft = SOCIAL_ANCHOR_DURATION;
      }
      lastNearbyGhosts = currentNearby;

      const worldContext = {
        ...snapshot,
        inConversationalMode,
        turnsSinceLastSayWithNoReply,
        socialAnchorTurnsLeft,
        consecutiveSayTurns,
      };

      // Cascade-time skill match (Step D). Resolved BEFORE the cascade
      // so the Id sees the hint; logged whether or not it matched so
      // match-rate is measurable from the capture log.
      let skillMatch: Awaited<ReturnType<SkillRecall["match"]>> = null;
      if (skillRecall.count > 0) {
        try {
          // formatStimulusForTrace — the SAME rendering persistCascade
          // uses for ReasoningTrace.task, so the match text lives in
          // the skills' trigger lexical space. Not the Id-prompt
          // formatStimulus, whose grammar differs.
          skillMatch = await skillRecall.match(formatStimulusForTrace(stimulus));
        } catch (err) {
          warn("skill match failed:", err);
        }
        if (skillMatch !== null) {
          log(
            `skill match: ${skillMatch.skillId.slice(0, 8)}… sim=${skillMatch.similarity.toFixed(3)} trigger="${skillMatch.triggerSummary}"`,
          );
        }
      }

      try {
        const nowMs = Date.now();
        const elapsedMsAwake = nowMs - lastCascadeMs;
        lastCascadeMs = nowMs;
        const record = await runOneStimulus({
          memoryHandle,
          ghostId: adopted.ghostId,
          state,
          stimulus,
          mcp,
          executeAction,
          worldContext,
          objective,
          elapsedMsAwake,
          tools,
          commitmentLedger,
          cascadeIndex,
          ...(pendingPerception ? { pendingPerception } : {}),
          needs,
          primalStreaks,
          metabolicStrain,
          pendingEffects,
          bingeActive,
          ...(skillMatch !== null
            ? {
                skillHint: {
                  purpose: skillMatch.purpose,
                  hintText: skillMatch.hintText,
                },
              }
            : {}),
          // Self-narrative: who the ghost decided it was at its last sleep
          // (null until the first blackout). The karmic word is NOT mixed in
          // here — it rides its own bare channel (see `karmicWord` below).
          ...(skillRecall.narrative && skillRecall.narrative.length > 0
            ? { selfNarrative: skillRecall.narrative }
            : {}),
          // The inherited karmic word — passed bare, no framing.
          ...(karmicWord ? { karmicWord } : {}),
          // Observer live feed: only when an overlay is attached — the
          // Id streams its run and each compact event lands on the
          // overlay's SSE channel as `id_stream` for downstream
          // viewers. No overlay → batch execution, zero overhead.
          ...(overlay !== null
            ? {
                onIdRunEvent: (ev: import("./reason-id-action.js").IdStreamEvent) =>
                  overlay.broadcast("id_stream", {
                    ghostId: adopted.ghostId,
                    displayName: selfDisplayName ?? null,
                    cascadeIndex,
                    ...ev,
                  }),
              }
            : {}),
          ...(selfDisplayName ? { selfDisplayName } : {}),
          ...(recentSuperObjectives.length > 0
            ? { recentSuperObjectives }
            : {}),
          ...(recentMovement !== undefined ? { recentMovement } : {}),
        });
        commitmentLedger = record.nextLedger;
        needs = record.nextNeeds;
        pendingPerception = record.nextPendingPerception;
        primalStreaks = record.nextPrimalStreaks;
        metabolicStrain = record.nextMetabolicStrain;
        pendingEffects = record.nextPendingEffects;
        // Episode-end edge: tick Fuel.tolerance up. Setpoint shifts
        // higher, so the same Fuel display now reads as "more
        // depleted" — next round the ghost needs more food to feel
        // satiated. That's the addiction loop.
        if (record.bingeEpisodeEnded) {
          needs = incrementNeedTolerance(needs, "Fuel", "high");
          console.info(
            `[peppers-binge] ${selfDisplayName ?? adopted.ghostId}: binge episode ended → Fuel.tolerance=${needs.Fuel.slider.tolerance}, setpoint now display ${(10 / (1 + Math.exp(-needs.Fuel.slider.setpoint))).toFixed(2)}`,
          );
        }
        bingeActive = record.nextBingeActive;
        // Capture this cascade's actual slider movement so the next
        // cascade can use it to pick its active facets.
        recentMovement = {
          applied: record.applied,
          primalForces: record.primalForces,
        };
        // Persist back to the caller so pause/resume can resume at the
        // same need / ledger level and with accumulated drift. The
        // callbacks are expected to do synchronous assignments (e.g.
        // `ghost.needs = n`). Personality update fires below after
        // `state = record.nextState`.
        opts.onNeedsUpdate?.(needs);
        opts.onCommitmentsUpdate?.(commitmentLedger);
        opts.onPrimalStreaksUpdate?.(primalStreaks);
        opts.onMetabolicStrainUpdate?.(metabolicStrain);
        cascadeIndex += 1;

        // Full structured capture of this cascade — every prompt the
        // LLM saw, every response, the resolved expressions, the
        // primal drive, the world snapshot. Lets the agent authoring
        // the system verify properties like "no PokerTable references
        // anywhere" or "Fuel monotonic-down" post-hoc, instead of
        // relying on the human as a parser.
        captureRecord("cascade", {
          ghostId: adopted.ghostId,
          displayName: selfDisplayName ?? null,
          cascadeIndex,
          stimulus: record.stimulus,
          needs: {
            Fuel: needs.Fuel.display,
            Coherence: needs.Coherence.display,
            Rest: needs.Rest.display,
          },
          primalDrive: record.id.primalDrive,
          superObjective: record.id.superObjective,
          emotionalRead: record.id.emotionalRead,
          impulse: record.id.impulse,
          monologue: record.id.monologue,
          facetReadings: record.id.facetReadings.map((r) => ({
            facet: r.facet,
            judgment: r.judgment,
            adjustment: r.adjustment,
            reading: r.reading,
            expression: r.expression,
          })),
          idUserPrompt: record.id.userPrompt,
          idRaw: record.id.raw,
          surfaceUserPrompt: record.surface.userPrompt,
          surfaceRaw: record.surface.raw,
          action: record.action,
          // The ghost's spoken utterance this cascade (gated speech, separate
          // from the representative `action`) — recorded so analysis can join
          // speech against Fuel/temperature.
          say: record.say,
          // Step D: skill-recall result for this cascade. Null when no
          // skill cleared the threshold (or the ghost has none). The
          // Step F analysis joins this against `action` to compute
          // match→use rates.
          skillMatch:
            skillMatch !== null
              ? {
                  skillId: skillMatch.skillId,
                  similarity: skillMatch.similarity,
                  triggerSummary: skillMatch.triggerSummary,
                }
              : null,
          // Step 9/SDK migration: every world action the Id fired
          // during this cascade, with intent/outcome. Captures the
          // compound-cascade shape (speak + go + eat) when the SDK
          // loop produces more than one tool call.
          actions: record.id.actionTrace?.actionOutcomes ?? [],
          // Fork-join worker delegations — visible in the capture log
          // because behaviour-judged development needs forked work in
          // the trace, or it never happened.
          delegations: record.id.actionTrace?.delegations ?? [],
          recalls: record.id.actionTrace?.recalls ?? [],
          outcome: record.outcome,
          worldContext: worldContext,
          adjustments: record.applied,
          commitmentEvaluation: record.commitment,
          openCommitments: commitmentLedger,
          primalFlux: record.primalFlux,
          primalStreaks: record.nextPrimalStreaks,
          primalForces: record.primalForces.map((f) => ({
            source: f.edge.source,
            facet: f.edge.targetFacet,
            axis: f.edge.targetAxis,
            logitDelta: f.logitDelta,
          })),
          metabolicStrain: record.nextMetabolicStrain,
          // Post-cascade personality (includes both facet drift AND
          // primal-driven drift, in that order). Display values for
          // each facet's internal + external sliders. Lets us trace
          // primal→personality wiring effects post-hoc.
          personalityAfter: Object.fromEntries(
            STARTER_FACETS.map((f) => [
              f,
              {
                internal: toDisplay(record.nextState[f].internal),
                external: toDisplay(record.nextState[f].external),
              },
            ]),
          ),
        });

        // Fuel-critical decommission. Fuel has no replenishment in the
        // world yet, so every ghost is on a finite clock. When Fuel
        // display drops below 1.0 the ghost is starving past the point
        // of useful action — stop cascading and let the outer loop
        // exit. The ghost stays in the world (visible to others) but
        // emits no further actions. World-side removal (registry
        // withdraw, colyseus removeGhostCell) is a follow-up.
        const fuelDisplay = needs.Fuel.display;
        const cohDisplay = needs.Coherence.display;
        const restDisplay = needs.Rest.display;
        // Accrue the lifetime acute-starvation clock: each cascade below the
        // critical line spends one of the ghost's finite starvation days.
        if (fuelDisplay < CRITICAL_FUEL_DISPLAY) starvationCascades += 1;
        // Per-cascade need diagnostic — keeps the terminal honest about
        // where the sliders actually are. Helpful for verifying
        // depletion is working even when the overlay isn't open.
        log(
          `needs: Fuel=${fuelDisplay.toFixed(2)} Coh=${cohDisplay.toFixed(2)} Rest=${restDisplay.toFixed(2)}` +
            (fuelDisplay < CRITICAL_FUEL_DISPLAY
              ? ` · STARVING ${starvationCascades}/${STARVATION_DEATH_CASCADES}`
              : "") +
            (record.id.primalDrive
              ? ` · DRIVE: ${record.id.primalDrive.need} ${record.id.primalDrive.direction} (urgency ${record.id.primalDrive.urgency.toFixed(2)})`
              : ""),
        );
        if (starvationCascades >= STARVATION_DEATH_CASCADES) {
          // Acute starvation death. The ghost spent its lifetime budget of
          // critical-fuel cascades (STARVATION_DEATH_CASCADES, anchored to
          // the human ~73-day limit). We count the cumulative tally rather
          // than testing `fuelDisplay <= 0`, because Fuel's sigmoid display
          // asymptotes to 0 and never reaches it — that gate could never
          // fire, leaving ghosts immortal in a permanent near-starving
          // plateau.
          //
          // Banner-style multi-line log — easy to spot in a stream of
          // 6 ghosts' cascade output. The 💀 line alone gets buried.
          log("");
          log("╔════════════════════════════════════════════════════════════╗");
          log(`║ 💀 DECOMMISSIONED: ${selfDisplayName ?? adopted.ghostId.slice(0, 8)}`);
          log(`║    Starved — ${starvationCascades} critical-fuel cascades (Fuel ${fuelDisplay.toFixed(2)})`);
          log(`║    Cascade ${cascadeIndex}, no further actions will be emitted`);
          log("╚════════════════════════════════════════════════════════════╝");
          log("");
          // Notify the overlay so the UI can render a DECOMMISSIONED
          // banner — otherwise the dashboard shows the last cascade
          // state forever and you can't tell whether the ghost is
          // dead or merely quiet.
          if (overlay !== null) {
            overlay.broadcast("decommissioned", {
              ghostId: adopted.ghostId,
              displayName: selfDisplayName ?? null,
              cascadeIndex,
              cause: "fuel-critical",
              fuelDisplay,
              starvationCascades,
              atIso: new Date().toISOString(),
            });
          }
          captureRecord("decommissioned", {
            ghostId: adopted.ghostId,
            displayName: selfDisplayName ?? null,
            cascadeIndex,
            cause: "fuel-critical",
            fuelDisplay,
            starvationCascades,
            metabolicStrain,
          });
          // Final consolidation: distil this life into one karmic word, the
          // sole inheritance of the next life (the executor reincarnates on
          // this outcome).
          {
            let chain: string[] = [];
            try {
              chain = await loadAllNarrativesFromEnv(adopted.ghostId);
            } catch { /* GHOST_MINDS unavailable — reflect without the arc */ }
            const lesson = await reflectOnDeath({
              displayName: selfDisplayName ?? adopted.ghostId.slice(0, 8),
              deathCause: "starvation",
              narrativeChain: chain,
              finalRound: finalRoundLog.join("\n"),
            });
            log(
              `☯ ${selfDisplayName ?? adopted.ghostId.slice(0, 8)} carried one lesson onward: "${lesson.word}"`,
            );
            outcome = {
              ended: "died",
              deathCause: "fuel-critical",
              karmicWord: lesson.word,
              reflection: lesson.reflection,
              karmicSkill: lesson.skill,
            };
          }
          stopRequested = true;
        } else if (metabolicStrain >= METABOLIC_STRAIN_DEATH_THRESHOLD) {
          // Chronic-overeating mortality. Strain accumulated past the
          // tolerance threshold while Fuel sat above the binge zone for
          // too many cascades. Distinct death cause from acute
          // starvation — `metabolic-collapse` not `fuel-critical`.
          log("");
          log("╔════════════════════════════════════════════════════════════╗");
          log(`║ 🥩 METABOLIC COLLAPSE: ${selfDisplayName ?? adopted.ghostId.slice(0, 8)}`);
          log(`║    strain ${metabolicStrain.toFixed(1)} (threshold ${METABOLIC_STRAIN_DEATH_THRESHOLD})`);
          log(`║    Cascade ${cascadeIndex}, no further actions will be emitted`);
          log("╚════════════════════════════════════════════════════════════╝");
          log("");
          if (overlay !== null) {
            overlay.broadcast("decommissioned", {
              ghostId: adopted.ghostId,
              displayName: selfDisplayName ?? null,
              cascadeIndex,
              cause: "metabolic-collapse",
              fuelDisplay,
              metabolicStrain,
              atIso: new Date().toISOString(),
            });
          }
          captureRecord("decommissioned", {
            ghostId: adopted.ghostId,
            displayName: selfDisplayName ?? null,
            cascadeIndex,
            cause: "metabolic-collapse",
            fuelDisplay,
            metabolicStrain,
          });
          {
            let chain: string[] = [];
            try {
              chain = await loadAllNarrativesFromEnv(adopted.ghostId);
            } catch { /* GHOST_MINDS unavailable — reflect without the arc */ }
            const lesson = await reflectOnDeath({
              displayName: selfDisplayName ?? adopted.ghostId.slice(0, 8),
              deathCause: "metabolic collapse from chronic overeating",
              narrativeChain: chain,
              finalRound: finalRoundLog.join("\n"),
            });
            log(
              `☯ ${selfDisplayName ?? adopted.ghostId.slice(0, 8)} carried one lesson onward: "${lesson.word}"`,
            );
            outcome = {
              ended: "died",
              deathCause: "metabolic-collapse",
              karmicWord: lesson.word,
              reflection: lesson.reflection,
              karmicSkill: lesson.skill,
            };
          }
          stopRequested = true;
        }
        if (record.commitment !== null) {
          const sat = record.commitment.satisfiedIds.length;
          const minted = record.commitment.newCommitments.length;
          if (sat > 0 || minted > 0) {
            log(
              `commitments: +${minted} new, -${sat} paid, open=${commitmentLedger.length}`,
            );
          }
          for (const c of record.commitment.newCommitments) {
            log(`  + owe: "${c.owed}" (satisfies-when: ${c.recognizesSatisfaction})`);
          }
        }
        // Append this cascade's super-objective to the rolling buffer
        // so the next tick's convergence sees the plan continuity.
        recentSuperObjectives.push(record.id.superObjective);
        if (recentSuperObjectives.length > 3) recentSuperObjectives.shift();
        // Accumulate the un-consolidated tail (cleared each sleep). One terse
        // line per cascade: goal + felt monologue. Capped so a long stretch
        // without sleep doesn't grow unbounded.
        {
          const mono = (record.id.monologue ?? "").trim().slice(0, 120);
          if (mono) finalRoundLog.push(`#${cascadeIndex}: ${mono}`);
          if (finalRoundLog.length > 24) finalRoundLog.shift();
        }
        state = record.nextState;
        opts.onPersonalityUpdate?.(state);
        // 4-way reaction tag: when the stimulus was an utterance, label
        // the chosen action. `go` covers both EVADE (escape) and
        // DEPART (purposeful movement toward an agreed destination) —
        // both are valid breakouts of a conversation loop; the
        // monologue distinguishes intent. The Surface prompt only
        // allows say|look|go on utterance; anything else falls through
        // to UNKNOWN so prompt-rule violations stay detectable.
        const reactionTag =
          stimulus.kind === "utterance"
            ? record.action.kind === "say"
              ? "RESPOND"
              : record.action.kind === "look"
                ? "GHOST"
                : record.action.kind === "go"
                  ? "GO"
                  : "UNKNOWN"
            : null;
        if (reactionTag !== null) {
          log(`reaction: ${reactionTag} → ${(stimulus as { from?: string }).from ?? "?"}`);
        }
        if (overlay !== null) {
          const payload = buildCascadePayload(record, state, record.nextNeeds, worldContext, ctx, objective, selfDisplayName) as Record<string, unknown>;
          overlay.broadcast("cascade", {
            ...payload,
            ...(reactionTag !== null ? { reaction: reactionTag } : {}),
          });
        }
        if (verbose) {
          printVerbose(record, tag);
        } else {
          log(`super-objective: ${record.id.superObjective}`);
          log(`monologue: ${record.id.monologue}`);
          log(`action: ${JSON.stringify(record.action)}`);
          log(`outcome: ${formatOutcome(record.outcome)}`);
          for (const a of record.applied) {
            log(
              `  ${a.facet}.${a.axis} ${a.direction} (${a.beforeDisplay.toFixed(2)} → ${a.afterDisplay.toFixed(2)})`,
            );
          }
        }

        // Update conversational-mode mirror, social anchor, and impetus counter.
        ({
          inConversationalMode,
          turnsSinceLastSayWithNoReply,
          socialAnchorTurnsLeft,
          consecutiveSayTurns,
        } = nextConversationalState(
          {
            inConversationalMode,
            turnsSinceLastSayWithNoReply,
            socialAnchorTurnsLeft,
            consecutiveSayTurns,
          },
          record.action,
          record.outcome,
          record.stimulus,
        ));

        // Drive-triggered consolidation (replaces the scheduled one-shot).
        // When the ghost is exhausted enough — Rest below threshold, where
        // Rest drained on tokens + time-awake — it BLACKS OUT: the
        // consolidation pipeline folds recent experience into its personal
        // narrative + skills, then it wakes rested. This recurs across a
        // life, so a narrative chain accumulates — which the karmic
        // death-reflection later reviews. The PEPPERS_SLEEP_AT_CASCADE
        // experiment flag still forces a one-off blackout if set.
        const restNow = needs.Rest.display;
        const scheduledSleep =
          !hasSlept &&
          opts.sleepAtCascade !== undefined &&
          cascadeIndex >= opts.sleepAtCascade;
        const driveSleep = restNow < REST_SLEEP_THRESHOLD;
        if (!stopRequested && (driveSleep || scheduledSleep)) {
          if (scheduledSleep) hasSlept = true;
          log("");
          log("╔════════════════════════════════════════════════════════════╗");
          log(`║ 😴 BLACKOUT: ${selfDisplayName ?? adopted.ghostId.slice(0, 8)} sleeping (Rest ${restNow.toFixed(2)}) at cascade ${cascadeIndex}`);
          log("╚════════════════════════════════════════════════════════════╝");
          captureRecord("sleep", {
            ghostId: adopted.ghostId,
            displayName: selfDisplayName ?? null,
            cascadeIndex,
            kind: "blackout-start",
            restDisplay: restNow,
            trigger: driveSleep ? "rest-depletion" : "scheduled",
            skillsBefore: skillRecall.count,
          });
          const sleepStartedMs = Date.now();
          let consolidated = false;
          try {
            await runBlackoutPipeline(adopted.ghostId, log);
            // Success: the tail folded into a new narrative — start fresh.
            finalRoundLog.length = 0;
            consolidated = true;
            const reloaded = await skillRecall.reload();
            log(`║ ⏰ WAKE: ${reloaded} skill(s), consolidated after ${(Math.round((Date.now() - sleepStartedMs) / 1000))}s asleep`);
            captureRecord("wake", {
              ghostId: adopted.ghostId,
              displayName: selfDisplayName ?? null,
              cascadeIndex,
              sleepSeconds: Math.round((Date.now() - sleepStartedMs) / 1000),
              skillsAfter: reloaded,
            });
          } catch (err) {
            // Consolidation couldn't run — KEEP the final-round tail so the
            // death reflection still has this life's material. The nap still
            // restores Rest (below), so the ghost doesn't sleep-loop.
            warn("blackout pipeline failed — napping without consolidation:", err);
            captureRecord("wake", {
              ghostId: adopted.ghostId,
              displayName: selfDisplayName ?? null,
              cascadeIndex,
              sleepSeconds: Math.round((Date.now() - sleepStartedMs) / 1000),
              skillsAfter: skillRecall.count,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          // A nap restores Rest and burns a little Fuel WHETHER OR NOT
          // consolidation succeeded — otherwise a failing pipeline pins the
          // ghost below the sleep threshold and it blacks out every cascade.
          needs = adjustNeed(needs, "Fuel", "down", 0.3);
          needs = adjustNeed(needs, "Rest", "up", 6.0);
          opts.onNeedsUpdate?.(needs);
          log(`║ ⏰ WAKE: Rest→${needs.Rest.display.toFixed(2)}${consolidated ? "" : " (no consolidation)"}`);
          // Don't count the blackout itself as awake-time.
          lastCascadeMs = Date.now();
        }
      } catch (err) {
        warn("cascade failed:", err);
        // Back off after a failed cascade so a recurring failure can't
        // pin the world MCP at world-call-latency. Without this, a
        // pre-LLM failure (e.g. memory retrieval throwing) skips the
        // LLM call that normally rate-limits the loop, and the loop
        // hot-spins firing snapshot calls.
        await delay(idleTickMs);
      }
    }

    log("\nloop end. Final personality:");
    printPersonality(state, tag);
  } finally {
    try {
      await mcp.disconnect();
    } catch {
      /* ignore */
    }
    try {
      await memoryHandle.close();
    } catch {
      /* ignore */
    }
    // Note: overlay server is owned by the caller (executor) and
    // intentionally NOT closed here. Closing it on every pause would
    // black out the spectator UI whenever a Barnacle mini-game session
    // started, which is the opposite of what observers want.
  }
  // "died" → the executor reincarnates; "aborted"/"completed" end normally.
  return opts.signal?.aborted && outcome.ended !== "died"
    ? { ended: "aborted" }
    : outcome;
}

/** Convert a `PersonalityState` into the display-value format the overlay UI expects. */
function personalityForUi(state: PersonalityState): ReadonlyArray<{
  facet: string;
  internal: number;
  external: number;
}> {
  return STARTER_FACETS.map((facet) => ({
    facet,
    internal: toDisplay(state[facet].internal),
    external: toDisplay(state[facet].external),
  }));
}

/** Shape one cascade for SSE transmission to the overlay. */
function buildCascadePayload(
  record: import("./run-loop.js").RunRecord,
  nextState: PersonalityState,
  nextNeeds: NeedProfile,
  worldContext: WorldContext,
  ctx: StimulusContext,
  objective: string | undefined,
  selfDisplayName: string | undefined,
): unknown {
  return {
    ghostId: record.ghostId,
    // Use the spawn-context displayName directly — no resolver detour.
    // If the spawn caller (the demo) supplied a name, it's the truth;
    // otherwise we surface null so the overlay can render its own
    // fallback rather than embedding a misleading `ghost_<prefix>`.
    displayName: selfDisplayName ?? null,
    objective: objective ?? null,
    superObjective: record.id.superObjective,
    monologue: record.id.monologue,
    stimulus: record.stimulus,
    action: record.action,
    outcome: record.outcome,
    // The ghost's OWN spoken utterance this cascade (gated speech is separate
    // from the representative world `action`) — the overlay renders this as
    // the outgoing side of the conversation.
    say: record.say,
    adjustments: record.applied.map((a) => ({
      facet: a.facet,
      axis: a.axis,
      direction: a.direction,
      beforeDisplay: a.beforeDisplay,
      afterDisplay: a.afterDisplay,
    })),
    // Per-facet resolved expressions + LLM readings. Lets the overlay
    // surface the slider-derived character anchors the LLM actually saw,
    // alongside the reading it produced. Lifeline for debugging the
    // mechanical resolver.
    facetReadings: record.id.facetReadings.map((r) => ({
      facet: r.facet,
      judgment: r.judgment,
      reading: r.reading,
      adjustment: r.adjustment === null ? null : {
        axis: r.adjustment.axis,
        direction: r.adjustment.direction,
      },
      expression: r.expression === null ? null : {
        feltSummary: r.expression.feltSummary,
        feltCharacters: r.expression.feltCharacters,
        projectedSummary: r.expression.projectedSummary,
        projectedCharacters: r.expression.projectedCharacters,
        maskDescription: r.expression.maskDescription,
        compoundArchetype: r.expression.compoundArchetype,
      },
    })),
    personality: personalityForUi(nextState),
    // Primal need state after this cascade's depletion. Same display
    // shape as personality facets so the overlay can render bars.
    needs: STARTER_NEEDS.map((n) => ({
      need: n,
      urgency: nextNeeds[n].display,
    })),
    // The lizard's call for this cascade — null when all needs are
    // healthy. Lets the overlay show "ghost X is starving and being
    // told to find sustenance" right alongside the actions they take.
    primalDrive: record.id.primalDrive === null ? null : {
      need: record.id.primalDrive.need,
      direction: record.id.primalDrive.direction,
      urgency: record.id.primalDrive.urgency,
      currentDisplay: record.id.primalDrive.currentDisplay,
      drive: record.id.primalDrive.drive,
    },
    worldContext: {
      exits: worldContext.availableExits ?? null,
      nearbyGhosts: worldContext.nearbyGhostIds ?? null,
      itemsHere: worldContext.takeableItemRefs ?? null,
      inventory: worldContext.inventoryItemRefs ?? null,
      bearings: worldContext.bearings ?? null,
    },
    commitments: record.nextLedger.map((c) => ({
      id: c.id,
      owed: c.owed,
      recognizesSatisfaction: c.recognizesSatisfaction,
      bornAtCascade: c.bornAtCascade,
    })),
    commitmentEvaluation: record.commitment === null
      ? null
      : {
          satisfiedIds: record.commitment.satisfiedIds,
          newCommitmentIds: record.commitment.newCommitments.map((c) => c.id),
        },
    tileClass: ctx.lastTileClass,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run the full sleep consolidation chain (embed → consolidate →
 * contradict → cut → distill → narrate) for one ghost session,
 * IN-PROCESS. Previously this spawned `node --import tsx <src.ts>`, which
 * cannot run in the lean production Docker image (no tsx, no src/, bad
 * cwd) — so consolidation silently never ran. Calling the step functions
 * directly works identically in dev and Docker and spawns no subprocess.
 */
function runBlackoutPipeline(
  ghostId: string,
  log: (msg: string) => void,
): Promise<void> {
  return runBlackout(ghostId, { commit: true, log });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render a list of item names as English: ["A","B","C"] → "A, B and C". */
function formatItemList(names: ReadonlyArray<string>): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Snapshot what the ghost can act on right now: valid exits, items
 * on the current tile, other ghosts here, and current inventory.
 * Each tool failure is non-fatal — we just omit that field.
 */
async function snapshotWorldContext(
  mcp: GhostMcpClient,
  selfGhostId: string,
  registryBase: string,
  ignoredItemRefs: ReadonlyArray<string>,
  bearingTargets: ReadonlyArray<{ label: string; spec: { itemClass?: string; tileClass?: string } }>,
): Promise<WorldContext> {
  const ignored = new Set(ignoredItemRefs);
  const ctx: WorldContext = {};
  const next: {
    -readonly [K in keyof WorldContext]: WorldContext[K];
  } = ctx as { -readonly [K in keyof WorldContext]: WorldContext[K] };

  // Capture exits with tileId → direction so we can label impressions
  // ("Yul B-Tree, to the n of you, on a Blue tile") rather than the
  // fuzzy "nearby". Falls back gracefully if exits fail.
  const dirByTileId = new Map<string, string>();
  try {
    const exits = (await mcp.callTool("exits", {})) as {
      exits?: ReadonlyArray<{ toward?: string; tileId?: string }>;
    };
    next.availableExits = (exits.exits ?? [])
      .map((e) => e.toward)
      .filter((t): t is string => typeof t === "string");
    for (const e of exits.exits ?? []) {
      if (typeof e.tileId === "string" && typeof e.toward === "string") {
        dirByTileId.set(e.tileId, e.toward);
      }
    }
  } catch {
    /* leave undefined */
  }

  // Same-tile occupants and items. Keep `lookHere` for the impression pass.
  let hereOccupants: string[] = [];
  let hereTileClass: string | null = null;
  const hereItemNames: string[] = [];
  try {
    const look = (await mcp.callTool("look", { at: "here" })) as {
      tileClass?: string;
      occupants?: ReadonlyArray<string>;
      objects?: ReadonlyArray<{ id?: string; name?: string; at?: string }>;
    };
    if (typeof look.tileClass === "string") hereTileClass = look.tileClass;
    if (Array.isArray(look.occupants)) {
      hereOccupants = look.occupants.filter(
        (g): g is string => typeof g === "string" && g !== selfGhostId,
      );
    }
    const hereObjs = look.objects ?? [];
    const hereItems = hereObjs
      .filter((o) => o.at === "here" && typeof o.id === "string")
      .map((o) => o.id as string)
      .filter((ref) => !ignored.has(ref));
    if (hereItems.length > 0) {
      next.takeableItemRefs = hereItems;
    }
    // Class + world-reported name pairs, aligned with hereItems above.
    // The world surfaces ItemType.name on each object; we pass it
    // through so the prompt-builder can describe each prop via the
    // `world-props` catalog ("Worn Wooden Bench — A bench at the
    // edge of the path…") instead of the bare class.
    const hereItemsDetailed = hereObjs
      .filter((o) => o.at === "here" && typeof o.id === "string")
      .map((o) => ({
        class: o.id as string,
        name: typeof o.name === "string" ? o.name : null,
      }))
      .filter((entry) => !ignored.has(entry.class));
    if (hereItemsDetailed.length > 0) {
      next.takeableItemsHere = hereItemsDetailed;
    }
    // For impressions: collect human-readable names (fall back to id).
    for (const o of hereObjs) {
      if (o.at !== "here") continue;
      const ref = typeof o.id === "string" ? o.id : null;
      if (ref === null || ignored.has(ref)) continue;
      hereItemNames.push(typeof o.name === "string" ? o.name : ref);
    }
  } catch {
    /* leave undefined */
  }

  // Cluster occupants = same-tile + each neighbor's occupants.
  // Mirrors `pollNextStimulus`: a ghost on an adjacent tile is in
  // social range and the LLM should know they exist.
  // We also keep the per-neighbor tileClass + items + occupants so the
  // impression-building pass below can describe where each cluster
  // member was without re-calling look.
  interface NeighborSummary {
    readonly tileId: string;
    readonly tileClass: string | null;
    readonly occupants: ReadonlyArray<string>;
    readonly itemNames: ReadonlyArray<string>;
  }
  const neighborByOccupant = new Map<string, NeighborSummary>();
  let clusterOccupants: Set<string> = new Set(hereOccupants);
  try {
    const around = (await mcp.callTool("look", { at: "around" })) as {
      neighbors?: ReadonlyArray<{
        tileId?: string;
        tileClass?: string;
        occupants?: ReadonlyArray<string>;
        objects?: ReadonlyArray<{ id?: string; name?: string; at?: string }>;
      }>;
    };
    for (const n of around.neighbors ?? []) {
      if (typeof n.tileId !== "string") continue;
      const occupants = (n.occupants ?? []).filter(
        (g): g is string => typeof g === "string" && g !== selfGhostId,
      );
      const itemNames: string[] = [];
      for (const o of n.objects ?? []) {
        const ref = typeof o.id === "string" ? o.id : null;
        if (ref === null || ignored.has(ref)) continue;
        itemNames.push(typeof o.name === "string" ? o.name : ref);
      }
      const summary: NeighborSummary = {
        tileId: n.tileId,
        tileClass: typeof n.tileClass === "string" ? n.tileClass : null,
        occupants,
        itemNames,
      };
      for (const g of occupants) {
        clusterOccupants.add(g);
        neighborByOccupant.set(g, summary);
      }
    }
  } catch {
    /* leave whatever we have from look-here */
  }
  if (clusterOccupants.size > 0 || hereOccupants.length > 0) {
    for (const g of clusterOccupants) void prefetchDisplayName(registryBase, g);
    const pairs = [...clusterOccupants].map((g) => ({
      ghostId: g,
      displayName: resolveDisplayNameSync(registryBase, g),
    }));
    next.nearbyGhostIds = pairs.map((p) => p.displayName);
    next.nearbyGhosts = pairs;

    // Build one impression snippet per cluster occupant. The snippet is
    // the spatial observation only — relative direction + tile class +
    // any items visible on their tile. The gap-to-now ("3 cascades
    // ago") is rendered separately by the Surface prompt's timeline
    // block from the impression's cascade index.
    const impressions: NonNullable<WorldContext["impressions"]>[number][] = [];
    const hereSet = new Set(hereOccupants);
    for (const p of pairs) {
      let snippet: string;
      if (hereSet.has(p.ghostId)) {
        const tile = hereTileClass ?? "tile";
        const items = hereItemNames.length > 0
          ? `, ${formatItemList(hereItemNames)} on the tile`
          : "";
        snippet = `here on a ${tile} tile${items}`;
      } else {
        const neighbor = neighborByOccupant.get(p.ghostId);
        const dir = neighbor ? dirByTileId.get(neighbor.tileId) : undefined;
        const tile = neighbor?.tileClass ?? "tile";
        const items = neighbor && neighbor.itemNames.length > 0
          ? `, ${formatItemList(neighbor.itemNames)} on the tile`
          : "";
        snippet = dir
          ? `to the ${dir} of you, on a ${tile} tile${items}`
          : `nearby on a ${tile} tile${items}`;
      }
      impressions.push({
        observedGhostId: p.ghostId,
        observedDisplayName: p.displayName,
        snippet,
      });
    }
    if (impressions.length > 0) next.impressions = impressions;
  }

  try {
    const inv = (await mcp.callTool("inventory", {})) as {
      objects?: ReadonlyArray<{ itemRef?: string; tokens?: number }>;
    };
    const items = (inv.objects ?? []).filter(
      (o): o is { itemRef: string; tokens?: number } => typeof o.itemRef === "string",
    );
    if (items.length > 0) {
      next.inventoryItemRefs = items.map((o) => o.itemRef);
      const consumables = items.filter((o) => typeof o.tokens === "number" && o.tokens > 0);
      if (consumables.length > 0) {
        next.inventoryConsumables = consumables.map((o) => ({
          itemRef: o.itemRef,
          tokens: o.tokens!,
        }));
      }
    }
  } catch {
    /* leave undefined */
  }

  // Pre-compute bearings to caller-configured points of interest.
  // The substrate has NO built-in targets — the previous hardcoded
  // "Black Bart's Poker Table" entry violated the architectural rule
  // that default peppers must be ignorant of house-specific content.
  // House variants pass their own targets via `opts.bearingTargets`.
  // Iterate sequentially — each call is cheap server-side and
  // parallel calls would race the auth context.
  const bearings: NonNullable<WorldContext["bearings"]>[number][] = [];
  for (const target of bearingTargets) {
    try {
      const r = (await mcp.callTool("nearest", target.spec)) as {
        found?: boolean;
        distance?: number;
        nextStep?: string;
      };
      if (r.found && typeof r.distance === "number") {
        const direction: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw" =
          r.distance === 0
            ? "here"
            : (r.nextStep as "n" | "s" | "ne" | "nw" | "se" | "sw" | undefined) ?? "here";
        bearings.push({ label: target.label, distance: r.distance, direction });
      }
    } catch {
      /* tool may not be registered yet on older world-api builds */
    }
  }
  // Distant-ghost bearing. When the local cluster (this tile + the 6
  // face-adjacent neighbours) has no other ghosts, the substrate calls
  // `look_far` to find the nearest ghost anywhere on the map and adds
  // a "Distant ghost" bearing alongside the configured ones. This
  // mirrors how Food awareness works — we mechanically pre-compute the
  // bearing so the LLM gets the same kind of grounded directional hint
  // for social pull as it does for body-driven pull. Cheap server-side
  // (one BFS); only fires when there's actually no-one nearby.
  if (clusterOccupants.size === 0 && hereOccupants.length === 0) {
    try {
      const r = (await mcp.callTool("look_far", {})) as {
        found?: boolean;
        distance?: number;
        nextStep?: string;
        target?: { ghostId?: string };
      };
      if (r.found && typeof r.distance === "number") {
        const direction: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw" =
          r.distance === 0
            ? "here"
            : (r.nextStep as "n" | "s" | "ne" | "nw" | "se" | "sw" | undefined) ?? "here";
        // Render the bearing as the named person rather than a generic
        // "Distant ghost" — the resolver is the same one used for
        // cluster occupants. Falls back to "Distant ghost" when we
        // genuinely don't have a name for this ghostId yet (the
        // resolver is synchronous + cached; a missing name kicks off
        // a background prefetch so the next cascade will have it).
        const otherId = r.target?.ghostId;
        let label = "Distant ghost";
        if (typeof otherId === "string" && otherId.length > 0) {
          void prefetchDisplayName(registryBase, otherId);
          const resolved = resolveDisplayNameSync(registryBase, otherId);
          if (resolved && resolved !== otherId) label = resolved;
        }
        bearings.push({ label, distance: r.distance, direction });
      }
    } catch {
      /* look_far may not be registered yet on older world-api builds */
    }
  }

  if (bearings.length > 0) next.bearings = bearings;

  return ctx;
}

function formatOutcome(o: ActionOutcome): string {
  if (o.ok) {
    return o.data === undefined ? "ok" : `ok ${JSON.stringify(o.data)}`;
  }
  const reason = o.reason ? ` — ${o.reason}` : "";
  return `DENIED ${o.code}${reason}`;
}

/**
 * Verbose-mode dump: shows what the Id and Surface actually saw and
 * emitted. Useful for understanding why the ghost made the choice it
 * did, not just what it chose.
 */
function printVerbose(record: import("./run-loop.js").RunRecord, tag = "peppers-agent"): void {
  const indent = (s: string): string =>
    s
      .split("\n")
      .map((line) => `[${tag}]   │ ${line}`)
      .join("\n");

  console.info(`[${tag}] ┌── ID ──────────────────────────────────────────────`);
  console.info(`[${tag}] │ User prompt sent to Id:`);
  console.info(indent(record.id.userPrompt));
  console.info(`[${tag}] │`);
  console.info(`[${tag}] │ Raw Id response:`);
  console.info(indent(record.id.raw));
  if (record.id.usage) {
    console.info(
      `[${tag}] │ Tokens: prompt=${record.id.usage.prompt} completion=${record.id.usage.completion}`,
    );
  }
  console.info(`[${tag}] └────────────────────────────────────────────────────`);

  console.info(`[${tag}] ┌── SURFACE ─────────────────────────────────────────`);
  console.info(`[${tag}] │ User prompt sent to Surface:`);
  console.info(indent(record.surface.userPrompt));
  console.info(`[${tag}] │`);
  console.info(`[${tag}] │ Raw Surface response:`);
  console.info(indent(record.surface.raw));
  if (record.surface.usage) {
    console.info(
      `[${tag}] │ Tokens: prompt=${record.surface.usage.prompt} completion=${record.surface.usage.completion}`,
    );
  }
  console.info(`[${tag}] └────────────────────────────────────────────────────`);

  console.info(`[${tag}] super-objective: ${record.id.superObjective}`);
  console.info(`[${tag}] action: ${JSON.stringify(record.action)}`);
  console.info(`[${tag}] outcome: ${formatOutcome(record.outcome)}`);
  for (const a of record.applied) {
    console.info(
      `[${tag}]   ${a.facet}.${a.axis} ${a.direction} (${a.beforeDisplay.toFixed(2)} → ${a.afterDisplay.toFixed(2)})`,
    );
  }
}

function printPersonality(p: PersonalityState, tag = "peppers-agent"): void {
  for (const facet of STARTER_FACETS) {
    const t = p[facet];
    const i = toDisplay(t.internal).toFixed(2);
    const e = toDisplay(t.external).toFixed(2);
    console.info(`[${tag}]   ${facet.padEnd(18)} I=${i}  E=${e}`);
  }
}

/**
 * One-shot dump of the static system prompts each LLM call gets.
 * These never change between cascades, so we print them once at
 * startup in verbose mode rather than per-cascade.
 */
function printSystemPrompts(tag = "peppers-agent"): void {
  const indent = (s: string): string =>
    s
      .split("\n")
      .map((line) => `[${tag}]   │ ${line}`)
      .join("\n");

  console.info(`\n[${tag}] ╔══ ID system prompt (static; sent every cascade) ══════════`);
  console.info(indent(ID_SYSTEM_PROMPT));
  console.info(`[${tag}] ╚════════════════════════════════════════════════════════════`);

  console.info(`\n[${tag}] ╔══ SURFACE system prompt (static; sent every cascade) ═════`);
  console.info(indent(SURFACE_SYSTEM_PROMPT));
  console.info(`[${tag}] ╚════════════════════════════════════════════════════════════\n`);
}

function describeStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return `${s.from} says: "${s.text}"`;
    case "cluster-entered":
      return `cluster-entered (${s.ghostIds.join(", ")})`;
    case "cluster-left":
      return `cluster-left (${s.ghostIds.join(", ")})`;
    case "mcguffin-in-view":
      return `${s.itemRef} in view at ${s.at}`;
    case "tile-entered":
      return `entered ${s.tileClass}`;
    case "idle":
      return `idle (${Math.round(s.quietForMs / 1000)}s)`;
    case "primal":
      return `primal (${s.need} ${s.direction}, urgency ${s.urgency.toFixed(2)})`;
  }
}

// Re-export for embedding in custom drivers.
export { samplePersonality };
