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

type MoveLoop = { cancel: () => void };

let globalLoop: MoveLoop | null = null;

function assertH3Res15(h3: string, step: string): void {
  if (!isValidCell(h3) || getResolution(h3) !== 15) {
    throw new Error(`[random-agent] ${step}: expected H3 res-15, got ${h3}`);
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

async function startMovementFromSpawn(b: () => string | undefined, ctx: SpawnContext): Promise<void> {
  const mcp = new GhostMcpClient({
    worldApiBaseUrl: ctx.houseEndpoints.mcp,
    token: ctx.token,
  });
  await mcp.connect();
  const moveMs = Math.max(200, parseInt(b() ?? "2000", 10) || 2000);
  let go = true;
  globalLoop = { cancel: () => { go = false; } };
  try {
    while (go) {
      const w = (await mcp.callTool("whereami", {})) as { h3Index?: string; tileId?: string };
      const cell = w.h3Index && w.h3Index.length > 0 ? w.h3Index : w.tileId;
      if (typeof cell === "string") {
        assertH3Res15(cell, "whereami");
      }
      const ex = (await mcp.callTool("exits", {})) as { exits?: ReadonlyArray<{ toward?: string }> };
      const toward = ex.exits?.[0]?.toward;
      if (typeof toward === "string" && toward.length > 0) {
        const r = (await mcp.callTool("go", { toward })) as { ok?: boolean; tileId?: string };
        if (r?.ok === true && typeof r.tileId === "string") {
          assertH3Res15(r.tileId, "go");
        }
      }
      await new Promise((r) => setTimeout(r, moveMs));
    }
  } finally {
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
      globalLoop?.cancel();
      globalLoop = null;
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
      void startMovementFromSpawn(this.getMoveInterval, sp)
        .catch((e) => console.error("[random-agent] movement", e));
      const done: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: t.id,
        contextId: contextId ?? t.contextId,
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

  cancelTask = async (): Promise<void> => {
    globalLoop?.cancel();
    globalLoop = null;
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

