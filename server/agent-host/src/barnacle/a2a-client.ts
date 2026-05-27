/**
 * Thin A2A client used by the Barnacle supervisor to send typed data
 * messages to peppers (pause/resume/encounter) and to mini-games
 * (handoff/heartbeat). Polls the resulting task to terminal and
 * returns the reply data part, if any.
 *
 * Self-contained so ghost-house doesn't take a dep on any ghost-side
 * package. Same shape as `rdc-poker-session`'s agent-client but kept
 * local — the supervisor and the session sit on opposite sides of the
 * Barnacle contract; their A2A helpers should not share code.
 */
import { randomUUID } from "node:crypto";

import type { Client, ClientFactory as ClientFactoryType } from "@a2a-js/sdk/client";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import type { Message, Task } from "@a2a-js/sdk";

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

let cachedFactory: ClientFactoryType | null = null;
function getFactory(devToken: string): ClientFactoryType {
  if (cachedFactory !== null) return cachedFactory;
  const opts = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [
      new JsonRpcTransportFactory({ fetchImpl: createAuthedFetch(devToken) }),
    ],
  });
  cachedFactory = new ClientFactory(opts);
  return cachedFactory;
}

const clientCache = new Map<string, Promise<Client>>();

/** Get or create an A2A client for a base URL. Cached by URL. */
export function getBarnacleA2AClient(
  baseUrl: string,
  devToken: string,
): Promise<Client> {
  const base = baseUrl.replace(/\/$/, "");
  const cached = clientCache.get(base);
  if (cached) return cached;
  const fresh = getFactory(devToken).createFromUrl(base);
  clientCache.set(base, fresh);
  fresh.catch(() => clientCache.delete(base));
  return fresh;
}

function isTerminal(state: string): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "canceled" ||
    state === "rejected"
  );
}

function extractDataPart(m: Message): Record<string, unknown> | null {
  for (const p of m.parts) {
    if (p.kind === "data" && "data" in p) {
      return p.data as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * POST a single typed data message and await the terminal task's
 * reply data part. Returns `null` if the task completed with no data
 * artifact. Throws on timeout, non-terminal exit, or transport error.
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

  let task: Task;
  if ((result as Task).kind === "task") {
    task = result as Task;
  } else {
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
      `task ${task.id} did not reach terminal state in ${timeoutMs}ms (state=${task.status.state})`,
    );
  }
  if (task.status.state !== "completed") {
    throw new Error(`task ${task.id} ended in ${task.status.state}`);
  }
  const final = task.status.message;
  return final ? extractDataPart(final) : null;
}
