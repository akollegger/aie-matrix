import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { buildSampleAgentCard } from "./buildAgentCard.js";
import { SampleContributedExecutor } from "./executor.js";

const port = Number(process.env.PORT ?? 4731);
const publicBase = `http://127.0.0.1:${port}`;
const agentCard = buildSampleAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new SampleContributedExecutor(),
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

app.listen(port, "127.0.0.1", () => {
  console.log(`[spike-b-sample-agent] listening ${publicBase}`);
});
