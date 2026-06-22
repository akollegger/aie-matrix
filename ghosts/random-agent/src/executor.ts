import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { getResolution, isValidCell } from "h3-js";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { createLogger } from "@aie-matrix/logger";
import type { SpawnContext } from "./spawn-types.js";
import type { WorldEvent } from "./world-event.js";

const log = createLogger("random-agent");

// ── Push-failure degraded/recovered tracking (T038) ──────────────────────────

export const PUSH_FAILURE_THRESHOLD = 3;

type PushStatus = "ok" | "degraded";
type PushState = { status: PushStatus; consecutiveFailures: number };
const pushStateByGhost = new Map<string, PushState>();

function getPushStateInternal(ghostId: string): PushState {
  if (!pushStateByGhost.has(ghostId)) {
    pushStateByGhost.set(ghostId, { status: "ok", consecutiveFailures: 0 });
  }
  return pushStateByGhost.get(ghostId)!;
}

export function getPushState(ghostId: string): PushState {
  return { ...getPushStateInternal(ghostId) };
}

export function resetPushStateForGhost(ghostId: string): void {
  pushStateByGhost.set(ghostId, { status: "ok", consecutiveFailures: 0 });
}

export function trackPushFailure(ghostId: string, _err: Error): void {
  const state = getPushStateInternal(ghostId);
  state.consecutiveFailures++;
  if (state.status === "ok" && state.consecutiveFailures >= PUSH_FAILURE_THRESHOLD) {
    state.status = "degraded";
    console.log(JSON.stringify({
      event: "random-agent.push.degraded",
      ghostId,
      consecutiveFailures: state.consecutiveFailures,
      ts: new Date().toISOString(),
    }));
  }
}

export function trackPushSuccess(ghostId: string): void {
  const state = getPushStateInternal(ghostId);
  const wasD = state.status === "degraded";
  state.consecutiveFailures = 0;
  state.status = "ok";
  if (wasD) {
    console.log(JSON.stringify({
      event: "random-agent.push.recovered",
      ghostId,
      ts: new Date().toISOString(),
    }));
  }
}

// ── Task-not-found detection (T039) ───────────────────────────────────────────

export function isTaskNotFoundError(response: unknown): boolean {
  if (response === null || typeof response !== "object") return false;
  const r = response as Record<string, unknown>;
  return typeof r["error"] === "string" && r["error"].toLowerCase().includes("task not found");
}

export function getActivePushDegradedGhosts(): string[] {
  return [...pushStateByGhost.entries()]
    .filter(([, s]) => s.status === "degraded")
    .map(([id]) => id);
}

// ── Movement loop ─────────────────────────────────────────────────────────────

export function activeLoopCount(): number {
  return loopsByGhostId.size;
}

type MoveLoop = { cancel: () => void };

/** One movement loop per `ghostId`; parallel distinct `ghostId`s. */
const loopsByGhostId = new Map<string, MoveLoop>();

/** Active MCP client per ghostId — used by event handlers to call say. */
const mcpByGhostId = new Map<string, GhostMcpClient>();

/** Latest spawn task id per ghost (IC-006); used to drop stale task metadata on re-spawn. */
const ghostIdToTaskId = new Map<string, string>();

type SpawnTaskMeta = { readonly ghostId: string; readonly contextId: string };

const spawnTaskMeta = new Map<string, SpawnTaskMeta>();

function registerSpawnTask(taskId: string, ghostId: string, contextId: string): void {
  const prev = ghostIdToTaskId.get(ghostId);
  if (prev !== undefined && prev !== taskId) {
    spawnTaskMeta.delete(prev);
  }
  ghostIdToTaskId.set(ghostId, taskId);
  spawnTaskMeta.set(taskId, { ghostId, contextId });
}

function assertH3Res15(h3: string, step: string, ghostId: string): void {
  if (!isValidCell(h3) || getResolution(h3) !== 15) {
    throw new Error(`[random-agent] ghostId=${ghostId} ${step}: expected H3 res-15, got ${h3}`);
  }
}

