import { loadRootEnv } from "@aie-matrix/root-env";
import { Layer } from "effect";
import express, { type Request, type Response } from "express";
import { A2AHostServiceLive, createA2AHostService } from "./a2a-host/A2AHostService.js";
import { buildHouseAgentCard } from "./house-agent-card.js";
import { mapHouseError } from "./http-error-map.js";
import { McpProxyServiceLive, makeMcpProxy } from "./mcp-proxy/mcp-proxy.layer.js";
import { createCatalogService, CatalogServiceLive } from "./catalog/CatalogService.js";
import { AgentSupervisorLayer, makeTestSupervisor } from "./supervisor/SupervisorService.js";
import {
  ActiveSessionsPreventDeregister,
  AgentNotFound,
  McpToolRejected,
  SessionNotFound,
  Unauthorized,
} from "./errors.js";
import type { WorldCredential } from "./types.js";

loadRootEnv();

const devToken = process.env.GHOST_HOUSE_DEV_TOKEN ?? "";
const port = (() => {
  const p = process.env.GHOST_HOUSE_PORT;
  if (p == null || p === "") {
    return 4000;
  }
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : 4000;
})();
const catalogFilePath = process.env.CATALOG_FILE_PATH ?? "./catalog.json";
const publicBase =
  (process.env.GHOST_HOUSE_PUBLIC_BASE_URL ?? "").replace(/\/$/, "") ||
  `http://127.0.0.1:${port}`;

if (devToken.length === 0) {
  console.error("GHOST_HOUSE_DEV_TOKEN is required");
  process.exit(1);
}

const base = Layer.mergeAll(CatalogServiceLive(catalogFilePath), A2AHostServiceLive(devToken));

/** Composed layer for `pnpm typecheck` / future ManagedRuntime wiring (T010). */
export const appLayer = Layer.mergeAll(
  base,
  McpProxyServiceLive,
  Layer.provide(
    AgentSupervisorLayer({ publicHouseBaseUrl: publicBase, defaultCapabilityManifest: new Set() }),
    base,
  ),
);

const catalog = createCatalogService(catalogFilePath);
const a2a = createA2AHostService(devToken);
const mcp = makeMcpProxy();
const supervisor = makeTestSupervisor({
  catalog,
  a2a,
  publicHouseBaseUrl: publicBase,
  defaultCapabilityManifest: new Set(),
});

function requireBearer(req: Request): void {
  if (req.headers.authorization !== `Bearer ${devToken}`) {
    throw new Unauthorized({ message: "invalid or missing Authorization" });
  }
}

