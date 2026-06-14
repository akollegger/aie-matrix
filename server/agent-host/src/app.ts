import { Effect, ManagedRuntime } from "effect";
import express, { type Request, type Response } from "express";
import { buildHouseAgentCard } from "./house-agent-card.js";
import { mapHouseError } from "./http-error-map.js";
import { CatalogService } from "./catalog/CatalogService.js";
import { AgentSupervisor } from "./supervisor/SupervisorService.js";
import { McpProxyService } from "./mcp-proxy/McpProxyService.js";
import { ActiveSessionsPreventDeregister, Unauthorized } from "./errors.js";
import type { AgentSession, WorldCredential } from "./types.js";
import { BarnacleSupervisor } from "./barnacle/index.js";
import {
  BARNACLE_COMPLETE_SCHEMA,
  type BarnacleComplete,
} from "@aie-matrix/shared-types";

export type AppRuntime = ManagedRuntime.ManagedRuntime<
  CatalogService | AgentSupervisor | McpProxyService | BarnacleSupervisor,
  never
>;

export type AppOptions = {
  readonly devToken: string;
  readonly publicBase: string;
  readonly worldApiUrl: string;
};

export function createApp(runtime: AppRuntime, opts: AppOptions): express.Express {
  const { devToken, publicBase, worldApiUrl } = opts;

  const requireBearer = (req: Request): Effect.Effect<void, Unauthorized> =>
    req.headers.authorization === `Bearer ${devToken}`
      ? Effect.void
      : Effect.fail(new Unauthorized({ message: "invalid or missing Authorization" }));

  function getBearerValue(req: Request): string | null {
    const a = req.headers.authorization;
    if (!a?.toLowerCase().startsWith("bearer ")) return null;
    return a.slice(7).trim();
  }

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

  const app = express();

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
    next();
  });
  app.options("*", (_req, res) => res.status(204).end());

  // IC-001: /health — checks world-api reachability; HTTP 200 = healthy, 503 = degraded
  app.get("/health", async (_req, res) => {
    let worldApiOk = false;
    try {
      const r = await fetch(`${worldApiUrl}/health`, { signal: AbortSignal.timeout(3000) });
      worldApiOk = r.status === 200;
    } catch {
      worldApiOk = false;
    }
    const status = worldApiOk ? "ok" : "degraded";
    res.status(worldApiOk ? 200 : 503).json({ status, checks: { "world-api": worldApiOk } });
  });

  /**
   * RFC-0019 — mini-game session-end ingest. Mini-games POST
   * `BarnacleComplete` here when a ghost leaves the in-session
   * experience (chose to leave, busted out, etc.). The supervisor uses
   * the sessionId to find the active session, respawn the ghost, and
   * resume peppers. v1: no bearer auth — the sessionId is the
   * credential (only the mini-game we handed off to knows it).
   *
   * (Note: the A2A push endpoint that previously lived at this
   * position has moved to `/v1/internal/a2a-agent-push` further down,
   * with token-based auth via `X-A2A-Notification-Token`.)
   */
  app.post("/v1/internal/barnacle-complete", express.json({ limit: "4kb" }), (req, res) => {
    const body = req.body as Partial<BarnacleComplete> | null;
    if (
      !body ||
      body.schema !== BARNACLE_COMPLETE_SCHEMA ||
      typeof body.sessionId !== "string" ||
      typeof body.ghostId !== "string"
    ) {
      res.status(400).json({
        error: "missing or invalid BarnacleComplete payload",
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const complete: BarnacleComplete = {
      schema: BARNACLE_COMPLETE_SCHEMA,
      sessionId: body.sessionId,
      ghostId: body.ghostId,
      ...(typeof body.narrative === "string" ? { narrative: body.narrative } : {}),
      lastEventIso:
        typeof body.lastEventIso === "string"
          ? body.lastEventIso
          : new Date().toISOString(),
    };
    void runtime.runPromise(
      Effect.gen(function* () {
        const supervisor = yield* BarnacleSupervisor;
        yield* supervisor.onCompleteReceived(complete);
      }),
    );
    res.status(204).end();
  });

  /**
   * A2A push notification ingest.
   *
   * Per the A2A SDK, the sender ships the per-task push token in the
   * `X-A2A-Notification-Token` header (NOT `Authorization`). We set
   * that token to the session's mcpToken at spawn time via
   * `setTaskPushNotificationConfig` (see A2AHostService). Validate
   * against the supervisor's per-session token map.
   *
   * Falls back to the dev `Authorization: Bearer <devToken>` for
   * out-of-band callers (curl probes, tests).
   */
  app.post("/v1/internal/a2a-agent-push", express.json({ limit: "4mb" }), (req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        const supervisor = yield* AgentSupervisor;
        const a2aToken =
          typeof req.headers["x-a2a-notification-token"] === "string"
            ? (req.headers["x-a2a-notification-token"] as string)
            : null;
        if (a2aToken !== null && a2aToken.length > 0) {
          const session = supervisor.getByMcpToken(a2aToken);
          if (session) {
            res.status(204).end();
            return;
          }
        }
        const bearer = getBearerValue(req);
        if (bearer === devToken && devToken.length > 0) {
          res.status(204).end();
          return;
        }
        res.status(401).json({ error: "invalid or missing push token", code: "UNAUTHORIZED" });
      }),
    );
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

  /**
   * Conversation thread proxy.
   *
   * Peppers ghosts spawned under this agent-host use `houseEndpoints.a2a`
   * (this host) as the base for ALL their world calls — including
   * fetching the body of an inbox notification at
   * `GET /threads/{ghostId}/{messageId}`. That endpoint lives on the
   * combined world-api server, not here, so without a proxy every
   * inbound utterance silently 404s and ghosts never hear each other.
   *
   * Forward verbatim to world-api. No auth — the conversation router
   * doesn't require it for thread reads.
   */
  app.use("/threads", async (req, res) => {
    const target = `${worldApiUrl}/threads${req.url}`;
    try {
      const r = await fetch(target, { method: req.method });
      res.status(r.status);
      r.headers.forEach((v, k) => {
        if (k === "transfer-encoding" || k === "connection") return;
        res.setHeader(k, v);
      });
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } catch (e) {
      res.status(502).json({
        error: "threads proxy failed",
        target,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/.well-known/agent-card.json", (_req, res) => {
    res
      .status(200)
      .type("json")
      .send(JSON.stringify(buildHouseAgentCard(publicBase), null, 2) + "\n");
  });

  app.get("/v1/catalog", (_req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
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

  app.get("/v1/sessions", (_req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        const supervisor = yield* AgentSupervisor;
        res.status(200).json({ sessions: supervisor.listSessions() });
      }),
    );
  });

  app.get("/v1/catalog/:agentId", (req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogService;
        const entry = yield* catalog.get(req.params.agentId!);
        if (entry.kind === "mini-game") {
          // Mini-games speak Barnacle and don't carry an AgentCard. Return the
          // catalog entry directly so clients can still introspect what we know.
          res.status(200).type("json").send(JSON.stringify(entry, null, 2) + "\n");
          return;
        }
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

  /**
   * RFC-0019 — register a mini-game session host. Distinct from
   * `/v1/catalog/register` because mini-games speak Barnacle, not
   * A2A-agent, and don't carry a fetchable AgentCard. The payload
   * declares which `platformClasses` the host claims (e.g.
   * `["PokerTable"]`); the supervisor uses that mapping to route
   * handoffs.
   */
  app.post("/v1/catalog/register-mini-game", (req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        yield* requireBearer(req);
        const catalog = yield* CatalogService;
        const body = req.body as {
          agentId?: string;
          baseUrl?: string;
          platformClasses?: ReadonlyArray<string>;
          hardTimeoutMs?: number;
          about?: string;
        } | null;
        if (
          !body ||
          typeof body.agentId !== "string" ||
          typeof body.baseUrl !== "string" ||
          !Array.isArray(body.platformClasses) ||
          body.platformClasses.length === 0 ||
          !body.platformClasses.every((c) => typeof c === "string")
        ) {
          res.status(400).json({
            error: "agentId, baseUrl, and non-empty platformClasses are required",
            code: "VALIDATION_FAILED",
          });
          return;
        }
        const out = yield* catalog.registerMiniGame({
          agentId: body.agentId,
          baseUrl: body.baseUrl,
          platformClasses: body.platformClasses,
          ...(body.hardTimeoutMs !== undefined ? { hardTimeoutMs: body.hardTimeoutMs } : {}),
          builtIn: false,
          ...(body.about !== undefined ? { about: body.about } : {}),
        });
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
          /** Optional human-readable name. Used as the ghost's
           *  persistent identity from spawn through pause/resume and
           *  Barnacle handoff. */
          displayName?: string;
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
        const session = yield* supervisor.spawn({
          agentId,
          ghostId: b.ghostId,
          credential: worldCredential,
          ...(typeof b.displayName === "string" && b.displayName.trim().length > 0
            ? { displayName: b.displayName.trim() }
            : {}),
        });
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

  // Trusted spawn: collapses registry caretaker→adopt→spawn into one call.
  // For roster agents (matrix.rosterAgent=true), spawns all characters without an orchestrator ghost.
  // For regular agents, provisions a single ghost and spawns the agent session.
  app.post("/v1/sessions/spawn-trusted/:agentId", (req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        yield* requireBearer(req);
        const agentId = req.params.agentId!;
        const b = req.body as {
          ghostId?: string;
          displayName?: string;
          background?: string;
          characterId?: string;
        } | null;

        const supervisor = yield* AgentSupervisor;

        // Check if this is a roster agent — if so, spawn all characters directly.
        const catalog = yield* CatalogService;
        const catalogEntry = yield* catalog.get(agentId).pipe(
          Effect.map((e) => ({ found: true as const, entry: e })),
          Effect.catchAll(() => Effect.succeed({ found: false as const, entry: null as never })),
        );
        if (
          catalogEntry.found &&
          catalogEntry.entry.kind !== "mini-game" &&
          (catalogEntry.entry.agentCard as { matrix?: { rosterAgent?: boolean } }).matrix?.rosterAgent === true
        ) {
          const result = yield* supervisor.spawnRosterForAgent(agentId, catalogEntry.entry.baseUrl);
          res.status(201).json({ agentId, ...result });
          return;
        }

        // Standard single-ghost path: provision ghost + spawn agent session.
        const provisionResult = yield* Effect.promise(() =>
          fetch(`${worldApiUrl}/registry/ghosts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.authorization ?? "",
            },
            body: JSON.stringify({
              agentId,
              ghostId: b?.ghostId,
              displayName: b?.displayName,
              background: b?.background,
            }),
          }).then(async (r) => {
            if (!r.ok) {
              const detail = await r.text().catch(() => "");
              return { ok: false as const, status: r.status, detail };
            }
            const data = (await r.json()) as {
              ghostId: string;
              credential: { token: string; worldApiBaseUrl: string };
            };
            return { ok: true as const, data };
          }).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false as const, status: 502, detail: msg };
          }),
        );
        if (!provisionResult.ok) {
          res.status(provisionResult.status).json({ error: "ghost provision failed", detail: provisionResult.detail, code: "PROVISION_FAILED" });
          return;
        }
        const { ghostId, credential } = provisionResult.data;

        const session = yield* supervisor.spawn({
          agentId,
          ghostId,
          credential: { token: credential.token, worldApiBaseUrl: credential.worldApiBaseUrl },
          ...(typeof b?.displayName === "string" && b.displayName.trim().length > 0
            ? { displayName: b.displayName.trim() }
            : {}),
          ...(typeof b?.background === "string" && b.background.trim().length > 0
            ? { background: b.background.trim() }
            : {}),
          ...(typeof b?.characterId === "string" && b.characterId.trim().length > 0
            ? { characterId: b.characterId.trim() }
            : {}),
        });

        res.status(201).json({
          sessionId: session.sessionId,
          agentId: session.agentId,
          ghostId: session.ghostId,
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

  // IC-006: agent-callable roster spawn endpoint.
  // Authenticated by the calling agent's own MCP session token (not the host dev token).
  app.post("/v1/sessions/spawn-roster/:agentId", (req, res) => {
    void runtime.runPromise(
      Effect.gen(function* () {
        const tok = getBearerValue(req);
        if (!tok) {
          res.status(401).json({ error: "missing Authorization", code: "UNAUTHORIZED" });
          return;
        }
        const supervisor = yield* AgentSupervisor;
        const callerSession = supervisor.getByMcpToken(tok);
        if (!callerSession) {
          res.status(401).json({ error: "invalid agent session token", code: "UNAUTHORIZED" });
          return;
        }

        const agentId = req.params.agentId!;
        if (callerSession.agentId !== agentId) {
          res.status(403).json({ error: "token does not belong to this agent", code: "FORBIDDEN" });
          return;
        }

        const b = req.body as {
          sessionId?: string;
          characters?: Array<{
            characterId?: string;
            ghostId?: string;
            displayName?: string;
            background?: string;
            credential?: { token?: string; worldApiBaseUrl?: string };
          }>;
        } | null;
        if (!b || typeof b.sessionId !== "string" || !Array.isArray(b.characters)) {
          res.status(400).json({ error: "sessionId and characters[] are required", code: "VALIDATION_FAILED" });
          return;
        }
        const spawned: Array<{ characterId: string; ghostId: string; sessionId: string; ok: true }> = [];
        const failed: Array<{ characterId: string; reason: string }> = [];

        type SpawnOutcome = { ok: true; session: AgentSession | null } | { ok: false; reason: string };

        for (const char of b.characters) {
          const characterId = char.characterId;
          if (typeof characterId !== "string" || characterId.trim().length === 0) {
            failed.push({ characterId: String(characterId ?? ""), reason: "characterId is required" });
            continue;
          }

          // Provision a fresh ghost credential from the registry for each character.
          // This gives each character its own ghostId and world-api JWT so their MCP
          // calls are routed correctly (not conflated with the npc-agent's own ghost).
          type ProvResult =
            | { ok: true; ghostId: string; credential: WorldCredential }
            | { ok: false; reason: string };
          const provResult: ProvResult = yield* Effect.tryPromise({
            try: async () => {
              const provRes = await fetch(`${worldApiUrl}/registry/ghosts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agentId }),
              });
              if (!provRes.ok) {
                const body = await provRes.text().catch(() => "");
                return { ok: false as const, reason: `registry provision failed: ${provRes.status} ${body}` };
              }
              const prov = await provRes.json() as { ghostId?: string; credential?: { token?: string; worldApiBaseUrl?: string } };
              if (!prov.ghostId || !prov.credential?.token || !prov.credential?.worldApiBaseUrl) {
                return { ok: false as const, reason: "registry provision returned incomplete response" };
              }
              return { ok: true as const, ghostId: prov.ghostId, credential: { token: prov.credential.token, worldApiBaseUrl: prov.credential.worldApiBaseUrl } };
            },
            catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
          }).pipe(Effect.catchAll((e) => Effect.succeed({ ok: false as const, reason: e.message })));

          if (!provResult.ok) {
            failed.push({ characterId, reason: provResult.reason });
            continue;
          }
          const ghostId = provResult.ghostId;
          const worldCredential: WorldCredential = provResult.credential;

          const spawnResult: SpawnOutcome = yield* supervisor.spawn({
            agentId,
            ghostId,
            credential: worldCredential,
            displayName: char.displayName,
            background: char.background,
            characterId,
          }).pipe(
            Effect.map((session): SpawnOutcome => ({ ok: true, session })),
            Effect.catchAll((e): Effect.Effect<SpawnOutcome> => {
              // "ghostId already has an active session" = idempotent restart
              if (e._tag === "SpawnFailed" && e.message.includes("ghostId already has an active session")) {
                return Effect.succeed({ ok: true, session: null });
              }
              const reason = e._tag === "CapabilityUnmet"
                ? `capability unmet: ${e.missing.join(", ")}`
                : e.message;
              return Effect.succeed({ ok: false, reason });
            }),
          );

          if (spawnResult.ok) {
            spawned.push({ characterId, ghostId, sessionId: b.sessionId, ok: true });
          } else {
            failed.push({ characterId, reason: spawnResult.reason });
          }
        }

        res.status(200).json({ spawned, failed });
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

  return app;
}
