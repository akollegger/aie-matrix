/**
 * Top-level live ghost-house orchestrator.
 *
 * Registers with the running combined server, adopts one ghost,
 * connects to the world-api MCP, and drives a bounded stimulus loop:
 * each tick polls the world, runs a cascade if there's something to
 * react to, executes the Surface action against the real world.
 *
 * Stops on Ctrl+C, on max-stimuli-reached, or if `bye` was the
 * last action issued.
 */

import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

import {
  midpointPersonality,
  samplePersonality,
  STARTER_FACETS,
  toDisplay,
  type ActionOutcome,
  type PersonalityState,
  type Stimulus,
} from "@aie-matrix/ghost-peppers-inner";

import {
  connectMemory,
  type MemoryConnection,
} from "@aie-matrix/ghost-peppers-mem";

import { startOverlayServer, type OverlayServer } from "./overlay-server.js";
import { ID_SYSTEM_PROMPT } from "./reason-id.js";
import { runOneStimulus } from "./run-loop.js";
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
   * If set, starts an HTTP/SSE server on this port that powers the
   * overlay UI at `http://127.0.0.1:<port>/`. Disabled by default.
   */
  readonly overlayPort?: number;
  /**
   * If set on the ghost that owns the hub, exposes a `/all` route
   * that grids every listed port in iframes. Pass the full per-ghost
   * port list (including this ghost's own port) to ONE ghost in
   * multi-ghost mode so the user can watch every ghost from one tab.
   */
  readonly overlayPeerPorts?: ReadonlyArray<number>;
  /**
   * Optional log-line prefix label, e.g. `"#0"` or `"#1"` when running
   * multiple peppers ghosts in parallel. When set, log lines read
   * `[peppers-house #0] …` instead of `[peppers-house] …`.
   */
  readonly label?: string;
  /**
   * Pre-registered ghost-house id. When running multiple peppers
   * ghosts in one process, register the house ONCE in the CLI and pass
   * the same id to all `runHouse` calls — otherwise ghosts can't read
   * each other's conversation messages (the conversation router only
   * allows cross-thread reads within a single house).
   */
  readonly preRegisteredHouseId?: string;
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
  const overlayPort = opts.overlayPort;
  const tag = opts.label ? `peppers-house ${opts.label}` : "peppers-house";
  const log = (msg: string): void => console.info(`[${tag}] ${msg}`);
  const warn = (msg: string, err?: unknown): void =>
    console.warn(`[${tag}] ${msg}`, err ?? "");

  let stopRequested = false;
  const stop = (): void => {
    stopRequested = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // 1. Register + adopt. If the CLI pre-registered a shared house
  //    (multi-ghost mode), adopt under it; otherwise register a fresh
  //    house ourselves (single-ghost mode).
  const adopted: AdoptedGhost = await (opts.preRegisteredHouseId !== undefined
    ? (() => {
        log(`adopting under shared house ${opts.preRegisteredHouseId} …`);
        return adoptUnderHouse({
          registryBase: opts.registryBase,
          ghostHouseId: opts.preRegisteredHouseId,
        });
      })()
    : (() => {
        log(`registering with ${opts.registryBase} …`);
        return registerAndAdopt({ registryBase: opts.registryBase });
      })());
  log(`adopted ghost=${adopted.ghostId} (caretaker=${adopted.caretakerId})`);

  // 2. Open MCP world connection.
  const mcp = new GhostMcpClient({
    worldApiBaseUrl: adopted.worldApiBaseUrl,
    token: adopted.token,
  });
  await mcp.connect();
  const executeAction = executeViaMcp(mcp);

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
    adopted.ghostHouseId,
    tag,
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
  const SOCIAL_ANCHOR_DURATION = 4;
  // Tracks which peers we saw last cascade so we can detect first-sighting
  // transitions (peer appears in look-around when we hadn't seen them before)
  // and re-arm the anchor — covers ghosts that started already-clustered
  // and so never received a `cluster-entered` event.
  let lastNearbyGhosts: Set<string> = new Set();
  const startedAt = new Date().toISOString();

  // Optional overlay server. Started after we have a ghost id and
  // initial state so its `init` event has real data to send.
  let overlay: OverlayServer | null = null;
  if (overlayPort !== undefined) {
    overlay = await startOverlayServer({
      port: overlayPort,
      getInit: () => ({
        ghostId: adopted.ghostId,
        objective: objective ?? null,
        personality: personalityForUi(state),
        startedAt,
      }),
      peerPorts: opts.overlayPeerPorts,
    });
  }

  try {
    // Note: we used to exit the loop when the Surface picked `bye`, but
    // the LLM picks it spuriously (no actual conversation to exit) and
    // killed long demos. Now `bye` is just an action like any other —
    // the world-api handles it, the loop continues until Ctrl+C or
    // maxStimuli.
    while (!stopRequested && stimuliRun < maxStimuli) {
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
      const snapshot = await snapshotWorldContext(mcp, adopted.ghostId);

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
        });
        state = record.nextState;
        if (overlay !== null) {
          overlay.broadcast("cascade", buildCascadePayload(record, state, worldContext, ctx, objective));
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

        // Update conversational-mode mirror from this cascade's action +
        // outcome + stimulus.
        if (record.action.kind === "say" && record.outcome.ok) {
          inConversationalMode = true;
          turnsSinceLastSayWithNoReply = 0;
        } else if (record.action.kind === "bye" && record.outcome.ok) {
          inConversationalMode = false;
          turnsSinceLastSayWithNoReply = 0;
        } else if (
          record.outcome.ok === false &&
          record.outcome.code === "IN_CONVERSATION"
        ) {
          // World told us we're locked even though our local mirror said
          // otherwise. Trust the world.
          inConversationalMode = true;
        } else if (record.stimulus.kind === "utterance") {
          // A reply came in — conversation is active, reset patience and
          // re-arm the anchor so we keep the conversation going.
          turnsSinceLastSayWithNoReply = 0;
          socialAnchorTurnsLeft = SOCIAL_ANCHOR_DURATION;
        } else if (inConversationalMode) {
          // We're waiting in conversation but nothing happened this
          // turn — patience clock ticks.
          turnsSinceLastSayWithNoReply++;
        }

        // Tick down the social anchor each cascade; cluster-entered
        // and incoming utterance re-arm it above.
        if (socialAnchorTurnsLeft > 0) socialAnchorTurnsLeft--;
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
    if (overlay !== null) {
      try {
        await overlay.close();
      } catch {
        /* ignore */
      }
    }
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
  worldContext: WorldContext,
  ctx: StimulusContext,
  objective: string | undefined,
): unknown {
  return {
    ghostId: record.ghostId,
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
    personality: personalityForUi(nextState),
    worldContext: {
      exits: worldContext.availableExits ?? null,
      nearbyGhosts: worldContext.nearbyGhostIds ?? null,
      itemsHere: worldContext.takeableItemRefs ?? null,
      inventory: worldContext.inventoryItemRefs ?? null,
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
function shortenGhostId(id: string): string {
  return id.length > 8 ? `ghost_${id.slice(0, 8)}` : id;
}

async function snapshotWorldContext(
  mcp: GhostMcpClient,
  selfGhostId: string,
): Promise<WorldContext> {
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
      .map((o) => o.id as string);
    if (hereItems.length > 0) next.takeableItemRefs = hereItems;
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
    next.nearbyGhostIds = [...clusterOccupants].map(shortenGhostId);
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
function printVerbose(record: import("./run-loop.js").RunRecord, tag = "peppers-house"): void {
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

function printPersonality(p: PersonalityState, tag = "peppers-house"): void {
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
function printSystemPrompts(tag = "peppers-house"): void {
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
