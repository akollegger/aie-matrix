/**
 * Spike A smoke: sync task, streaming task, push notification, agent card discovery.
 * Run from package root: npm run smoke
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Client } from "@a2a-js/sdk/client";
import type { Message, Task } from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import { v4 as uuidv4 } from "uuid";
import { startAgentServer } from "./startAgentServer.js";

function isTask(x: unknown): x is Task {
  return typeof x === "object" && x !== null && (x as Task).kind === "task";
}

function isMessage(x: unknown): x is Message {
  return typeof x === "object" && x !== null && (x as Message).kind === "message";
}

async function startPushWebhook(): Promise<{
  url: string;
  waitBody: () => Promise<string>;
  close: () => Promise<void>;
}> {
  let resolveBody!: (body: string) => void;
  const bodyPromise = new Promise<string>((resolve) => {
    resolveBody = resolve;
  });
  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        resolveBody(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    waitBody: () => bodyPromise,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

async function exerciseAgentCard(client: Client): Promise<void> {
  const c = await client.getAgentCard();
  if (c.name !== "spike-a-demo-agent") throw new Error("card: bad name");
  console.log("[spike-a] agent card OK", c.name);
}

async function exerciseSync(client: Client): Promise<void> {
  const msg: Message = {
    kind: "message",
    messageId: uuidv4(),
    role: "user",
    parts: [{ kind: "text", text: "sync-ping hello" }],
  };
  const result = await client.sendMessage({ message: msg });
  if (!isMessage(result))
    throw new Error(
      `sync: expected Message, got ${JSON.stringify(result).slice(0, 200)}`,
    );
  const t = result.parts.find((p) => p.kind === "text");
  if (t?.kind !== "text" || !t.text.includes("echo:sync-ping hello")) {
    throw new Error(`sync: bad echo ${JSON.stringify(result)}`);
  }
  console.log("[spike-a] sync OK");
}

async function exerciseStream(client: Client): Promise<void> {
  const msg: Message = {
    kind: "message",
    messageId: uuidv4(),
    role: "user",
    parts: [{ kind: "text", text: "stream-demo" }],
  };
  const events: string[] = [];
  for await (const ev of client.sendMessageStream({ message: msg })) {
    if (isTask(ev)) events.push(`task:${ev.status.state}`);
    else if ((ev as { kind?: string }).kind === "status-update")
      events.push("status-update");
  }
  if (!events.length) throw new Error("stream: no events");
  console.log("[spike-a] stream OK", events.join(","));
}

async function exercisePush(client: Client): Promise<void> {
  const sink = await startPushWebhook();
  try {
    const msg: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "user",
      parts: [{ kind: "text", text: "push-demo" }],
    };
    const result = await client.sendMessage({
      message: msg,
      configuration: { blocking: false },
    });
    if (!isTask(result)) {
      throw new Error(
        `push: expected Task (non-blocking), got ${JSON.stringify(result).slice(0, 300)}`,
      );
    }
    await client.setTaskPushNotificationConfig({
      taskId: result.id,
      pushNotificationConfig: {
        id: "spike-a-push",
        url: sink.url,
        token: "spike-token",
      },
    });
    const body = await Promise.race([
      sink.waitBody(),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("push webhook timeout")), 8000),
      ),
    ]);
    if (body.length < 2) {
      throw new Error(`push: unexpected body ${body.slice(0, 500)}`);
    }
    console.log("[spike-a] push OK (webhook received bytes:", body.length, ")");
  } finally {
    await sink.close();
  }
}

async function main(): Promise<void> {
  const agent = await startAgentServer(0);
  try {
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory()],
      }),
    );
    const client = await factory.createFromUrl(agent.baseUrl);

    await exerciseAgentCard(client);
    await exerciseSync(client);
    await exerciseStream(client);
    await exercisePush(client);

    console.log("\nSPIKE_A_SMOKE_OK");
  } finally {
    await agent.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
