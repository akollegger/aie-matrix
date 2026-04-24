import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import type { SpawnContext } from "./spawn-types.js";

const maxTck = 200;

const worldEventLog: Array<Record<string, unknown>> = [];

export function getTckState(): { readonly worldEvents: readonly unknown[]; readonly sayEmissions: 0 } {
  return { worldEvents: worldEventLog.slice(-maxTck), sayEmissions: 0 };
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

function takeWorldEvent(msg: Message | undefined): Record<string, unknown> | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.world-event.v1") {
        return d;
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

export class ObserverListenerExecutor implements AgentExecutor {
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
    const ev = takeWorldEvent(userMessage);
    if (ev) {
      worldEventLog.push(ev);
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
    /* no-op: nothing long-running in executor */
  };
}
