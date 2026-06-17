/**
 * Peppers-agent A2A executor.
 *
 * Handles four message kinds:
 *   - aie-matrix.agent-host.spawn-context.v1  → start the social cascade
 *   - aie-matrix.platform.encounter.v1         → encounter brain (accept/decline)
 *   - aie-matrix.peppers.pause.v1              → halt the social cascade
 *   - aie-matrix.peppers.resume.v1             → restart the social cascade
 *
 * Schemas after spawn-context are part of the Barnacle Protocol (RFC-0019).
 * Pause/resume are idempotent and ghostId-scoped — the supervisor calls
 * them when handing off to or back from a mini-game session.
 */
import { randomUUID } from "node:crypto";
import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import {
  STARTER_FACETS,
  fromDisplay,
  midpointNeeds,
  midpointPersonality,
  samplePersonality,
  type CommitmentLedger,
  type FacetName,
  type NeedProfile,
  type PersonalityState,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";
import { captureRecord } from "./debug-capture.js";
import { decideEncounter } from "./encounter-brain.js";
import { startOverlayServer, type OverlayServer } from "./overlay-server.js";
import { runHouse, type RunHouseOutcome } from "./run-house.js";
import { carryKarmicSkillsFromEnv, recordKarmicLessonFromEnv, seedKarmicSkillFromEnv } from "@aie-matrix/ghost-peppers-sleep";
import {
  PEPPERS_PAUSE_SCHEMA,
  PEPPERS_RESUME_SCHEMA,
  PLATFORM_ENCOUNTER_SCHEMA,
  type PeppersPause,
  type PeppersResume,
  type PlatformEncounter,
  type SpawnContext,
} from "./spawn-types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}; check .env at repo root`);
  return v;
}

// ──────────────────────────────────────────────────────────────────
// Extreme-personality cycle override.
//
// Enabled by `PEPPERS_BIRTH_EXTREME=cycle`. The first four ghosts to
// spawn get pinned to the four corners of (internal × external) with
// every facet jammed to that corner; subsequent ghosts wrap around.
//   ghost #0  → high internal, high external   (full felt, full performed)
//   ghost #1  → high internal, low  external   (felt suppressed)
//   ghost #2  → low  internal, high external   (performed without feeling)
//   ghost #3  → low  internal, low  external   (nothing felt, nothing performed)
// Used for diagnostic runs to see whether the slider-driven character
// archetype actually punches through into voice.

type ExtremeCorner = "hh" | "hl" | "lh" | "ll";
const EXTREME_CYCLE: ExtremeCorner[] = ["hh", "hl", "lh", "ll"];
let extremeCursor = 0;

function buildExtremePersonality(corner: ExtremeCorner): PersonalityState {
  // `fromDisplay` requires display values in the OPEN interval (0, 10),
  // so we use 9.5 / 0.5 — well above and below the level-3 binner's
  // 6.5 / 3.5 thresholds, putting every facet into the "high" or "low"
  // corner reliably.
  const internalDisplay = corner[0] === "h" ? 9.5 : 0.5;
  const externalDisplay = corner[1] === "h" ? 9.5 : 0.5;
  const trait: TraitState = {
    internal: fromDisplay(internalDisplay),
    external: fromDisplay(externalDisplay),
  };
  const entries = STARTER_FACETS.map((f) => [f, trait] as const);
  return Object.fromEntries(entries) as Record<FacetName, TraitState>;
}

function nextExtremePersonality(): { personality: PersonalityState; corner: ExtremeCorner } {
  const corner = EXTREME_CYCLE[extremeCursor % EXTREME_CYCLE.length]!;
  extremeCursor++;
  return { personality: buildExtremePersonality(corner), corner };
}

/**
 * Item refs the default peppers ghost is BLIND to. Read once at module
 * load from `PEPPERS_IGNORED_ITEM_REFS` (comma-separated). Default
 * empty — the substrate has no built-in knowledge of any specific
 * item class. When running the demo against a world that contains
 * house-specific platform items (e.g. `PokerTable` from the RDC
 * server), set `PEPPERS_IGNORED_ITEM_REFS=PokerTable` so the
 * substrate filters them out of perception entirely.
 *
 * The proper fix lives at the world-api: items should be tagged with
 * their owning house and filtered per-ghost based on engagement
 * config. Until that lands, this env var is the substrate-side
 * blindfold.
 */
const DEFAULT_IGNORED_ITEM_REFS: ReadonlyArray<string> = (() => {
  const raw = process.env.PEPPERS_IGNORED_ITEM_REFS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
})();
if (DEFAULT_IGNORED_ITEM_REFS.length > 0) {
  console.info(
    `[peppers-agent] PEPPERS_IGNORED_ITEM_REFS=${DEFAULT_IGNORED_ITEM_REFS.join(",")} — substrate is blind to these item refs`,
  );
}