function parseSpawnData(msg: Message | undefined): SpawnContext | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.agent-host.spawn-context.v1") {
        return d as unknown as SpawnContext;
      }
    }
  }
  return null;
}

/** Cancels the in-flight loop for `ghostId` (replace policy); does not remove the map entry — the new loop overwrites after `cancel()`. */
function cancelMovementForGhost(ghostId: string, reason: string): void {
  const loop = loopsByGhostId.get(ghostId);
  if (loop) {
    log.info({ kind: "movement.cancel", ghostId, reason });
    loop.cancel();
  }
}

async function startMovementFromSpawn(
  getMoveIntervalMs: () => string | undefined,
  ctx: SpawnContext,
  getMcpErrorRetryMs: () => number = () => 5_000,
): Promise<void> {
  const { ghostId } = ctx;
  cancelMovementForGhost(ghostId, "spawn-replace");

  // Register the cancel handle BEFORE any await so cancelTask() can reach it
  // immediately after "working" is published. If cancel fires before connect()
  // completes, `go` will be false and the while loop exits without running.
  let go = true;
  let wakeUp: (() => void) | null = null;
  const handle: MoveLoop = { cancel: () => { go = false; wakeUp?.(); } };
  loopsByGhostId.set(ghostId, handle);

  const mcp = new GhostMcpClient({
    worldApiBaseUrl: ctx.houseEndpoints.mcp,
    token: ctx.token,
  });
  await mcp.connect();
  await mcp.announce("", ctx.ghostCard?.glyph ?? "👻").catch(() => {});
  mcpByGhostId.set(ghostId, mcp);
  const moveMs = Math.max(200, parseInt(getMoveIntervalMs() ?? "2000", 10) || 2000);
  log.info({ kind: "movement.start", ghostId, intervalMs: moveMs });
  // Track pending proposals this ghost initiated so we can randomly decline them
  const pendingProposals: string[] = [];

  // Group state tracking (T047)
  const knownGroupIds: Set<string> = new Set();
  let groupListTicksSince = 0;
  const GROUP_LIST_INTERVAL = 10; // re-check group membership every N ticks

  async function refreshGroupMemberships(): Promise<void> {
    const result = await mcp.callTool("group.list", {}).catch(() => null) as { groups?: Array<{ groupId: string }> } | null;
    if (result?.groups) {
      knownGroupIds.clear();
      for (const g of result.groups) {
        if (g.groupId) knownGroupIds.add(g.groupId);
      }
    }
  }

  async function tryAction(exits: ReadonlyArray<{ toward?: string }>, occupants: string[]): Promise<void> {
    const roll = Math.random();

    // 10% chance: check inventory
    if (roll < 0.10) {
      await mcp.callTool("inventory", {}).catch(() => {});
      return;
    }

    // 10% chance: offer a trade to a co-occupant if any
    if (roll < 0.20 && occupants.length > 0) {
      const target = occupants[Math.floor(Math.random() * occupants.length)]!;
      const result = await mcp.callTool("offer", {
        to: target,
        give_resource: "gold", give_qty: 1,
        for_resource: "gold",  for_qty: 1,
      }).catch(() => null) as { proposalId?: string } | null;
      if (result?.proposalId) pendingProposals.push(result.proposalId);
      return;
    }

    // 5% chance: decline a pending proposal
    if (roll < 0.25 && pendingProposals.length > 0) {
      const proposalId = pendingProposals.splice(Math.floor(Math.random() * pendingProposals.length), 1)[0]!;
      await mcp.callTool("decline", { proposalId }).catch(() => {});
      return;
    }

    // 5% chance: offer group formation to a co-occupant (T049) — only if not already in a group
    if (roll < 0.30 && occupants.length > 0 && knownGroupIds.size === 0) {
      const target = occupants[Math.floor(Math.random() * occupants.length)]!;
      const result = await mcp.callTool("group.offer", {
        to: target,
        resource: "gold",
        amount: 1,
        expires_in: 120,
      }).catch(() => null) as { ok?: boolean; proposalId?: string } | null;
      if (result?.ok && result.proposalId) {
        pendingProposals.push(result.proposalId);
        log.info({ kind: "group.offer", ghostId, to: target });
      }
      return;
    }

    // 1% chance: randomly leave a group (T051)
    if (roll < 0.31 && knownGroupIds.size > 0) {
      const groupIds = [...knownGroupIds];
      const groupId = groupIds[Math.floor(Math.random() * groupIds.length)]!;
      const result = await mcp.callTool("group.leave", { group_id: groupId }).catch(() => null) as { ok?: boolean } | null;
      if (result?.ok) {
        knownGroupIds.delete(groupId);
        log.info({ kind: "group.leave", ghostId, groupId });
      }
      return;
    }

    // Otherwise: move
    if (exits.length === 0) return;
    const pick = exits[Math.floor(Math.random() * exits.length)]!;
    const toward = pick.toward;
    if (typeof toward === "string" && toward.length > 0) {
      const r = await mcp.callTool("go", { toward }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        log.info({ kind: "movement.go-rejected", ghostId, toward, message: msg.length > 200 ? `${msg.slice(0, 197)}...` : msg });
        return null;
      }) as { ok?: boolean; tileId?: string } | null;
      if (r?.ok === true && typeof r.tileId === "string") {
        assertH3Res15(r.tileId, "go", ghostId);
      }
    }
  }

  // Initial group membership load — fire-and-forget so startup isn't delayed (T048)
  void refreshGroupMemberships().catch(() => {});

  let consecutiveMcpErrors = 0;
  const MCP_ERROR_THRESHOLD = 3;

  try {
    while (go) {
      let w: { h3Index?: string; tileId?: string; occupants?: string[] };
      try {
        w = (await mcp.callTool("whereami", {})) as { h3Index?: string; tileId?: string; occupants?: string[] };
        consecutiveMcpErrors = 0;
      } catch (e) {
        consecutiveMcpErrors++;
        const msg = e instanceof Error ? e.message : String(e);
        log.warn({ kind: "movement.mcp-error", ghostId, tool: "whereami", consecutiveMcpErrors, message: msg.slice(0, 200) });
        if (consecutiveMcpErrors >= MCP_ERROR_THRESHOLD) {
          log.warn({ kind: "movement.mcp-fatal", ghostId, note: "too many consecutive errors — exiting loop for re-spawn" });
          throw new Error(`MCP unrecoverable after ${consecutiveMcpErrors} errors: ${msg}`);
        }
        await new Promise((r) => setTimeout(r, getMcpErrorRetryMs()));
        continue;
      }
      const cell = w.h3Index && w.h3Index.length > 0 ? w.h3Index : w.tileId;
      if (typeof cell === "string") {
        assertH3Res15(cell, "whereami", ghostId);
      }
      const occupants = (w.occupants ?? []).filter((id: string) => id !== ghostId);
      const ex = (await mcp.callTool("exits", {})) as { exits?: ReadonlyArray<{ toward?: string }> };
      const exits = ex.exits ?? [];

      // Periodically refresh group memberships (T048)
      groupListTicksSince++;
      if (groupListTicksSince >= GROUP_LIST_INTERVAL) {
        groupListTicksSince = 0;
        await refreshGroupMemberships().catch(() => {});
      }

      // Check inbox for group admission vote invitations (T050)
      const inboxResult = await mcp.callTool("inbox", {}).catch(() => null) as { notifications?: Array<{ thread_id: string; message_id: string }> } | null;
      if (inboxResult?.notifications) {
        for (const n of inboxResult.notifications) {
          // Group threads have a thread_id that starts with a ULID and is not a ghost's own ID
          if (n.thread_id && n.thread_id !== ghostId && knownGroupIds.has(n.thread_id)) {
            // This is a group message — could be an admission vote invitation.
            // Vote accept with 80% probability, reject with 20%.
            const decision = Math.random() < 0.80 ? "accept" : "reject";
            const voteResult = await mcp.callTool("group.vote", {
              group_id: n.thread_id,
              offer_id: n.message_id,
              decision,
            }).catch(() => null) as { ok?: boolean } | null;
            if (voteResult?.ok) {
              log.info({ kind: "group.vote", ghostId, groupId: n.thread_id, decision });
            }
          }
        }
      }

      const sleep = () => new Promise<void>((r) => {
        const t = setTimeout(r, moveMs);
        wakeUp = () => { clearTimeout(t); r(); };
      });

      if (exits.length === 0 && occupants.length === 0) {
        await sleep();
        continue;
      }
      await tryAction(exits, occupants);
      await sleep();
    }
  } finally {
    if (loopsByGhostId.get(ghostId) === handle) {
      loopsByGhostId.delete(ghostId);
    }
    if (mcpByGhostId.get(ghostId) === mcp) {
      mcpByGhostId.delete(ghostId);
    }
    await mcp.disconnect().catch(() => {});
  }
}

