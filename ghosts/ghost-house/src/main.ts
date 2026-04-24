import { loadRootEnv, isEnvTruthy } from "@aie-matrix/root-env";
import { Effect, Layer, ManagedRuntime, pipe } from "effect";
import express, { type Request, type Response } from "express";
import { A2AHostServiceLive } from "./a2a-host/A2AHostService.js";
import { buildHouseAgentCard } from "./house-agent-card.js";
import { mapHouseError } from "./http-error-map.js";
import { McpProxyServiceLive } from "./mcp-proxy/mcp-proxy.layer.js";
import { CatalogServiceLive } from "./catalog/CatalogService.js";
import { readHouseCapabilityManifest } from "./house-capabilities.js";
import { AgentSupervisorLayer } from "./supervisor/SupervisorService.js";
import { CatalogService } from "./catalog/CatalogService.js";
import { AgentSupervisor } from "./supervisor/SupervisorService.js";
import { McpProxyService } from "./mcp-proxy/McpProxyService.js";
import { ActiveSessionsPreventDeregister, Unauthorized } from "./errors.js";
import { startColyseusWorldBridge, type ColyseusWorldBridgeHandle } from "./colyseus-bridge/ColyseusWorldBridge.js";
import type { WorldCredential } from "./types.js";

loadRootEnv();

const devToken = process.env.GHOST_HOUSE_DEV_TOKEN ?? "";
const port = (() => {
  const p = process.env.GHOST_HOUSE_PORT;
  if (p == null || p === "") return 4000;
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : 4000;
})();
const catalogFilePath = process.env.CATALOG_FILE_PATH ?? "./catalog.json";
const publicBase =
  (process.env.GHOST_HOUSE_PUBLIC_BASE_URL ?? "").replace(/\/$/, "") ||
  `http://127.0.0.1:${port}`;
