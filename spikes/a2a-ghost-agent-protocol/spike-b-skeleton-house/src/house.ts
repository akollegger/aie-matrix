/**
 * Skeleton ghost house: in-memory catalog + spawn + one synthetic A2A message.
 * Primary registration path: POST /v1/catalog/register
 */
import express from "express";
import type { Message } from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import { v4 as uuidv4 } from "uuid";

const PORT = Number(process.env.HOUSE_PORT ?? 4730);

interface CatalogEntry {
  baseUrl: string;
}

const catalog = new Map<string, CatalogEntry>();
const sessions = new Map<string, { agentId: string; baseUrl: string }>();

const clientOptions = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
  transports: [new JsonRpcTransportFactory()],
});

const app = express();
app.use(express.json({ limit: "4mb" }));

app.post("/v1/catalog/register", async (req, res) => {
  try {
    const { agentId, baseUrl } = req.body as {
      agentId?: string;
      baseUrl?: string;
    };
    if (!agentId || !baseUrl) {
      res.status(400).json({ error: "agentId and baseUrl are required" });
      return;
    }
    const normalized = baseUrl.replace(/\/$/, "");
    const factory = new ClientFactory(clientOptions);
    const client = await factory.createFromUrl(normalized);
    await client.getAgentCard();
    catalog.set(agentId, { baseUrl: normalized });
    console.log("[CATALOG] registered agentId=%s baseUrl=%s", agentId, normalized);
    res.json({ ok: true, agentId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/v1/catalog", (_req, res) => {
  res.json({
    agents: [...catalog.entries()].map(([id, e]) => ({
      agentId: id,
      baseUrl: e.baseUrl,
    })),
  });
});

app.post("/v1/catalog/spawn/:agentId", async (req, res) => {
  try {
    const entry = catalog.get(req.params.agentId);
    if (!entry) {
      res.status(404).json({ error: "unknown agentId" });
      return;
    }
    const factory = new ClientFactory(clientOptions);
    const client = await factory.createFromUrl(entry.baseUrl);
    const spawnMsg: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "user",
      parts: [{ kind: "text", text: "house:spawn" }],
    };
    const first = await client.sendMessage({ message: spawnMsg });
    const sessionId = uuidv4();
    sessions.set(sessionId, {
      agentId: req.params.agentId,
      baseUrl: entry.baseUrl,
    });
    console.log(
      "[SESSION_START] sessionId=%s agentId=%s firstResponse=%s",
      sessionId,
      req.params.agentId,
      JSON.stringify(first).slice(0, 240),
    );
    res.json({ sessionId, agentId: req.params.agentId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/v1/sessions/:sessionId/synthetic-event", async (req, res) => {
  try {
    const s = sessions.get(req.params.sessionId);
    if (!s) {
      res.status(404).json({ error: "unknown sessionId" });
      return;
    }
    const factory = new ClientFactory(clientOptions);
    const client = await factory.createFromUrl(s.baseUrl);
    const eventId = `01J${uuidv4().replace(/-/g, "").slice(0, 20)}`;
    const sentAt = new Date().toISOString();
    const dataPart = {
      schema: "aie-matrix.spike.synthetic-world-event.v1",
      eventId,
      kind: "demo.world.tick",
      payload: { message: "Hello from skeleton house" },
      sentAt,
    };
    const msg: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "user",
      parts: [{ kind: "data", data: dataPart }],
    };
    const agentResponse = await client.sendMessage({ message: msg });
    console.log(
      "[SYNTHETIC_EVENT] sessionId=%s response=%s",
      req.params.sessionId,
      JSON.stringify(agentResponse).slice(0, 500),
    );
    res.json({ ok: true, eventId, agentResponse });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(
    "[spike-b-skeleton-house] http://127.0.0.1:%d — primary path: POST /v1/catalog/register",
    PORT,
  );
});