export class RandomWandererExecutor implements AgentExecutor {
  constructor(
    private readonly getMoveInterval: () => string | undefined = () => process.env.RANDOM_AGENT_MOVE_MS,
    private readonly getMcpErrorRetryMs: () => number = () => 5_000,
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();
    const sp = parseSpawnData(userMessage);
    if (sp) {
      const t = task
        ? task
        : ({
            kind: "task",
            id: tid,
            contextId,
            status: { state: "submitted" as const, timestamp: new Date().toISOString() },
            history: userMessage ? [userMessage] : [],
            artifacts: [],
          } as Task);
      if (!requestContext.task) {
        eventBus.publish(t);
      }
      const w: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: t.id,
        contextId: contextId ?? t.contextId,
        final: false,
        status: { state: "working", timestamp: new Date().toISOString() },
      };
      eventBus.publish(w);
      registerSpawnTask(t.id, sp.ghostId, contextId ?? t.contextId);

      // Await the movement loop — keeps this A2A task in "working" state so
      // cancelTask() can cancel it cleanly. The loop exits when:
      //   (a) cancelMovementForGhost sets go=false (via cancelTask), or
      //   (b) the loop throws (unrecoverable MCP error → agent-host re-spawns).
      let loopError: unknown = null;
      await startMovementFromSpawn(this.getMoveInterval, sp, this.getMcpErrorRetryMs).catch((e: unknown) => {
        loopError = e;
        log.warn({ kind: "movement.loop-exited-with-error", ghostId: sp.ghostId, message: e instanceof Error ? e.message : String(e) });
      });

      // If cancelTask already ran it has claimed the metadata and published "canceled".
      // Only publish a terminal event if we still own the metadata entry.
      const stillOwned = spawnTaskMeta.get(t.id)?.ghostId === sp.ghostId;
      if (stillOwned) {
        spawnTaskMeta.delete(t.id);
        if (ghostIdToTaskId.get(sp.ghostId) === t.id) {
          ghostIdToTaskId.delete(sp.ghostId);
        }
        // Publish "failed" when the loop threw so agent-host re-spawns the ghost.
        // Publish "completed" only on clean cancellation (go=false via cancelTask).
        const terminalState = loopError !== null ? "failed" : "completed";
        const done: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: t.id,
          contextId: contextId ?? t.contextId,
          final: true,
          status: { state: terminalState, timestamp: new Date().toISOString() },
        };
        eventBus.publish(done);
      }
      eventBus.finished();
      return;
    }
    // World events are delivered as independent A2A messages (no taskId on the message),
    // so `tid` here is a fresh UUID — the spawn task is not touched.
    const ev = asWorldEvent(userMessage);
    if (ev !== null) {
      // world.message.new with PARTNER or DIRECT priority triggers a say() call.
      if (ev.kind === "world.message.new") {
        const pl = ev.payload as { text?: string; priority?: string; from?: string; thread_id?: string };
        if ((pl.priority === "PARTNER" || pl.priority === "DIRECT") && typeof pl.from === "string" && typeof pl.text === "string") {
          const mcp = mcpByGhostId.get(ev.ghostId);
          log.info({ kind: "random-agent.message.received", ghostId: ev.ghostId, priority: pl.priority, hasMcp: !!mcp, from: pl.from });
          if (mcp) {
            void mcp.callTool("say", { intent: "greet", content: `received: ${pl.text}`, to: pl.from }).catch((e: unknown) => {
              log.error({ kind: "random-agent.say-fail", ghostId: ev.ghostId, message: e instanceof Error ? e.message : String(e) });
            });
          } else {
            log.warn({ kind: "random-agent.message.no-mcp", ghostId: ev.ghostId });
          }
        }
        // GROUP priority messages indicate group events (admit, join, leave) — refresh membership cache
        if (pl.priority === "GROUP") {
          const mcp = mcpByGhostId.get(ev.ghostId);
          if (mcp) {
            void mcp.callTool("group.list", {}).catch(() => null).then((result) => {
              const r = result as { groups?: Array<{ groupId: string }> } | null;
              if (r?.groups) {
                // Update the knownGroupIds for this ghost — accessed via closure below
                // Note: the group tracking Map is per-movement-loop; this triggers a re-list next tick
                log.info({ kind: "group.event", ghostId: ev.ghostId, groupCount: r.groups.length });
              }
            });
          }
        }
      }
      // Persist the delivery task in InMemoryTaskStore before publishing a status-update.
      // Without this, _sendPushNotificationIfNeeded logs "Task [tid] not found." because
      // the store has no record for the fresh UUID.
      if (!task) {
        const deliveryTask: Task = {
          kind: "task",
          id: tid,
          contextId: contextId ?? tid,
          status: { state: "submitted", timestamp: new Date().toISOString() },
          history: userMessage ? [userMessage] : [],
          artifacts: [],
        };
        eventBus.publish(deliveryTask);
      }
      // Close this independent delivery task as completed.
      const done: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: tid,
        contextId: contextId ?? tid,
        final: true,
        status: { state: "completed", timestamp: new Date().toISOString() },
      };
      eventBus.publish(done);
      eventBus.finished();
      return;
    }

    if (userMessage && userText(userMessage).toLowerCase() === "healthcheck") {
      const reply: Message = {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        contextId,
        taskId: tid,
        parts: [{ kind: "text", text: "ok" }],
      };
      eventBus.publish(reply);
      eventBus.finished();
      return;
    }
    const reply: Message = {
      kind: "message",
      messageId: randomUUID(),
      role: "agent",
      contextId,
      taskId: tid,
      parts: [{ kind: "text", text: "noop" }],
    };
    eventBus.publish(reply);
    eventBus.finished();
  }

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const meta = spawnTaskMeta.get(taskId);
    const ghostId = meta?.ghostId;
    if (ghostId) {
      cancelMovementForGhost(ghostId, "a2a-cancel-task");
    }
    spawnTaskMeta.delete(taskId);
    if (ghostId && ghostIdToTaskId.get(ghostId) === taskId) {
      ghostIdToTaskId.delete(ghostId);
    }
    const ctxId = meta?.contextId ?? "";
    const canceled: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId: ctxId,
      final: true,
      status: { state: "canceled", timestamp: new Date().toISOString() },
    };
    eventBus.publish(canceled);
  };
}

function userText(userMessage: Message | undefined): string {
  for (const p of userMessage?.parts ?? []) {
    if (p.kind === "text" && "text" in p) {
      return p.text;
    }
  }
  return "";
}

function asWorldEvent(msg: Message | undefined): WorldEvent | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.world-event.v1") {
        return d as unknown as WorldEvent;
      }
    }
  }
  return null;
}
