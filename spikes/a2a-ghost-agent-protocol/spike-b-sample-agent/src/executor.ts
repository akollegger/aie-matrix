import type { Message } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { v4 as uuidv4 } from "uuid";

function userText(userMessage: Message | undefined): string {
  if (!userMessage?.parts) return "";
  for (const p of userMessage.parts) {
    if (p.kind === "text" && "text" in p) return p.text;
  }
  return "";
}

export class SampleContributedExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const contextId = requestContext.contextId;

    if (userMessage?.parts) {
      for (const p of userMessage.parts) {
        if (p.kind === "data" && "data" in p) {
          const d = p.data as Record<string, unknown>;
          if (d.schema === "aie-matrix.spike.synthetic-world-event.v1") {
            const eventId = String(d.eventId ?? "");
            const reply: Message = {
              kind: "message",
              messageId: uuidv4(),
              role: "agent",
              parts: [
                {
                  kind: "data",
                  data: {
                    schema: "aie-matrix.spike.agent-response.v1",
                    inReplyTo: eventId,
                    received: true,
                    note: "spike-b-sample-agent handled synthetic event",
                  },
                },
              ],
              contextId,
            };
            eventBus.publish(reply);
            eventBus.finished();
            return;
          }
        }
      }
    }

    const text = userText(userMessage);
    if (text.includes("house:spawn")) {
      const reply: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ kind: "text", text: "spawn-ack" }],
        contextId,
      };
      eventBus.publish(reply);
      eventBus.finished();
      return;
    }

    const reply: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      parts: [{ kind: "text", text: `unhandled:${text}` }],
      contextId,
    };
    eventBus.publish(reply);
    eventBus.finished();
  }

  cancelTask = async (): Promise<void> => {};
}
