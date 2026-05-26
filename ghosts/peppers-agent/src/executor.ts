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
  midpointPersonality,
  samplePersonality,
  type PersonalityState,
} from "@aie-matrix/ghost-peppers-inner";
import { decideEncounter } from "./encounter-brain.js";
import { runHouse } from "./run-house.js";
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

/**
 * The peppers ghost's standing surface objective. Read by the cascade
 * runner (to thread into every Id + Surface call) and by the encounter
 * brain (so a ghost whose objective points at the saloon actually says
 * "yes" when offered a seat — not just because their personality is
 * agreeable, but because the brain knows they came here to play).
 * Override with PEPPERS_OBJECTIVE.
 */
export function resolveBaseObjective(): string {
  return (
    process.env.PEPPERS_OBJECTIVE ??
    "You are a ghost in a frontier town. The pull of the night is Black Bart's Saloon — a poker table where strangers become rivals and rivals become hands of cards. Make your way there. Along the way, when a ghost is nearby in your cluster, speak to them — exchange names, find common ground, decide if you'll play together or against. But conversation is the road, not the destination: the table is where the night actually happens. When you can see the poker table or stand next to it, sit down."
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
  /** Birth personality snapshot — used for the encounter brain and to
   *  re-seed the cascade on resume. */
  readonly initialPersonality: PersonalityState;
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

  const memoryConnection = {
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

  void runHouse({
    // Registry endpoints live on the world-api (e.g. http://127.0.0.1:8787),
    // not on the agent-host. Use the explicit `registry` field from the
    // spawn context; fall back to `a2a` only for older agent-host
    // versions that didn't include it (in which case displayName
    // resolution will fail until the host is upgraded).
    registryBase:
      ghost.spawnContext.houseEndpoints.registry ??
      ghost.spawnContext.houseEndpoints.a2a,
    memoryConnection,
    initialPersonality: ghost.initialPersonality,
    objective,
    verbose: process.env.PEPPERS_VERBOSE === "1",
    signal: ac.signal,
    // Run the cascade indefinitely — only the abort signal (pause /
    // process exit) should stop it. The default cap (40 stimuli) was
    // killing the spawn task mid-demo, which then made agent-host's
    // world-event pushes target a terminal A2A task → log spam.
    maxStimuli: Number.POSITIVE_INFINITY,
    ...(overlayPort !== undefined ? { overlayPort } : {}),
    ...(overlayPeerPorts.length > 0 ? { overlayPeerPorts } : {}),
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
  })
    .then(() => {
      if (ac.signal.aborted) return;
      ghost.socialAbort = undefined;
      taskLoops.delete(taskId);
      publishStatus(eventBus, taskId, contextId, "completed", true);
      eventBus.finished();
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

    // Derive birth personality. Per-ghost via env override if set
    // (typical when running one process per ghost); otherwise randomised.
    const seedEnv = process.env.PEPPERS_BIRTH_SEED;
    const seed = seedEnv ? Number(seedEnv) : Math.floor(Math.random() * 2 ** 31);
    const initialPersonality =
      seedEnv && seed === 0 ? midpointPersonality() : samplePersonality({ seed, stddev: 1.8 });

    const state: PeppersGhostState = {
      spawnContext: ctx,
      initialPersonality,
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

    let decision: { accept: boolean; reasoning: string };
    try {
      decision = await decideEncounter({
        state: ghost.initialPersonality,
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
      // round-trip. v1: uses initialPersonality (drift not preserved
      // across pause/resume yet).
      ...(decision.accept ? { personality: ghost.initialPersonality } : {}),
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