/**
 * Item classes the substrate should auto-compute bearings to every
 * cascade. Read from `PEPPERS_BEARING_ITEM_CLASSES` (comma-separated;
 * legacy alias: `PEPPERS_FORAGE_ITEM_REFS`). Each entry becomes a
 * `nearest` MCP call per cascade whose result lands in
 * `worldContext.bearings`, giving the ghost a directional pointer to
 * the class — useful for navigation toward food (or any other class
 * the house wants surfaced).
 *
 * Nutrition is NOT decided here. The world's `tokens` field on the
 * ItemDefinition decides whether something restores Fuel and by how
 * much; the substrate just applies what the world's `consume` outcome
 * reports.
 */
const DEFAULT_BEARING_ITEM_CLASSES: ReadonlyArray<string> = (() => {
  const raw =
    process.env.PEPPERS_BEARING_ITEM_CLASSES ?? process.env.PEPPERS_FORAGE_ITEM_REFS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
})();
if (DEFAULT_BEARING_ITEM_CLASSES.length > 0) {
  console.info(
    `[peppers-agent] bearing hints: ${DEFAULT_BEARING_ITEM_CLASSES.join(",")} — substrate computes a nearest-bearing for each class per cascade`,
  );
}

/**
 * Sleep experiment (Step E/F): PEPPERS_SLEEP_AT_CASCADE schedules a
 * BLACKOUT for exactly one ghost per process — the
 * PEPPERS_SLEEP_GHOST_INDEX-th distinct ghost to spawn (default 0).
 * Index assignment is by FIRST spawn per ghostId so a pause/resume
 * cycle can't reassign the subject mid-experiment.
 */
const SLEEP_AT_CASCADE: number | undefined = (() => {
  const raw = process.env.PEPPERS_SLEEP_AT_CASCADE;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`[peppers-agent] ignoring invalid PEPPERS_SLEEP_AT_CASCADE=${raw}`);
    return undefined;
  }
  return n;
})();
const SLEEP_GHOST_INDEX = Number(process.env.PEPPERS_SLEEP_GHOST_INDEX ?? "0");
const spawnOrderByGhostId = new Map<string, number>();

function resolveSleepAtCascade(ghostId: string): number | undefined {
  if (SLEEP_AT_CASCADE === undefined) return undefined;
  let order = spawnOrderByGhostId.get(ghostId);
  if (order === undefined) {
    order = spawnOrderByGhostId.size;
    spawnOrderByGhostId.set(ghostId, order);
  }
  if (order !== SLEEP_GHOST_INDEX) return undefined;
  console.info(
    `[peppers-agent] sleep experiment: ghost ${ghostId.slice(0, 8)}… (spawn #${order}) blacks out at cascade ${SLEEP_AT_CASCADE}`,
  );
  return SLEEP_AT_CASCADE;
}

/**
 * The default peppers ghost's standing surface objective. Read by the
 * cascade runner (to thread into every Id + Surface call) and by the
 * encounter brain when one is active.
 *
 * Peppers is the GENERIC ghost substrate. It must not be aware of any
 * specific ghost-house's content (no poker, no saloons, no Black
 * Bart's). House-flavoured variants (the future RDC-peppers, HP-
 * peppers, etc.) layer their thematic objective ON TOP of this base
 * via the `PEPPERS_OBJECTIVE` env override or by spawning with a
 * house-specific objective in the spawn context.
 *
 * Override with PEPPERS_OBJECTIVE for theming the demo.
 */
export function resolveBaseObjective(): string {
  return (
    process.env.PEPPERS_OBJECTIVE ??
    "You are a ghost in a world. Wander, observe, and notice what's around you. When another ghost is in your cluster, speak to them — exchange names, find common ground, share what's interesting. The world has things to discover; you have a self to express. Move with curiosity, rest when you need to, and tend to your body. Food is sold for gold at vending machines placed around the venue — they aren't everywhere, so when your body needs sustenance the `nearest` tool can point you toward one."
  );
}

function detectSchema(msg: Message | undefined): string | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (typeof d.schema === "string") return d.schema;
    }
  }
  return null;
}

function findDataPart<T extends { schema: string }>(
  msg: Message | undefined,
  schema: string,
): T | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === schema) return d as unknown as T;
    }
  }
  return null;
}

function publishStatus(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  state: TaskStatusUpdateEvent["status"]["state"],
  final: boolean,
): void {
  const ev: TaskStatusUpdateEvent = {
    kind: "status-update",
    taskId,
    contextId,
    final,
    status: { state, timestamp: new Date().toISOString() },
  };
  eventBus.publish(ev);
}

