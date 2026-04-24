import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import {
  DefaultPushNotificationSender,
  DefaultRequestHandler,
  InMemoryPushNotificationStore,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { buildAgentCard } from "./buildAgentCard.js";
import { SpikeDemoExecutor } from "./demoExecutor.js";

export interface RunningAgent {
  readonly baseUrl: string;
  stop: () => Promise<void>;
}

/** Reserve a free TCP port (used when `requestedPort === 0` so routes exist before listen). */
function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address() as AddressInfo;
      const p = addr.port;
      s.close((err) => {
        if (err) reject(err);
        else resolve(p);
      });
    });
  });
}

/** Binds to 127.0.0.1; port 0 = pick a free port first, then mount routes, then listen (no accept race). */
export async function startAgentServer(requestedPort = 0): Promise<RunningAgent> {
  const actualPort =
    requestedPort === 0 ? await reserveLocalPort() : requestedPort;
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  const agentCard = buildAgentCard(baseUrl);

  const pushStore = new InMemoryPushNotificationStore();
  const pushSender = new DefaultPushNotificationSender(pushStore);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new SpikeDemoExecutor(),
    undefined,
    pushStore,
    pushSender,
  );

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    "/a2a/jsonrpc",
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = app.listen(actualPort, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
