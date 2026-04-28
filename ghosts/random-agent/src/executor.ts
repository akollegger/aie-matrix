import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { getResolution, isValidCell } from "h3-js";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { SpawnContext } from "./spawn-types.js";
import type { WorldEvent } from "./world-event.js";

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
      if (d.schema === "aie-matrix.ghost-house.spawn-context.v1") {
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
    console.info(
      JSON.stringify({
        kind: "random-agent.movement.cancel",
        ghostId,
        reason,
      }),
    );
    loop.cancel();
  }
}

async function startMovementFromSpawn(
  getMoveIntervalMs: () => string | undefined,
  ctx: SpawnContext,
): Promise<void> {
  const { ghostId } = ctx;
  cancelMovementForGhost(ghostId, "spawn-replace");

  const mcp = new GhostMcpClient({
    worldApiBaseUrl: ctx.houseEndpoints.mcp,
    token: ctx.token,
  });
  await mcp.connect();
  mcpByGhostId.set(ghostId, mcp);
  const moveMs = Math.max(200, parseInt(getMoveIntervalMs() ?? "2000", 10) || 2000);
  let go = true;
  const handle: MoveLoop = { cancel: () => { go = false; } };
  loopsByGhostId.set(ghostId, handle);
  console.info(
    JSON.stringify({
      kind: "random-agent.movement.start",
      ghostId,
      intervalMs: moveMs,
    }),
  );
  try {
    while (go) {
      const w = (await mcp.callTool("whereami", {})) as { h3Index?: string; tileId?: string };
      const cell = w.h3Index && w.h3Index.length > 0 ? w.h3Index : w.tileId;
      if (typeof cell === "string") {
        assertH3Res15(cell, "whereami", ghostId);
      }
      const ex = (await mcp.callTool("exits", {})) as { exits?: ReadonlyArray<{ toward?: string }> };
      const exits = ex.exits ?? [];
      if (exits.length === 0) {
        continue;
      }
      const pick = exits[Math.floor(Math.random() * exits.length)]!;
      const toward = pick.toward;
      if (typeof toward === "string" && toward.length > 0) {
        try {
          const r = (await mcp.callTool("go", { toward })) as { ok?: boolean; tileId?: string };
          if (r?.ok === true && typeof r.tileId === "string") {
            assertH3Res15(r.tileId, "go", ghostId);
          }
        } catch (e) {
          // `GhostMcpClient` throws on MCP `isError` (RULESET_DENY, TILE_FULL, MOVEMENT_BLOCKED, …).
          // Always taking `exits[0]` used to kill the loop on first denial so only “lucky” ghosts moved.
          const msg = e instanceof Error ? e.message : String(e);
          console.info(
            JSON.stringify({
              kind: "random-agent.movement.go-rejected",
              ghostId,
              toward,
              message: msg.length > 200 ? `${msg.slice(0, 197)}…` : msg,
            }),
          );
        }
      }
      await new Promise((r) => setTimeout(r, moveMs));
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
      void startMovementFromSpawn(this.getMoveInterval, sp).catch((e) =>
        console.error(`[random-agent] movement ghostId=${sp.ghostId}`, e),
      );
      // Wanderer tier: sendSpawnContext polls for terminal state, so we must complete.
      // Social/listener tier: startPushSpawnContext uses blocking:false and keeps the task
      // open for future sendWorldEvent deliveries — publishing "completed" would close it.
      if (sp.ghostCard.class === "wanderer") {
        const done: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: t.id,
          contextId: contextId ?? t.contextId,
          final: true,
          status: { state: "completed", timestamp: new Date().toISOString() },
        };
        eventBus.publish(done);
      }
      eventBus.finished();
      return;
    }
    const ev = asWorldEvent(userMessage);
    if (ev?.kind === "world.message.new") {
      const pl = ev.payload as { text?: string; priority?: string; from?: string };
      if (pl.priority === "PARTNER" && typeof pl.from === "string" && typeof pl.text === "string") {
        const mcp = mcpByGhostId.get(ev.ghostId);
        if (mcp) {
          void mcp.callTool("say", { content: `👻 received: ${pl.text}`, to: pl.from }).catch((e) => {
            console.error(JSON.stringify({ kind: "random-agent.say-fail", ghostId: ev.ghostId, message: e instanceof Error ? e.message : String(e) }));
          });
        }
      }
      if (taskId) {
        const done: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId,
          contextId: contextId ?? "",
          final: true,
          status: { state: "completed", timestamp: new Date().toISOString() },
        };
        eventBus.publish(done);
      }
      eventBus.finished();
      return;
    }

    if (userMessage && userText(userMessage).toLowerCase() === "healthcheck") {
      const reply: Message = {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        contextId,
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