function completeWithArtifact(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  data: Record<string, unknown>,
): void {
  const final: TaskStatusUpdateEvent = {
    kind: "status-update",
    taskId,
    contextId,
    final: true,
    status: {
      state: "completed",
      timestamp: new Date().toISOString(),
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        parts: [{ kind: "data", data }],
        contextId,
        taskId,
      },
    },
  };
  eventBus.publish(final);
  eventBus.finished();
}

/** Per-ghost state the executor remembers across A2A calls. Needed so
 *  resume can restart the cascade with the same identity, and encounter
 *  can derive a brain decision from the ghost's personality. */
interface PeppersGhostState {
  readonly spawnContext: SpawnContext;
  /** Birth personality snapshot — the starting point from which drift
   *  accumulates. Held as a constant for the encounter brain (which
   *  doesn't get to see drift) and as the fallback for the cascade
   *  runner when no live state has been recorded yet. */
  readonly initialPersonality: PersonalityState;
  /** Current accumulated personality (drift + birth). Survives
   *  pause/resume cycles so a ghost that evolved over many cascades
   *  doesn't snap back to birth on every Barnacle handoff. */
  personality: PersonalityState;
  /** Current primal-need state. Survives pause/resume cycles so a
   *  ghost that nearly starved before a Barnacle handoff comes back
   *  hungry, not satiated. */
  needs: NeedProfile;
  /** Open self-debts the inner voice has minted but not yet paid down.
   *  Survives pause/resume cycles so commitments persist across
   *  Barnacle handoffs. */
  commitmentLedger: CommitmentLedger;
  /** Per-edge signed streak counters for the primal→personality
   *  wiring. Survives pause/resume so a ghost's accumulated stress
   *  (or windfall) doesn't reset mid-life. */
  primalStreaks: import("@aie-matrix/ghost-peppers-inner").PrimalPersonalityStreaks;
  /** Accumulated metabolic strain from chronic overeating. Decommissions
   *  the ghost with cause "metabolic-collapse" when it crosses the
   *  threshold — distinct from acute Fuel=0 death. Survives pause/resume. */
  metabolicStrain: number;
  /** The set of platform-tile classes this ghost variant engages with.
   *  Empty for default peppers — they are blind to mini-games of any
   *  kind. House-flavoured variants populate this (e.g. an RDC-peppers
   *  variant would include "PokerTable"). The encounter handler
   *  short-circuits to decline for any platform class not in this set,
   *  with no LLM call and no Barnacle pause. This is the structural
   *  rule that keeps the substrate ignorant of house-specific content. */
  readonly engagedPlatformClasses: ReadonlyArray<string>;
  /** Running cascade's abort controller. Aborted on pause / re-spawn. */
  socialAbort?: AbortController;
  /** taskId that owns the current social cascade. */
  socialTaskId?: string;
}

const ghosts = new Map<string, PeppersGhostState>();

/** taskId → { ac, ghostId, contextId } — used by cancelTask to stop the loop. */
const taskLoops = new Map<string, { ac: AbortController; ghostId: string; contextId: string }>();

/**
 * Per-ghost overlay port allocator. Enabled by setting
 * `PEPPERS_OVERLAY_BASE_PORT` (e.g. 4100); each spawn gets the next
 * free port. The first spawn lands on the base, the second on base+1,
 * etc. Tracked across the process so re-spawn (pause/resume) reuses
 * the previously-allocated port for the same ghostId.
 */
const overlayPortByGhostId = new Map<string, number>();
function allocateOverlayPort(ghostId: string): number | undefined {
  const baseRaw = process.env.PEPPERS_OVERLAY_BASE_PORT;
  if (!baseRaw) return undefined;
  const base = parseInt(baseRaw, 10);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const existing = overlayPortByGhostId.get(ghostId);
  if (existing !== undefined) return existing;
  const port = base + overlayPortByGhostId.size;
  overlayPortByGhostId.set(ghostId, port);
  return port;
}

/**
 * Per-ghost overlay server cache. The overlay outlives any individual
 * cascade run — Barnacle pause/resume must NOT tear down the spectator
 * UI, otherwise the `/all` hub would fill with refused-connection
 * iframes the moment ghosts start mini-game sessions.
 */
const overlayByGhostId = new Map<string, OverlayServer>();