const worldHttpBase = (process.env.AIE_MATRIX_HTTP_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

if (devToken.length === 0) {
  console.error("GHOST_HOUSE_DEV_TOKEN is required");
  process.exit(1);
}

const base = Layer.mergeAll(CatalogServiceLive(catalogFilePath), A2AHostServiceLive(devToken));

export const appLayer = Layer.mergeAll(
  base,
  McpProxyServiceLive,
  Layer.provide(
    AgentSupervisorLayer({
      publicHouseBaseUrl: publicBase,
      defaultCapabilityManifest: readHouseCapabilityManifest(),
    }),
    base,
  ),
);

const runtime = ManagedRuntime.make(appLayer);

const requireBearer = (req: Request): Effect.Effect<void, Unauthorized> =>
  req.headers.authorization === `Bearer ${devToken}`
    ? Effect.void
    : Effect.fail(new Unauthorized({ message: "invalid or missing Authorization" }));

function getBearerValue(req: Request): string | null {
  const a = req.headers.authorization;
  if (!a?.toLowerCase().startsWith("bearer ")) return null;
  return a.slice(7).trim();
}

const app = express();

const handleMcpEffect = (req: Request, res: Response) =>
  Effect.gen(function* () {
    const mcp = yield* McpProxyService;
    const supervisor = yield* AgentSupervisor;

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

    if (req.method === "GET") {
      const wUrl = session.worldCredential.worldApiBaseUrl;
      const f = yield* Effect.tryPromise({
        try: () =>
          fetch(wUrl, {
            method: "GET",
            headers: {
              accept: req.headers.accept?.toString() || "application/json, text/event-stream",
              authorization: `Bearer ${session.worldCredential.token}`,
              connection: "close",
            },
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      res.status(f.status);
      f.headers.forEach((v, k) => {
        if (k === "transfer-encoding" || k === "connection") return;
        res.setHeader(k, v);
      });
      const body = yield* Effect.tryPromise({
        try: () => f.arrayBuffer().then((b) => Buffer.from(b)),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      res.send(body);
      return;
    }

    const buf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
    if (req.method === "POST" && buf.length > 0) {
      yield* mcp.assertToolAllowed(session, req.method, buf);
    }

    const wUrl = session.worldCredential.worldApiBaseUrl;
    const f = yield* Effect.tryPromise({
      try: () =>
        fetch(wUrl, {
          method: "POST",
          headers: {
            accept: req.headers.accept?.toString() || "application/json, text/event-stream",
            "content-type": (req.headers["content-type"] as string) || "application/json",
            authorization: `Bearer ${session.worldCredential.token}`,
            ...(req.headers["mcp-protocol-version"]
              ? { "mcp-protocol-version": String(req.headers["mcp-protocol-version"]) }
              : {}),
            connection: "close",
          },
          body: buf,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    res.status(f.status);
    f.headers.forEach((v, k) => {
      if (k === "transfer-encoding" || k === "connection") return;
      res.setHeader(k, v);
    });
    const body = yield* Effect.tryPromise({
      try: () => f.arrayBuffer().then((b) => Buffer.from(b)),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    res.send(body);
  }).pipe(
    Effect.catchAll((e) =>
      Effect.sync(() => {
        const m = mapHouseError(e);
        res.status(m.status).json(m.body);
      }),
    ),
  );

/** A2A agent → house push target (set via setTaskPushNotificationConfig; dev sink). */
app.post("/v1/internal/a2a-agent-push", express.json({ limit: "4mb" }), (req, res) => {
  const tok = getBearerValue(req);
  if (!tok || tok !== devToken) {
    res.status(401).json({ error: "invalid or missing Authorization", code: "UNAUTHORIZED" });
    return;
  }
  res.status(204).end();
});

app.post(
  "/v1/mcp",
  express.raw({ type: () => true, limit: "20mb" }) as never,
  (req, res) => {
    void runtime.runPromise(handleMcpEffect(req, res));
  },
);
app.get("/v1/mcp", (req, res) => {
  void runtime.runPromise(handleMcpEffect(req, res));
});

app.use(express.json({ limit: "4mb" }));

app.get("/.well-known/agent-card.json", (_req, res) => {
  res
    .status(200)
    .type("json")
    .send(JSON.stringify(buildHouseAgentCard(publicBase), null, 2) + "\n");
});

app.get("/v1/catalog", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const catalog = yield* CatalogService;
      const list = yield* catalog.list();
      res.status(200).json({ agents: list });
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.get("/v1/catalog/:agentId", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const catalog = yield* CatalogService;
      const entry = yield* catalog.get(req.params.agentId!);
      res.status(200).type("json").send(JSON.stringify(entry.agentCard, null, 2) + "\n");
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.post("/v1/catalog/register", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const catalog = yield* CatalogService;
      const body = req.body as { agentId?: string; baseUrl?: string } | null;
      if (!body || typeof body.agentId !== "string" || typeof body.baseUrl !== "string") {
        res.status(400).json({ error: "agentId and baseUrl are required", code: "VALIDATION_FAILED" });
        return;
      }
      const out = yield* catalog.register({ agentId: body.agentId, baseUrl: body.baseUrl, builtIn: false });
      res.status(201).json({ ok: true, agentId: out.agentId });
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.delete("/v1/catalog/:agentId", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const catalog = yield* CatalogService;
      const supervisor = yield* AgentSupervisor;
      const agentId = req.params.agentId!;
      const sids = supervisor.listSessionIdsByAgent(agentId);
      if (sids.length > 0) {
        return yield* Effect.fail(new ActiveSessionsPreventDeregister({ agentId, count: sids.length }));
      }
      yield* catalog.deregister(agentId);
      res.status(200).json({ ok: true, agentId });
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.post("/v1/sessions/spawn/:agentId", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const supervisor = yield* AgentSupervisor;
      const agentId = req.params.agentId!;
      const b = req.body as {
        ghostId?: string;
        credential?: { token?: string; worldApiBaseUrl?: string };
      } | null;
      if (!b || typeof b.ghostId !== "string") {
        res.status(400).json({ error: "ghostId is required", code: "VALIDATION_FAILED" });
        return;
      }
      if (
        !b.credential ||
        typeof b.credential.token !== "string" ||
        typeof b.credential.worldApiBaseUrl !== "string"
      ) {
        res.status(400).json({
          error: "credential.token and credential.worldApiBaseUrl are required",
          code: "VALIDATION_FAILED",
        });
        return;
      }
      const worldCredential: WorldCredential = {
        token: b.credential.token,
        worldApiBaseUrl: b.credential.worldApiBaseUrl,
      };
      const session = yield* supervisor.spawn({ agentId, ghostId: b.ghostId, credential: worldCredential });
      res.status(201).json({
        sessionId: session.sessionId,
        agentId: session.agentId,
        ghostId: session.ghostId,
        mcpToken: session.mcpToken,
      });
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.delete("/v1/sessions/:sessionId", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* requireBearer(req);
      const supervisor = yield* AgentSupervisor;
      const sessionId = req.params.sessionId!;
      yield* supervisor.shutdown(sessionId);
      res.status(200).json({ ok: true, sessionId });
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const m = mapHouseError(e);
          res.status(m.status).json(m.body);
        }),
      ),
    ),
  );
});

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof Error) {
    return res.status(500).json({ error: err.message, code: "INTERNAL" });
  }
  return res.status(500).json({ error: "internal", code: "INTERNAL" });
});

let colyseusHandle: ColyseusWorldBridgeHandle | undefined;

const server = app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({ kind: "ghost-house.start", publicBase, port, catalog: catalogFilePath }),
  );
  if (!isEnvTruthy(process.env.GHOST_HOUSE_DISABLE_COLYSEUS_BRIDGE)) {
    const roomIdOverride = process.env.GHOST_SPECTATOR_ROOM_ID?.trim() || undefined;
    void (async () => {
      try {
        const deliverWorldEvent = await runtime.runPromise(
          pipe(AgentSupervisor, Effect.map((s) => s.deliverWorldEvent.bind(s))),
        );
        colyseusHandle = await startColyseusWorldBridge({
          worldHttpBase,
          roomIdOverride,
          onEvent: (ev) => {
            void runtime.runPromise(deliverWorldEvent(ev));
          },
        });
        console.info(
          JSON.stringify({
            kind: "colyseus.world-bridge.started",
            worldHttpBase,
            roomIdOverride: roomIdOverride ?? null,
          }),
        );
      } catch (e) {
        console.error(
          JSON.stringify({
            kind: "colyseus.world-bridge.failed",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    })();
  }
});

const shutdown = async () => {
  colyseusHandle?.close();
  await runtime.dispose();
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
