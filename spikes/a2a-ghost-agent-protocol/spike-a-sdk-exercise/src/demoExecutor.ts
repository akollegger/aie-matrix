import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { v4 as uuidv4 } from "uuid";

function textFromUserMessage(userMessage: Message | undefined): string {
  if (!userMessage?.parts) return "";
  for (const p of userMessage.parts) {
    if (p.kind === "text" && "text" in p) return p.text;
  }
  return "";
}

export class SpikeDemoExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const text = textFromUserMessage(requestContext.userMessage);
    const contextId = requestContext.contextId;
    const taskId = requestContext.taskId ?? uuidv4();

    if (text.includes("push-demo")) {
      if (!requestContext.task) {
        const initial: Task = {
          kind: "task",
          id: taskId,
          contextId,
          status: {
            state: "working",
            timestamp: new Date().toISOString(),
          },
          history: requestContext.userMessage
            ? [requestContext.userMessage]
            : [],
          artifacts: [],
        };
        eventBus.publish(initial);
      }
      await new Promise((r) => setTimeout(r, 500));
      const done: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        final: true,
        status: {
          state: "completed",
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(done);
      eventBus.finished();
      return;
    }

    if (text.includes("stream-demo")) {
      const tid = requestContext.task?.id ?? taskId;
      const cid = contextId;
      if (!requestContext.task) {
        const initial: Task = {
          kind: "task",
          id: tid,
          contextId: cid,
          status: {
            state: "submitted",
            timestamp: new Date().toISOString(),
          },
          history: requestContext.userMessage
            ? [requestContext.userMessage]
            : [],
          artifacts: [],
        };
        eventBus.publish(initial);
      }
      const mkAgentMsg = (body: string): Message => ({
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ kind: "text", text: body }],
        taskId: tid,
        contextId: cid,
      });
      const u1: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: tid,
        contextId: cid,
        final: false,
        status: {
          state: "working",
          message: mkAgentMsg("chunk-1"),
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(u1);
      const u2: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: tid,
        contextId: cid,
        final: false,
        status: {
          state: "working",
          message: mkAgentMsg("chunk-2"),
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(u2);
      const u3: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: tid,
        contextId: cid,
        final: true,
        status: {
          state: "completed",
          message: mkAgentMsg("final"),
          timestamp: new Date().toISOString(),
        },
      };
      eventBus.publish(u3);
      eventBus.finished();
      return;
    }

    const responseMessage: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      parts: [{ kind: "text", text: `echo:${text}` }],
      contextId: requestContext.contextId,
      ...(requestContext.taskId ? { taskId: requestContext.taskId } : {}),
    };
    eventBus.publish(responseMessage);
    eventBus.finished();
  }

  cancelTask = async (): Promise<void> => {};
}