async function ensureOverlay(
  ghostId: string,
  port: number,
  peerPorts: ReadonlyArray<number>,
): Promise<OverlayServer | null> {
  const existing = overlayByGhostId.get(ghostId);
  if (existing !== undefined) return existing;
  try {
    const server = await startOverlayServer({
      port,
      // Placeholder init — runHouse calls setInit() at the top of each
      // cascade run with a fresh closure over current state.
      getInit: () => ({ ghostId, displayName: null, personality: [], startedAt: new Date().toISOString() }),
      peerPorts,
    });
    overlayByGhostId.set(ghostId, server);
    return server;
  } catch (err) {
    console.warn(
      JSON.stringify({
        kind: "peppers-agent.overlay-start-failed",
        ghostId,
        port,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

async function postJson(
  url: string,
  body: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

const REBIRTH_FIRST = [
  "Ash", "Bow", "Cinder", "Dawn", "Echo", "Fable", "Glint", "Haze",
  "Iris", "Juno", "Kestrel", "Lark", "Moss", "Nim", "Onyx", "Pip",
];
const REBIRTH_LAST = [
  "Vale", "Wren", "Quill", "Reed", "Sol", "Tide", "Vesper", "Wisp",
];
function freshSoulName(): string {
  const a = REBIRTH_FIRST[Math.floor(Math.random() * REBIRTH_FIRST.length)]!;
  const b = REBIRTH_LAST[Math.floor(Math.random() * REBIRTH_LAST.length)]!;
  return `${a} ${b}`;
}

/**
 * Reincarnation. A ghost that DIED distilled its life to one karmic word
 * (in run-house). Here the executor closes the cycle: adopt a brand-new
 * ghostId (a fresh memory scope — the prior life's memories are never
 * loaded), record the karmic word + PREVIOUS_LIFE lineage against the new
 * id, then spawn it via the agent-host. The new life arrives as a fresh
 * A2A task, is born at a Cosmic Elevator (Tier-3 placement), and reads
 * only its one inherited word. Best-effort: a failure just ends the line.
 */
async function reincarnate(
  previousGhostId: string,
  registryBase: string,
  outcome: RunHouseOutcome,
): Promise<void> {
  const agentHostUrl = (process.env.AGENT_HOST_URL ?? "").replace(/\/$/, "");
  const token = process.env.AGENT_HOST_TOKEN ?? "";
  const agentId =
    process.env.PEPPERS_AGENT_ID ?? process.env.HOSTNAME ?? "peppers-agent";
  if (!agentHostUrl || !token || !registryBase) {
    console.warn(
      JSON.stringify({ kind: "peppers-agent.reincarnate-skipped", reason: "missing host/registry config" }),
    );
    return;
  }
  try {
    const houseId = (await postJson(`${registryBase}/registry/houses`, { displayName: "samsara" }))["agentHostId"] as string;
    const caretakerId = (await postJson(`${registryBase}/registry/caretakers`, { label: "rebirth" }))["caretakerId"] as string;
    const name = freshSoulName();
    const adopt = await postJson(`${registryBase}/registry/adopt`, {
      caretakerId,
      agentHostId: houseId,
      displayName: name,
    });
    const newGhostId = adopt["ghostId"] as string;
    const credential = adopt["credential"];
    // Carry the one word + lineage onto the NEW id BEFORE it spawns, so its
    // first cascade's startup load finds the karmic seed.
    if (outcome.karmicWord) {
      await recordKarmicLessonFromEnv({
        ghostId: newGhostId,
        previousGhostId,
        word: outcome.karmicWord,
        reflection: outcome.reflection ?? "",
        deathCause: outcome.deathCause ?? "unknown",
      });
    }
    // The corrective skill — the actionable inheritance. Seed it against the
    // NEW id BEFORE spawn so the first cascade's SkillRecall load finds it.
    // Best-effort: a failed seed just means a less-prepared life, not a dead
    // line, so it never blocks the spawn below.
    if (outcome.karmicSkill) {
      try {
        const skillId = await seedKarmicSkillFromEnv({
          ghostId: newGhostId,
          procedureJson: outcome.karmicSkill.procedureJson,
          triggerSummary: outcome.karmicSkill.triggerSummary,
        });
        console.info(
          JSON.stringify({
            kind: "peppers-agent.karmic-skill-seeded",
            newGhostId,
            skillId,
            trigger: outcome.karmicSkill.triggerSummary,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            kind: "peppers-agent.karmic-skill-seed-failed",
            newGhostId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    // Carry the WHOLE lineage's karmic skills forward, not just this death's.
    // The predecessor already holds every ancestor's karmic skill, so copying
    // its full set onto the new id accumulates the lineage's know-how down the
    // chain. Runs regardless of whether this death produced a new skill.
    try {
      const carried = await carryKarmicSkillsFromEnv(previousGhostId, newGhostId);
      console.info(
        JSON.stringify({ kind: "peppers-agent.karmic-skills-carried", previousGhostId, newGhostId, carried }),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          kind: "peppers-agent.karmic-skills-carry-failed",
          newGhostId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    await postJson(
      `${agentHostUrl}/v1/sessions/spawn/${agentId}`,
      { ghostId: newGhostId, credential, displayName: name },
      token,
    );
    console.info(
      JSON.stringify({
        kind: "peppers-agent.reincarnated",
        previousGhostId,
        newGhostId,
        newName: name,
        karmicWord: outcome.karmicWord ?? null,
        deathCause: outcome.deathCause ?? null,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        kind: "peppers-agent.reincarnate-failed",
        previousGhostId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Start (or restart) the social cascade for a ghost. The supervisor's
 *  pause/resume cycle reuses this. Returns the AbortController so callers
 *  can wire status events to its completion. */
function startSocialLoop(
  ghost: PeppersGhostState,
  taskId: string,
  contextId: string,
  eventBus: ExecutionEventBus,
  options: { narrative?: string } = {},
): AbortController {
  // Abort any prior loop for this ghost.
  ghost.socialAbort?.abort();
  const ac = new AbortController();
  ghost.socialAbort = ac;
  ghost.socialTaskId = taskId;
  taskLoops.set(taskId, { ac, ghostId: ghost.spawnContext.ghostId, contextId });

  // Memory transport: production uses the shared agent-memory SSE service
  // (PEPPERS_MEMORY_MCP_URL); local dev falls back to spawning the uvx
  // subprocess, which needs the Neo4j creds.
  const memoryServiceUrl = process.env.PEPPERS_MEMORY_MCP_URL;
  const memoryConnection =
    memoryServiceUrl !== undefined && memoryServiceUrl.length > 0
      ? undefined
      : {
          uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
          username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
          password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
          database: process.env.GHOST_MINDS_NEO4J_DATABASE,
        };

  const baseObjective = resolveBaseObjective();
  // Prepend any narrative from a just-ended mini-game session, so the
  // cascade frames its next moves in light of what just happened.
  const objective = options.narrative
    ? `[Recent: ${options.narrative}]\n\n${baseObjective}`
    : baseObjective;

  const overlayPort = allocateOverlayPort(ghost.spawnContext.ghostId);
  /**
   * God's-eye view: every overlay serves a `/all` route that iframes the
   * peer ports listed here. Set `PEPPERS_OVERLAY_PEER_PORTS=4100,4101,
   * 4102,4103` to enable; with N expected ghosts the demo pre-computes
   * the full list so any tab can serve the hub.
   */
  const peerPortsRaw = process.env.PEPPERS_OVERLAY_PEER_PORTS;
  const overlayPeerPorts: number[] = peerPortsRaw
    ? peerPortsRaw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (overlayPort !== undefined) {
    console.info(
      JSON.stringify({
        kind: "peppers-agent.overlay-port-assigned",
        ghostId: ghost.spawnContext.ghostId,
        url: `http://127.0.0.1:${overlayPort}/`,
        ...(overlayPeerPorts.length > 1
          ? { hubUrl: `http://127.0.0.1:${overlayPort}/all` }
          : {}),
      }),
    );
  }

  // Sleep experiment wiring (Step E/F): PEPPERS_SLEEP_AT_CASCADE=N puts
  // exactly one ghost — the PEPPERS_SLEEP_GHOST_INDEX-th distinct ghost
  // to spawn (default 0) — into a scheduled BLACKOUT at cascade N. All
  // other ghosts in the run are controls. Index is assigned on FIRST
  // spawn per ghostId so pause/resume doesn't shift who the subject is.
  const sleepAtForThisGhost = resolveSleepAtCascade(ghost.spawnContext.ghostId);

  void (async () => {
    // Resolve (or lazily start) the per-ghost overlay BEFORE handing
    // off to runHouse so the first cascade can broadcast events
    // immediately. The overlay outlives this cascade run — pause/resume
    // (Barnacle handoff) only aborts the loop, never the overlay.
    const overlay =
      overlayPort !== undefined
        ? await ensureOverlay(
            ghost.spawnContext.ghostId,
            overlayPort,
            overlayPeerPorts,
          )
        : null;

    return runHouse({
      // Registry endpoints live on the world-api (e.g. http://127.0.0.1:8787),
      // not on the agent-host. Use the explicit `registry` field from the
      // spawn context; fall back to `a2a` only for older agent-host
      // versions that didn't include it (in which case displayName
      // resolution will fail until the host is upgraded).
      registryBase:
        ghost.spawnContext.houseEndpoints.registry ??
        ghost.spawnContext.houseEndpoints.a2a,
      ...(memoryConnection !== undefined ? { memoryConnection } : {}),
      ...(memoryServiceUrl !== undefined && memoryServiceUrl.length > 0
        ? { memoryServiceUrl }
        : {}),
      // Resume with the LIVE personality (birth + accumulated drift),
      // not the birth snapshot. Without this, every pause/resume
      // erased all the drift the ghost had accumulated.
      initialPersonality: ghost.personality,
      onPersonalityUpdate: (s) => {
        ghost.personality = s;
      },
      // Resume with the ghost's last known need state — without this
      // every Barnacle handoff silently reset Fuel/Coherence/Rest
      // back to midpoint 5.0.
      initialNeeds: ghost.needs,
      onNeedsUpdate: (n) => {
        ghost.needs = n;
      },
      // Resume with the open commitment ledger so debts the inner
      // voice minted persist across handoffs.
      initialCommitments: ghost.commitmentLedger,
      onCommitmentsUpdate: (l) => {
        ghost.commitmentLedger = l;
      },
      // Resume with accumulated primal→personality streak state so
      // that a ghost's pre-handoff stress / windfall doesn't reset
      // when a Barnacle mini-game pauses them.
      initialPrimalStreaks: ghost.primalStreaks,
      onPrimalStreaksUpdate: (s) => {
        ghost.primalStreaks = s;
      },
      // Persist chronic metabolic strain across pause/resume.
      initialMetabolicStrain: ghost.metabolicStrain,
      onMetabolicStrainUpdate: (s) => {
        ghost.metabolicStrain = s;
      },
      // Substrate blindness: items in this set are never surfaced as
      // stimuli or world-context entries. House variants would
      // populate this with the platform classes their world contains
      // but that they don't engage with.
      ignoredItemRefs: DEFAULT_IGNORED_ITEM_REFS,
      // Bearings: for every class in the bearing hint, compute a
      // per-cascade "nearest" bearing so a ghost has a directional
      // pointer to it. For foraging, this means a hungry ghost knows
      // which way the nearest Food is even when none is in their
      // 7-cell view. House variants append their own targets.
      bearingTargets: DEFAULT_BEARING_ITEM_CLASSES.map((cls) => ({
        label: cls,
        spec: { itemClass: cls },
      })),
      objective,
      verbose: process.env.PEPPERS_VERBOSE === "1",
      signal: ac.signal,
      // Run the cascade indefinitely — only the abort signal (pause /
      // process exit) should stop it. The default cap (40 stimuli) was
      // killing the spawn task mid-demo, which then made agent-host's
      // world-event pushes target a terminal A2A task → log spam.
      maxStimuli: Number.POSITIVE_INFINITY,
      ...(sleepAtForThisGhost !== undefined
        ? { sleepAtCascade: sleepAtForThisGhost }
        : {}),
      ...(overlay !== null ? { overlay } : {}),
      preProvisionedGhost: {
        ghostId: ghost.spawnContext.ghostId,
        worldApiBaseUrl: ghost.spawnContext.houseEndpoints.mcp,
        token: ghost.spawnContext.token,
        // Pass the persistent name through so the cascade + overlay use
        // "Django Decypher" instead of `ghost_<prefix>`.
        ...(ghost.spawnContext.ghostCard?.displayName
          ? { displayName: ghost.spawnContext.ghostCard.displayName }
          : {}),
      },
    });
  })()
    .then((outcome: RunHouseOutcome) => {
      if (ac.signal.aborted) return;
      ghost.socialAbort = undefined;
      taskLoops.delete(taskId);
      publishStatus(eventBus, taskId, contextId, "completed", true);
      eventBus.finished();
      // Death → reincarnation. The life ended; spawn its next one carrying
      // only the karmic word. Fire-and-forget; the new life is a fresh A2A
      // task that re-enters this executor.
      if (outcome?.ended === "died") {
        const registryBase =
          ghost.spawnContext.houseEndpoints.registry ??
          ghost.spawnContext.houseEndpoints.a2a;
        void reincarnate(ghost.spawnContext.ghostId, registryBase, outcome);
      }
    })
    .catch((err) => {
      if (ac.signal.aborted) return;
      ghost.socialAbort = undefined;
      taskLoops.delete(taskId);
      console.error(
        JSON.stringify({
          kind: "peppers-agent.loop-error",
          ghostId: ghost.spawnContext.ghostId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      publishStatus(eventBus, taskId, contextId, "failed", true);
      eventBus.finished();
    });

  return ac;
}

export class PeppersAgentExecutor implements AgentExecutor {
  execute = async (
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();
    const ctxId = contextId ?? "";

    const t: Task = task ?? {
      kind: "task",
      id: tid,
      contextId,
      status: { state: "submitted" as const, timestamp: new Date().toISOString() },
      history: userMessage ? [userMessage] : [],
      artifacts: [],
    };
    if (!task) eventBus.publish(t);

    // Ghost-house's supervisor pings agents with a plain text part
    // (`{kind:"text", text:"healthcheck"}`). Ack-and-done so we don't
    // mark the session unhealthy.
    const parts = userMessage?.parts ?? [];
    const onlyHealthcheck =
      parts.length > 0 &&
      parts.every(
        (p) =>
          p.kind === "text" && (p as { text?: string }).text === "healthcheck",
      );
    if (onlyHealthcheck) {
      publishStatus(eventBus, t.id, ctxId, "completed", true);
      eventBus.finished();
      return;
    }

    const schema = detectSchema(userMessage);
    switch (schema) {
      case "aie-matrix.agent-host.spawn-context.v1":
        return this.handleSpawn(t.id, ctxId, userMessage, eventBus);
      case PLATFORM_ENCOUNTER_SCHEMA:
        return this.handleEncounter(t.id, ctxId, userMessage, eventBus);
      case PEPPERS_PAUSE_SCHEMA:
        return this.handlePause(t.id, ctxId, userMessage, eventBus);
      case PEPPERS_RESUME_SCHEMA:
        return this.handleResume(t.id, ctxId, userMessage, eventBus);
      // World events from the supervisor's spawn-task push channel are
      // tolerated silently — peppers reads world state via MCP polling
      // and doesn't need them to drive its loop.
      case "aie-matrix.world-event.v1":
        publishStatus(eventBus, t.id, ctxId, "completed", true);
        eventBus.finished();
        return;
      default:
        return this.failTask(
          eventBus,
          t.id,
          ctxId,
          `peppers-agent: unknown or missing schema; got ${schema ?? "(none)"}`,
        );
    }
  };

  private failTask(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    reason: string,
  ): void {
    console.warn(
      JSON.stringify({ kind: "peppers-agent.task-failed", taskId, reason }),
    );
    publishStatus(eventBus, taskId, contextId, "failed", true);
    eventBus.finished();
  }

  private async handleSpawn(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const ctx = findDataPart<SpawnContext>(
      userMessage,
      "aie-matrix.agent-host.spawn-context.v1",
    );
    if (!ctx) return this.failTask(eventBus, taskId, contextId, "missing spawn context");

    // Derive birth personality. Three modes:
    //   - PEPPERS_BIRTH_EXTREME=cycle  → diagnostic mode; cycle through
    //                                    the four (internal, external)
    //                                    corners with every facet pinned.
    //   - PEPPERS_BIRTH_SEED=0         → midpoint personality.
    //   - PEPPERS_BIRTH_SEED=<n>       → deterministic sample.
    //   - (unset)                      → randomised sample.
    let initialPersonality: PersonalityState;
    let birthLabel = "";
    if (process.env.PEPPERS_BIRTH_EXTREME === "cycle") {
      const extreme = nextExtremePersonality();
      initialPersonality = extreme.personality;
      birthLabel = `extreme=${extreme.corner}`;
    } else {
      const seedEnv = process.env.PEPPERS_BIRTH_SEED;
      const seed = seedEnv ? Number(seedEnv) : Math.floor(Math.random() * 2 ** 31);
      initialPersonality =
        seedEnv && seed === 0 ? midpointPersonality() : samplePersonality({ seed, stddev: 1.8 });
      birthLabel = seedEnv ? `seed=${seedEnv}` : "random";
    }
    console.info(`[peppers-executor] spawning ghost ${ctx.ghostId.slice(0, 8)} · ${birthLabel}`);

    const state: PeppersGhostState = {
      spawnContext: ctx,
      initialPersonality,
      personality: initialPersonality,
      needs: midpointNeeds(),
      commitmentLedger: [],
      primalStreaks: {},
      metabolicStrain: 0,
      // Default peppers is blind to every platform class. Variants
      // (RDC-peppers, HP-peppers, etc.) override this via spawn-time
      // config when they exist.
      engagedPlatformClasses: [],
    };
    ghosts.set(ctx.ghostId, state);

    publishStatus(eventBus, taskId, contextId, "working", false);
    startSocialLoop(state, taskId, contextId, eventBus);
    // Task stays open (final: false) so agent-host can push world events
    // while the loop runs. startSocialLoop publishes the terminal status
    // when runHouse exits.
  }

  private async handleEncounter(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const enc = findDataPart<PlatformEncounter>(userMessage, PLATFORM_ENCOUNTER_SCHEMA);
    if (!enc) return this.failTask(eventBus, taskId, contextId, "missing encounter payload");
    const ghost = ghosts.get(enc.ghostId);
    if (!ghost) {
      return this.failTask(
        eventBus,
        taskId,
        contextId,
        `no ghost state for ${enc.ghostId}`,
      );
    }

    // Architectural rule: the substrate is blind to house-specific
    // content. Default peppers's `engagedPlatformClasses` is empty,
    // which means EVERY platform encounter is short-circuited to a
    // decline — no LLM call, no Barnacle pause, no handoff. The ghost
    // walks across the tile as if it were ordinary floor. Variants
    // that actually engage with a mini-game class (a future
    // RDC-flavoured peppers, etc.) populate this list at spawn time.
    if (!ghost.engagedPlatformClasses.includes(enc.platformClass)) {
      console.info(
        JSON.stringify({
          kind: "peppers-agent.encounter-ignored",
          ghostId: enc.ghostId,
          platformClass: enc.platformClass,
          reason: "platform class not in this ghost's engaged set (substrate is blind)",
        }),
      );
      captureRecord("encounter-ignored", {
        ghostId: enc.ghostId,
        displayName: ghost.spawnContext.ghostCard.displayName ?? null,
        platformId: enc.platformId,
        platformClass: enc.platformClass,
        engagedPlatformClasses: ghost.engagedPlatformClasses,
      });
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: PLATFORM_ENCOUNTER_SCHEMA,
        platformId: enc.platformId,
        ghostId: enc.ghostId,
        accept: false,
        reasoning: "(walks past — substrate is blind to this platform class)",
      });
      return;
    }

    let decision: { accept: boolean; reasoning: string };
    try {
      decision = await decideEncounter({
        state: ghost.personality,
        displayName:
          ghost.spawnContext.ghostCard.displayName ??
          `ghost-${enc.ghostId.slice(0, 8)}`,
        ghostId: enc.ghostId,
        encounter: enc,
        objective: resolveBaseObjective(),
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          kind: "peppers-agent.encounter-brain-error",
          ghostId: enc.ghostId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      decision = { accept: false, reasoning: "(walks past)" };
    }

    completeWithArtifact(eventBus, taskId, contextId, {
      schema: PLATFORM_ENCOUNTER_SCHEMA,
      platformId: enc.platformId,
      ghostId: enc.ghostId,
      accept: decision.accept,
      reasoning: decision.reasoning,
      // RFC-0019 — on accept, surface the personality snapshot so the
      // supervisor can build the handoff bundle without a second
      // round-trip. Uses the LIVE drifted personality, not the birth
      // snapshot, so the mini-game inherits the ghost as it actually
      // is right now.
      ...(decision.accept ? { personality: ghost.personality } : {}),
    });
  }

  private async handlePause(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const pause = findDataPart<PeppersPause>(userMessage, PEPPERS_PAUSE_SCHEMA);
    if (!pause) return this.failTask(eventBus, taskId, contextId, "missing pause payload");
    const ghost = ghosts.get(pause.ghostId);
    if (!ghost) {
      // Idempotent: pausing a ghost we don't know about is a no-op.
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: PEPPERS_PAUSE_SCHEMA,
        ghostId: pause.ghostId,
        paused: false,
        reason: "unknown ghost",
      });
      return;
    }
    if (ghost.socialAbort) {
      ghost.socialAbort.abort();
      ghost.socialAbort = undefined;
      if (ghost.socialTaskId) taskLoops.delete(ghost.socialTaskId);
      console.info(
        JSON.stringify({
          kind: "peppers-agent.paused",
          ghostId: pause.ghostId,
          reason: pause.reason ?? null,
        }),
      );
    }
    completeWithArtifact(eventBus, taskId, contextId, {
      schema: PEPPERS_PAUSE_SCHEMA,
      ghostId: pause.ghostId,
      paused: true,
    });
  }

  private async handleResume(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const resume = findDataPart<PeppersResume>(userMessage, PEPPERS_RESUME_SCHEMA);
    if (!resume) return this.failTask(eventBus, taskId, contextId, "missing resume payload");
    const ghost = ghosts.get(resume.ghostId);
    if (!ghost) {
      return this.failTask(
        eventBus,
        taskId,
        contextId,
        `no ghost state for ${resume.ghostId} — cannot resume without prior spawn`,
      );
    }
    if (ghost.socialAbort) {
      // Already running — idempotent reply.
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: PEPPERS_RESUME_SCHEMA,
        ghostId: resume.ghostId,
        resumed: true,
        note: "already-running",
      });
      return;
    }
    console.info(
      JSON.stringify({
        kind: "peppers-agent.resumed",
        ghostId: resume.ghostId,
        narrative: resume.narrative ?? null,
      }),
    );
    // Resume runs in its own task: this `resume` call replies immediately
    // ack'd, and the cascade re-attaches to the original spawn task only
    // if it's still alive. v1 simplification: the cascade starts a fresh
    // task to host its lifecycle.
    publishStatus(eventBus, taskId, contextId, "working", false);
    startSocialLoop(ghost, taskId, contextId, eventBus, {
      narrative: resume.narrative,
    });
  }

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const entry = taskLoops.get(taskId);
    if (entry) {
      entry.ac.abort();
      taskLoops.delete(taskId);
      const ghost = ghosts.get(entry.ghostId);
      if (ghost?.socialTaskId === taskId) {
        ghost.socialAbort = undefined;
        ghost.socialTaskId = undefined;
      }
    }
    publishStatus(eventBus, taskId, entry?.contextId ?? "", "canceled", true);
    eventBus.finished();
  };
}
