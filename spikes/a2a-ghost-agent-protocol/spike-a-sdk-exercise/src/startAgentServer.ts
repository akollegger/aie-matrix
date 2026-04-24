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
import type { AddressInfo } from "node:net";
import { buildAgentCard } from "./buildAgentCard.js";
import { SpikeDemoExecutor } from "./demoExecutor.js";

export interface RunningAgent {
  readonly baseUrl: string;
  stop: () => Promise<void>;
}

/** Binds to 127.0.0.1; port 0 = ephemeral */
export async function startAgentServer(port = 0): Promise<RunningAgent> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://${addr.address}:${addr.port}`;
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

  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
