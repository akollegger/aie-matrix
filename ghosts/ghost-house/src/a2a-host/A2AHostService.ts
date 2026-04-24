import { Context, Layer } from "effect";
import { randomUUID } from "node:crypto";
import type { Message, Task } from "@a2a-js/sdk";
import type { Client } from "@a2a-js/sdk/client";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import type { SpawnContext } from "../types.js";
import { SpawnTimeout } from "../errors.js";

const A2A_PROTO_HEADERS: Record<string, string> = { "A2A-Version": "0.3.0" };

function createAuthedFetch(devToken: string, timeoutMs: number | undefined): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${devToken}`);
    }
    return fetch(input, {
      ...init,
      headers,
      signal: init?.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
    });
  };
}

function isTerminalState(s: string): boolean {
  return s === "completed" || s === "failed" || s === "canceled" || s === "rejected";
}

export interface IA2AHostService {
  /** Outbound A2A client to a contributed agent’s base URL. */
  readonly createClient: (baseUrl: string) => Promise<Client>;
  /** First spawn task (IC-006) — blocks until the task is terminal or timeout. */
  readonly sendSpawnContext: (
    client: Client,
    context: SpawnContext,
    options?: { timeoutMs?: number },
  ) => Promise<{ taskId: string; contextId?: string }>;
  /** Best-effort cancel (spawn / stream task). */
  readonly cancelTask: (client: Client, taskId: string) => Promise<void>;
}

export class A2AHostService extends Context.Tag("ghost-house/A2AHostService")<
  A2AHostService,
  IA2AHostService
>() {}

export const createA2AHostService = (devToken: string): IA2AHostService => {
  const clientOptions = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [
      new JsonRpcTransportFactory({
        fetchImpl: createAuthedFetch(devToken, 60_000),
      }),
    ],
  });
  const factory = new ClientFactory(clientOptions);
  return {
    createClient: (baseUrl: string) => factory.createFromUrl(baseUrl),
    sendSpawnContext: async (client, context, options) => {
      const timeoutMs = options?.timeoutMs ?? 30_000;
      const message: Message = {
        kind: "message",
        messageId: randomUUID(),
        role: "user",
        parts: [
          {
            kind: "data",
            data: context as unknown as Record<string, unknown>,
          },
        ],
      };
      const result = await client.sendMessage(
        { message },
        {
          serviceParameters: A2A_PROTO_HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (result.kind === "message") {
        return { taskId: randomUUID() };
      }
      const task = result as Task;
      const taskId = task.id;
      const contextId = task.contextId;
      let t: Task = task;
      const deadline = Date.now() + timeoutMs;
      while (!isTerminalState(t.status.state) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        t = await client.getTask(
          { id: taskId, historyLength: 4 },
          { serviceParameters: A2A_PROTO_HEADERS },
        );
      }
      if (!isTerminalState(t.status.state)) {
        throw new SpawnTimeout({ message: "spawn task did not complete in time" });
      }
      if (t.status.state === "failed" || t.status.state === "canceled" || t.status.state === "rejected") {
        throw new SpawnTimeout({ message: `spawn task ended in ${t.status.state}` });
      }
      return { taskId, contextId };
    },
    cancelTask: async (client, taskId) => {
      try {
        await client.cancelTask(
          { id: taskId },
          { serviceParameters: A2A_PROTO_HEADERS, signal: AbortSignal.timeout(10_000) },
        );
      } catch {
        /* best effort */
      }
    },
  };
};

export const A2AHostServiceLive = (devToken: string): Layer.Layer<A2AHostService> =>
  Layer.succeed(A2AHostService, createA2AHostService(devToken));
