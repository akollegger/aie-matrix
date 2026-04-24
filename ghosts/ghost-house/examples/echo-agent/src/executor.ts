import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { randomUUID } from "node:crypto";
import type { WorldEvent } from "./world-event.js";
import type { SpawnContext } from "./spawn-types.js";

const tckState = { mcpSayTexts: [] as string[], worldEvents: 0 };

export function getEchoTckState(): { readonly mcpSayTexts: readonly string[]; readonly worldEvents: number } {
  return tckState;
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

function asWorldEvent(msg: Message | undefined): WorldEvent | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.world-event.v1" && d.kind === "world.message.new") {
        return d as unknown as WorldEvent;
      }
    }
  }
  return null;
}

function userText(userMessage: Message | undefined): string {
  for (const p of userMessage?.parts ?? []) {
    if (p.kind === "text" && "text" in p) {
      return p.text;
    }
  }
  return "";
}

let activeMcp: GhostMcpClient | null = null;

function pushSay(text: string) {
  void (async () => {
    if (!activeMcp) {
      return;
    }
    try {
      if (!text || text.length === 0) {
        return;
      }
      await activeMcp.say(text);
      tckState.mcpSayTexts.push(text);
    } catch (e) {
      console.error(
        JSON.stringify({
          kind: "echo-agent.say-fail",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();
}

export class SocialEchoExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();
    const sp = parseSpawnData(userMessage);
    if (sp) {
      const mcp = new GhostMcpClient({
        worldApiBaseUrl: sp.houseEndpoints.mcp,
        token: sp.token,
      });
      try {
        await mcp.connect();
        activeMcp = mcp;
      } catch (e) {
        console.error(
          JSON.stringify({
            kind: "echo-agent.mcp-connect-fail",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        activeMcp = null;
      }
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
      const w1: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: t.id,
        contextId: contextId ?? t.contextId,
        final: false,
        status: { state: "working", timestamp: new Date().toISOString() },
      };
      eventBus.publish(w1);
      eventBus.finished();
      return;
    }
    const ev = asWorldEvent(userMessage);
    if (ev) {
      tckState.worldEvents += 1;
      const pl = ev.payload as { text?: string; role?: string } | null;
      const text = typeof pl?.text === "string" ? pl.text : "";
      if (text.length > 0) {
        pushSay(text);
      }
      eventBus.finished();
      return;
    }
    if (userText(userMessage).toLowerCase() === "healthcheck") {
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
    eventBus.finished();
  }

  cancelTask = async (): Promise<void> => {
    const m = activeMcp;
    activeMcp = null;
    if (m) {
      await m.disconnect().catch(() => {});
    }
  };
}
