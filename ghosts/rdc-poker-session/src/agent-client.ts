/**
 * Thin A2A client wrapper for orchestrator → agent dispatch.
 *
 * Each call sends one typed JSON-data message and polls the resulting
 * task to terminal state, then extracts the typed reply from the
 * task's final-status message. Handles auth, timeouts, and lifecycle.
 */

import { randomUUID } from "node:crypto";

import type { Client } from "@a2a-js/sdk/client";
import type { Message, Task } from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";

const A2A_HEADERS: Record<string, string> = { "A2A-Version": "0.3.0" };

function createAuthedFetch(devToken: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${devToken}`);
    }
    return fetch(input, { ...init, headers });
  };
}

function isTerminal(state: string): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "canceled" ||
    state === "rejected"
  );
}

let cachedFactory: ClientFactory | null = null;
function getFactory(): ClientFactory {
  if (cachedFactory === null) {
    const dev = process.env.AGENT_HOST_TOKEN ?? "";
    if (dev.length === 0) {
      throw new Error(
        "AGENT_HOST_TOKEN is not set — the orchestrator can't authenticate to agents.",
      );
    }
    const opts = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [
        new JsonRpcTransportFactory({
          fetchImpl: createAuthedFetch(dev),
        }),
      ],
    });
    cachedFactory = new ClientFactory(opts);
  }
  return cachedFactory;
}

const clientCache = new Map<string, Promise<Client>>();

/**
 * Get or create a Client for an agent's public base URL. Caches by URL
 * so the orchestrator doesn't re-fetch agent cards per turn.
 */
export function getAgentClient(publicBase: string): Promise<Client> {
  const base = publicBase.replace(/\/$/, "");
  const existing = clientCache.get(base);
  if (existing) return existing;
  const fresh = getFactory().createFromUrl(base);
  clientCache.set(base, fresh);
  fresh.catch(() => clientCache.delete(base));
  return fresh;
}

/**
 * Send a typed data payload to an agent and wait for the terminal
 * task with a reply. Returns the data payload from the task's final
 * status message, or null if the task ended without a data reply.
 */
export async function sendDataAndAwaitReply(
  client: Client,
  data: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const message: Message = {
    kind: "message",
    messageId: randomUUID(),
    role: "user",
    parts: [{ kind: "data", data }],
  };
  const result = await client.sendMessage(
    { message },
    {
      serviceParameters: A2A_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  // sendMessage returns either Message (sync) or Task (async). For our
  // use case the agent always emits a Task (the executor publishes a
  // Task at the start), so we poll for terminal.
  let task: Task;
  if ((result as Task).kind === "task") {
    task = result as Task;
  } else {
    // Sync message path — extract the data part directly.
    const m = result as Message;
    return extractDataPart(m);
  }

  const deadline = Date.now() + timeoutMs;
  while (!isTerminal(task.status.state) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    task = await client.getTask(
      { id: task.id, historyLength: 8 },
      { serviceParameters: A2A_HEADERS },
    );
  }
  if (!isTerminal(task.status.state)) {
    throw new Error(
      `agent task ${task.id} did not reach terminal state in ${timeoutMs}ms (state=${task.status.state})`,
    );
  }
  if (task.status.state !== "completed") {
    throw new Error(
      `agent task ${task.id} ended in ${task.status.state}`,
    );
  }
  const final = task.status.message;
  if (final) return extractDataPart(final);
  return null;
}

function extractDataPart(m: Message): Record<string, unknown> | null {
  for (const p of m.parts) {
    if (p.kind === "data" && "data" in p) {
      return p.data as Record<string, unknown>;
    }
  }
  return null;
}
