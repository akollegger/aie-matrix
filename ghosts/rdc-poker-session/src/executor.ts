/**
 * RDC poker session executor — RFC-0019 Barnacle Protocol.
 *
 * One process represents one poker table. Ghosts are seated via
 * `BarnacleHandoff` from ghost-house's supervisor, the in-session
 * auto-loop (`session-loop.ts`) deals hands using the direct-call
 * decide path, and seat exits trigger `BarnacleComplete` back to the
 * supervisor.
 *
 * This A2A executor handles only the Barnacle wire:
 *   barnacle.handoff.v1    → materialise + seat a player
 *   barnacle.heartbeat.v1  → liveness probe
 *   (out) barnacle.complete.v1 → POSTed via `sendBarnacleComplete`
 *
 * All legacy schemas (spawn-context, platform.encounter, platform.exit,
 * poker.invite, poker.turn, poker.outcome, poker.reflect, poker-spawn)
 * were retired in phase 5b.2c — their host-side equivalents now live in
 * peppers-agent (encounter brain, social cascade) and the in-process
 * auto-loop (turn/outcome/reflect).
 */

import { randomUUID } from "node:crypto";

import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from "@a2a-js/sdk/server";
import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";
import { Ledger } from "@aie-matrix/ghost-rdc-ledger";
import {
  BARNACLE_COMPLETE_SCHEMA,
  BARNACLE_HANDOFF_SCHEMA,
  BARNACLE_HEARTBEAT_SCHEMA,
  type BarnacleComplete,
  type BarnacleHandoff,
  type BarnacleHeartbeat,
} from "@aie-matrix/shared-types";

import {
  assignMathSchool,
  SCHOOL_FLAVOR_NAMES,
  type MathSchool,
} from "./math-schools.js";
import { ActiveTable, type TableConfig, type TableSeat } from "./table-state.js";

/** taskId → metadata so we can cancel cleanly. */
const taskState = new Map<
  string,
  { ac: AbortController; ghostId: string; contextId: string }
>();

/**
 * Per-process table — RFC-0019 (Barnacle Protocol). Set once at session
 * start via `setActiveTable` (called from `agent.ts`'s entry-point).
 * Until set, BarnacleHandoff replies with `accepted: false` and the
 * supervisor bounces the player back to peppers.
 */
let activeTable: ActiveTable | null = null;

/** Initialise the session's table model. Called once at process start. */
export function setActiveTable(config: TableConfig): ActiveTable {
  activeTable = new ActiveTable(config);
  console.info(
    JSON.stringify({
      kind: "rdc-poker-session.active-table-set",
      platformId: config.platformId,
      platformClass: config.platformClass,
      capacity: config.capacity,
      minPlayers: config.minPlayers,
    }),
  );
  return activeTable;
}

/** Read-only access for the auto-loop and any spectator hooks. */
export function getActiveTable(): ActiveTable | null {
  return activeTable;
}

/** Shared ledger handle — used by the auto-loop for debits/awards.
 *  Exported so the entry-point and the loop share one instance. */
let ledgerSingleton: Ledger | null = null;
export function getLedger(): Ledger {
  if (ledgerSingleton === null) {
    const persistPath = process.env.RDC_LEDGER_PATH;
    ledgerSingleton = new Ledger({
      persistPath,
      startingBalance: Number(process.env.RDC_STARTING_AURA ?? 500),
    });
    void ledgerSingleton.load();
  }
  return ledgerSingleton;
}

function findDataPart<T extends { schema: string }>(
  msg: Message | undefined,
  schema: string,
): T | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === schema) {
        return d as unknown as T;
      }
    }
  }
  return null;
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

function failTask(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  reason: string,
): void {
  console.warn(
    JSON.stringify({ kind: "rdc-poker-session.task-failed", taskId, reason }),
  );
  publishStatus(eventBus, taskId, contextId, "failed", true);
  eventBus.finished();
}