function getBearerValue(req: Request): string | null {
  const a = req.headers.authorization;
  if (!a?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return a.slice(7).trim();
}

const app = express();

async function handleMcp(req: Request, res: Response): Promise<void> {
  const tok = getBearerValue(req);
  if (!tok) {
    res.status(401).json({ error: "missing Authorization", code: "UNAUTHORIZED" });
    return;
  }
  const session = supervisor.getByMcpToken(tok);
  if (!session) {
    res.status(401).json({ error: "unknown mcp session token", code: "UNAUTHORIZED" });
    return;
  }
  try {
    if (req.method === "GET") {
      const wUrl = session.worldCredential.worldApiBaseUrl;
      const f = await fetch(wUrl, { method: "GET", headers: { connection: "close" } });
      res.status(f.status);
      f.headers.forEach((v, k) => {
        if (k === "transfer-encoding" || k === "connection") {
          return;
        }
        res.setHeader(k, v);
      });
      res.send(Buffer.from(await f.arrayBuffer()));
      return;
    }
    const buf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
    if (req.method === "POST" && buf.length > 0) {
      mcp.assertToolAllowed(session, req.method, buf);
    }
    const wUrl = session.worldCredential.worldApiBaseUrl;
    const f = await fetch(wUrl, {
      method: "POST",
      headers: {
        "content-type": (req.headers["content-type"] as string) || "application/json",
        authorization: `Bearer ${session.worldCredential.token}`,
        ...(req.headers["mcp-protocol-version"]
          ? { "mcp-protocol-version": String(req.headers["mcp-protocol-version"]) }
          : {}),
        connection: "close",
      },
      body: buf,
    });
    res.status(f.status);
    f.headers.forEach((v, k) => {
      if (k === "transfer-encoding" || k === "connection") {
        return;
      }
      res.setHeader(k, v);
    });
    res.send(Buffer.from(await f.arrayBuffer()));
  } catch (e) {
    if (e instanceof McpToolRejected) {
      res.status(403).json(mapHouseError(e).body);
      return;
    }
    const m = mapHouseError(e);
    res.status(m.status).json(m.body);
  }
}

app.post(
  "/v1/mcp",
  express.raw({ type: () => true, limit: "20mb" }) as never,
  (req, res, next) => {
    void handleMcp(req, res).catch(next);
  },
);
app.get("/v1/mcp", (req, res, next) => {
  void handleMcp(req, res).catch(next);
});

app.use(express.json({ limit: "4mb" }));

app.get("/.well-known/agent-card.json", (_req, res) => {
  res
    .status(200)
    .type("json")
    .send(JSON.stringify(buildHouseAgentCard(publicBase), null, 2) + "\n");
});

app.get("/v1/catalog", async (req, res) => {
  try {
    requireBearer(req);
    const list = await catalog.list();
    return res.status(200).json({ agents: list });
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.get("/v1/catalog/:agentId", async (req, res) => {
  try {
    requireBearer(req);
    const entry = await catalog.get(req.params.agentId!);
    return res.status(200).type("json").send(JSON.stringify(entry.agentCard, null, 2) + "\n");
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    if (e instanceof AgentNotFound) {
      return res.status(404).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.post("/v1/catalog/register", async (req, res) => {
  try {
    requireBearer(req);
    const body = req.body as { agentId?: string; baseUrl?: string } | null;
    if (!body || typeof body.agentId !== "string" || typeof body.baseUrl !== "string") {
      return res
        .status(400)
        .json({ error: "agentId and baseUrl are required", code: "VALIDATION_FAILED" });
    }
    const out = await catalog.register({ agentId: body.agentId, baseUrl: body.baseUrl, builtIn: false });
    return res.status(201).json({ ok: true, agentId: out.agentId });
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.delete("/v1/catalog/:agentId", async (req, res) => {
  try {
    requireBearer(req);
    const agentId = req.params.agentId!;
    const sids = supervisor.listSessionIdsByAgent(agentId);
    if (sids.length > 0) {
      throw new ActiveSessionsPreventDeregister({ agentId, count: sids.length });
    }
    await catalog.deregister(agentId);
    return res.status(200).json({ ok: true, agentId });
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    if (e instanceof ActiveSessionsPreventDeregister) {
      return res.status(409).json(mapHouseError(e).body);
    }
    if (e instanceof AgentNotFound) {
      return res.status(404).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.post("/v1/sessions/spawn/:agentId", async (req, res) => {
  try {
    requireBearer(req);
    const agentId = req.params.agentId!;
    const b = req.body as {
      ghostId?: string;
      credential?: { token?: string; worldApiBaseUrl?: string };
    } | null;
    if (!b || typeof b.ghostId !== "string") {
      return res.status(400).json({ error: "ghostId is required", code: "VALIDATION_FAILED" });
    }
    if (
      !b.credential ||
      typeof b.credential.token !== "string" ||
      typeof b.credential.worldApiBaseUrl !== "string"
    ) {
      return res.status(400).json({
        error: "credential.token and credential.worldApiBaseUrl are required",
        code: "VALIDATION_FAILED",
      });
    }
    const worldCredential: WorldCredential = {
      token: b.credential.token,
      worldApiBaseUrl: b.credential.worldApiBaseUrl,
    };
    const session = await supervisor.spawn({ agentId, ghostId: b.ghostId, credential: worldCredential });
    return res.status(201).json({
      sessionId: session.sessionId,
      agentId: session.agentId,
      ghostId: session.ghostId,
      mcpToken: session.mcpToken,
    });
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.delete("/v1/sessions/:sessionId", async (req, res) => {
  try {
    requireBearer(req);
    const sessionId = req.params.sessionId!;
    await supervisor.shutdown(sessionId);
    return res.status(200).json({ ok: true, sessionId });
  } catch (e) {
    if (e instanceof Unauthorized) {
      return res.status(401).json(mapHouseError(e).body);
    }
    if (e instanceof SessionNotFound) {
      return res.status(404).json(mapHouseError(e).body);
    }
    const m = mapHouseError(e);
    return res.status(m.status).json(m.body);
  }
});

app.use(
  (err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      return;
    }
    if (err instanceof Error) {
      return res.status(500).json({ error: err.message, code: "INTERNAL" });
    }
    return res.status(500).json({ error: "internal", code: "INTERNAL" });
  },
);

const server = app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({ kind: "ghost-house.start", publicBase, port, catalog: catalogFilePath }),
  );
});

const shutdown = async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
