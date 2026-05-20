import { loadRootEnv } from "@aie-matrix/root-env";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import express, { type Request, type RequestHandler, type Response } from "express";
import { buildListenerAgentCard } from "./buildListenerAgentCard.js";
import { getTckState, ObserverListenerExecutor } from "./executor.js";

loadRootEnv();

function listenPortFromEnv(fallback: number): number {
  const raw = process.env.AGENT_PORT;
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65_536 ? n : fallback;
}

const dev = process.env.GHOST_HOUSE_DEV_TOKEN ?? "";
const port = listenPortFromEnv(4002);
const publicBase = (process.env.OBSERVER_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(
  /\/$/,
  "",
);
const agentCard = buildListenerAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new ObserverListenerExecutor(),
);

const requireToken: RequestHandler = (req: Request, res: Response, next) => {
  if (dev.length === 0) {
    return res.status(500).json({ error: "GHOST_HOUSE_DEV_TOKEN is not set" });
  }
  if (req.headers.authorization === `Bearer ${dev}`) {
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
};

const app = express();
app.use(express.json({ limit: "4mb" }));
app.get("/_tck/observer", requireToken, (_req, res) => {
  res.status(200).json(getTckState());
});
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      kind: "observer-agent.start",
      publicBase,
      port,
      card: `http://127.0.0.1:${port}/.well-known/agent-card.json`,
    }),
  );
});