export class RdcAgentExecutor implements AgentExecutor {
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
    // (`{kind:"text", text:"healthcheck"}`) to verify liveness.
    const hasOnlyHealthcheck =
      (userMessage?.parts ?? []).every(
        (p) =>
          p.kind === "text" && (p as { text?: string }).text === "healthcheck",
      ) && (userMessage?.parts ?? []).length > 0;
    if (hasOnlyHealthcheck) {
      publishStatus(eventBus, t.id, ctxId, "completed", true);
      eventBus.finished();
      return;
    }

    const schema = detectSchema(userMessage);

    switch (schema) {
      case BARNACLE_HANDOFF_SCHEMA:
        return this.handleBarnacleHandoff(t.id, ctxId, userMessage, eventBus);
      case BARNACLE_HEARTBEAT_SCHEMA:
        return this.handleBarnacleHeartbeat(t.id, ctxId, userMessage, eventBus);
      case "aie-matrix.world-event.v1":
        // World events arrive on this socket out of inertia; ack and move on.
        publishStatus(eventBus, t.id, ctxId, "completed", true);
        eventBus.finished();
        return;
      default:
        return failTask(
          eventBus,
          t.id,
          ctxId,
          `unknown or unsupported schema; got ${schema ?? "(none)"}`,
        );
    }
  };

  cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    const entry = taskState.get(taskId);
    if (entry) {
      entry.ac.abort();
      taskState.delete(taskId);
    }
    publishStatus(eventBus, taskId, entry?.contextId ?? "", "canceled", true);
    eventBus.finished();
  };

  /**
   * `BarnacleHandoff` — supervisor consented this ghost to play. We
   * derive their math school from the personality snapshot (RFC-0018 —
   * sticky for the session) and seat them in the active table. The
   * auto-loop picks them up once `size >= minPlayers`.
   *
   * Rejects with `accepted: false` if no table is configured, if the
   * table is full, or if the ghost is already seated (idempotent retry).
   */
  private async handleBarnacleHandoff(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const handoff = findDataPart<BarnacleHandoff>(
      userMessage,
      BARNACLE_HANDOFF_SCHEMA,
    );
    if (!handoff) {
      return failTask(eventBus, taskId, contextId, "missing handoff payload");
    }

    if (!activeTable) {
      console.warn(
        JSON.stringify({
          kind: "rdc-poker-session.handoff-no-table",
          sessionId: handoff.sessionId,
          ghostId: handoff.ghostId,
        }),
      );
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: false,
      });
      return;
    }

    // `BarnaclePersonalitySnapshot` is structurally identical to
    // `PersonalityState` — double-cast acknowledges the boundary.
    const personality = handoff.personality as unknown as PersonalityState;

    // Idempotent retry: same sessionId already seated → ack and exit.
    const existing = activeTable.getSeat(handoff.ghostId);
    if (existing && existing.barnacleSessionId === handoff.sessionId) {
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: true,
        heartbeatIntervalMs: 30_000,
      });
      return;
    }

    const role: "outlaw" | "marshall" =
      handoff.role === "marshall" || handoff.role === "outlaw"
        ? handoff.role
        : "outlaw";

    const mathSchool: MathSchool = assignMathSchool(personality);
    console.info(
      JSON.stringify({
        kind: "rdc-poker-session.math-school-assigned",
        ghostId: handoff.ghostId,
        displayName: handoff.displayName,
        school: mathSchool,
        flavorName: SCHOOL_FLAVOR_NAMES[mathSchool],
      }),
    );

    // ── Cooldown gate: a recently-busted ghost can't immediately
    //    re-buy-in. The seats are scarce; let other ghosts play.
    const cooldownLeft = activeTable.cooldownRemainingMs(handoff.ghostId);
    if (cooldownLeft > 0) {
      console.info(
        JSON.stringify({
          kind: "rdc-poker-session.handoff-rejected",
          reason: "cooldown",
          ghostId: handoff.ghostId,
          cooldownLeftMs: cooldownLeft,
        }),
      );
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: false,
      });
      return;
    }

    // ── Buy-in gate: must have enough Cyphers to cover the table buy-in.
    const ledger = getLedger();
    const buyIn = activeTable.config.buyIn;
    if (ledger.getBalance(handoff.ghostId) < buyIn) {
      console.info(
        JSON.stringify({
          kind: "rdc-poker-session.handoff-rejected",
          reason: "insufficient-cyphers",
          ghostId: handoff.ghostId,
          available: ledger.getBalance(handoff.ghostId),
          required: buyIn,
        }),
      );
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: false,
      });
      return;
    }

    // ── Debit the buy-in BEFORE we know seating succeeded; refund if
    //    the table turns out to be full (race with concurrent handoffs).
    const debit = ledger.debit(
      handoff.ghostId,
      buyIn,
      `poker buy-in @ ${activeTable.config.platformId}`,
    );
    if (!debit.ok) {
      // Shouldn't happen — we just checked balance — but degrade gracefully.
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: false,
      });
      return;
    }

    const seat: TableSeat = {
      ghostId: handoff.ghostId,
      displayName: handoff.displayName,
      role,
      initialPersonality: personality,
      personality,
      mathSchool,
      opponentReads: new Map(),
      barnacleSessionId: handoff.sessionId,
      supervisorA2A: handoff.hostEndpoints.supervisorA2A,
      seatedAtMs: Date.now(),
      // Buy-in seeds the table chipStack. From now on it persists
      // across hands until cash-out or bust-out.
      chipStack: buyIn,
      // Fresh seat: empty outcomes window, not tilted. The session
      // loop updates these after every hand.
      recentOutcomes: [],
      isTilted: false,
    };
    const outcome = activeTable.seat(seat);
    console.info(
      JSON.stringify({
        kind: "rdc-poker-session.handoff-seated",
        ghostId: handoff.ghostId,
        sessionId: handoff.sessionId,
        outcome,
        tableSize: activeTable.size(),
        chipStack: buyIn,
      }),
    );

    if (outcome === "full") {
      // Race: someone else filled the last seat. Refund the buy-in.
      ledger.award(
        handoff.ghostId,
        buyIn,
        `poker buy-in refund (table full) @ ${activeTable.config.platformId}`,
      );
      completeWithArtifact(eventBus, taskId, contextId, {
        schema: BARNACLE_HANDOFF_SCHEMA,
        sessionId: handoff.sessionId,
        accepted: false,
      });
      return;
    }

    completeWithArtifact(eventBus, taskId, contextId, {
      schema: BARNACLE_HANDOFF_SCHEMA,
      sessionId: handoff.sessionId,
      accepted: true,
      heartbeatIntervalMs: 30_000,
    });
  }

  /** `BarnacleHeartbeat` — trivial liveness probe. */
  private async handleBarnacleHeartbeat(
    taskId: string,
    contextId: string,
    userMessage: Message | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const beat = findDataPart<BarnacleHeartbeat>(
      userMessage,
      BARNACLE_HEARTBEAT_SCHEMA,
    );
    if (!beat) {
      return failTask(eventBus, taskId, contextId, "missing heartbeat payload");
    }
    completeWithArtifact(eventBus, taskId, contextId, {
      schema: BARNACLE_HEARTBEAT_SCHEMA,
      sessionId: beat.sessionId,
      status: "alive",
    });
  }
}

/**
 * Post `BarnacleComplete` to the supervisor — called when a ghost
 * leaves the session (reflect → "leave", busted out, etc.). Best
 * effort: failures are logged but don't block teardown.
 */
export async function sendBarnacleComplete(
  supervisorA2A: string,
  payload: { sessionId: string; ghostId: string; narrative?: string },
): Promise<boolean> {
  const body: BarnacleComplete = {
    schema: BARNACLE_COMPLETE_SCHEMA,
    sessionId: payload.sessionId,
    ghostId: payload.ghostId,
    narrative: payload.narrative,
    lastEventIso: new Date().toISOString(),
  };
  try {
    const r = await fetch(supervisorA2A.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn(
        JSON.stringify({
          kind: "rdc-poker-session.barnacle-complete-failed",
          sessionId: payload.sessionId,
          ghostId: payload.ghostId,
          status: r.status,
        }),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      JSON.stringify({
        kind: "rdc-poker-session.barnacle-complete-failed",
        sessionId: payload.sessionId,
        ghostId: payload.ghostId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }
}
