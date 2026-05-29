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
  midpointNeeds,
  midpointPersonality,
  samplePersonality,
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
  type MemoryConnection,
} from "@aie-matrix/ghost-peppers-mem";

import { captureRecord } from "./debug-capture.js";
import type { OverlayServer } from "./overlay-server.js";
import { ID_SYSTEM_PROMPT } from "./reason-id.js";
import { runOneStimulus } from "./run-loop.js";
import {
  prefetchDisplayName,
  primeDisplayName,
  resolveDisplayNameSync,
} from "./runtime/name-resolver.js";
import { SURFACE_SYSTEM_PROMPT, type WorldContext } from "./reason-surface.js";
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
  readonly memoryConnection: MemoryConnection;
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
export async function runHouse(opts: RunHouseOptions): Promise<void> {
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
  const memoryHandle = await connectMemory({ connection: opts.memoryConnection });

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
        // After K silent polls, emit an idle stimulus so the ghost has
        // something to react to. Otherwise just wait and re-poll.
        if (consecutiveQuietTicks >= idleStimulusEveryK) {
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

      try {
        const record = await runOneStimulus({
          memoryHandle,
          ghostId: adopted.ghostId,
          state,
          stimulus,
          executeAction,
          worldContext,
          objective,
          tools,
          commitmentLedger,
          cascadeIndex,
          needs,
          primalStreaks,
          ...(selfDisplayName ? { selfDisplayName } : {}),
          ...(recentSuperObjectives.length > 0
            ? { recentSuperObjectives }
            : {}),
        });
        commitmentLedger = record.nextLedger;
        needs = record.nextNeeds;
        primalStreaks = record.nextPrimalStreaks;
        // Persist back to the caller so pause/resume can resume at the
        // same need / ledger level and with accumulated drift. The
        // callbacks are expected to do synchronous assignments (e.g.
        // `ghost.needs = n`). Personality update fires below after
        // `state = record.nextState`.
        opts.onNeedsUpdate?.(needs);
        opts.onCommitmentsUpdate?.(commitmentLedger);
        opts.onPrimalStreaksUpdate?.(primalStreaks);
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
        // Per-cascade need diagnostic — keeps the terminal honest about
        // where the sliders actually are. Helpful for verifying
        // depletion is working even when the overlay isn't open.
        log(
          `needs: Fuel=${fuelDisplay.toFixed(2)} Coh=${cohDisplay.toFixed(2)} Rest=${restDisplay.toFixed(2)}` +
            (record.id.primalDrive
              ? ` · DRIVE: ${record.id.primalDrive.need} ${record.id.primalDrive.direction} (urgency ${record.id.primalDrive.urgency.toFixed(2)})`
              : ""),
        );
        if (fuelDisplay <= 0) {
          // True mortality: Fuel has hit the floor. With linear
          // depletion clamped at 0, this fires the cascade after Fuel
          // reaches exactly 0.00 — not earlier. The previous `< 1.0`
          // test was a holdover from sigmoid-era Fuel that never
          // actually reached 0; with linear math, that test killed
          // ghosts a full cascade before they were actually empty.
          //
          // Banner-style multi-line log — easy to spot in a stream of
          // 6 ghosts' cascade output. The 💀 line alone gets buried.
          log("");
          log("╔════════════════════════════════════════════════════════════╗");
          log(`║ 💀 DECOMMISSIONED: ${selfDisplayName ?? adopted.ghostId.slice(0, 8)}`);
          log(`║    Fuel ${fuelDisplay.toFixed(2)} — out of energy`);
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
              atIso: new Date().toISOString(),
            });
          }
          captureRecord("decommissioned", {
            ghostId: adopted.ghostId,
            displayName: selfDisplayName ?? null,
            cascadeIndex,
            cause: "fuel-critical",
            fuelDisplay,
          });
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
      } catch (err) {
        warn("cascade failed:", err);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  try {
    const exits = (await mcp.callTool("exits", {})) as {
      exits?: ReadonlyArray<{ toward?: string }>;
    };
    next.availableExits = (exits.exits ?? [])
      .map((e) => e.toward)
      .filter((t): t is string => typeof t === "string");
  } catch {
    /* leave undefined */
  }

  // Same-tile occupants and items
  let hereOccupants: string[] = [];
  try {
    const look = (await mcp.callTool("look", { at: "here" })) as {
      occupants?: ReadonlyArray<string>;
      objects?: ReadonlyArray<{ id?: string; at?: string }>;
    };
    if (Array.isArray(look.occupants)) {
      hereOccupants = look.occupants.filter(
        (g): g is string => typeof g === "string" && g !== selfGhostId,
      );
    }
    const hereItems = (look.objects ?? [])
      .filter((o) => o.at === "here" && typeof o.id === "string")
      .map((o) => o.id as string)
      .filter((ref) => !ignored.has(ref));
    if (hereItems.length > 0) {
      next.takeableItemRefs = hereItems;
    }
  } catch {
    /* leave undefined */
  }

  // Cluster occupants = same-tile + each neighbor's occupants.
  // Mirrors `pollNextStimulus`: a ghost on an adjacent tile is in
  // social range and the LLM should know they exist.
  let clusterOccupants: Set<string> = new Set(hereOccupants);
  try {
    const around = (await mcp.callTool("look", { at: "around" })) as {
      neighbors?: ReadonlyArray<{ occupants?: ReadonlyArray<string> }>;
    };
    for (const n of around.neighbors ?? []) {
      for (const g of n.occupants ?? []) {
        if (typeof g === "string" && g !== selfGhostId) {
          clusterOccupants.add(g);
        }
      }
    }
  } catch {
    /* leave whatever we have from look-here */
  }
  if (clusterOccupants.size > 0 || hereOccupants.length > 0) {
    for (const g of clusterOccupants) void prefetchDisplayName(registryBase, g);
    next.nearbyGhostIds = [...clusterOccupants].map((g) =>
      resolveDisplayNameSync(registryBase, g),
    );
  }

  try {
    const inv = (await mcp.callTool("inventory", {})) as {
      objects?: ReadonlyArray<{ itemRef?: string }>;
    };
    const refs = (inv.objects ?? [])
      .map((o) => o.itemRef)
      .filter((r): r is string => typeof r === "string");
    if (refs.length > 0) next.inventoryItemRefs = refs;
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
  }
}

// Re-export for embedding in custom drivers.
export { samplePersonality };
