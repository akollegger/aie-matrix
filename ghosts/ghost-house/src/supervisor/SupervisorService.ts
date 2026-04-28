import { Context, Duration, Effect, Fiber, Layer, pipe } from "effect";
import { ulid } from "ulid";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { Client } from "@a2a-js/sdk/client";
import { CatalogService, type ICatalogService } from "../catalog/CatalogService.js";
import { A2AHostService, type IA2AHostService } from "../a2a-host/A2AHostService.js";
import type { AgentSession, AgentSessionStatus, SpawnContext, WorldCredential, WorldEvent } from "../types.js";
import { CapabilityUnmet, SessionNotFound, SpawnFailed, SpawnTimeout } from "../errors.js";
import { getResolution, isValidCell } from "h3-js";

class SupervisorState {
  readonly sessions = new Map<string, AgentSession>();
  readonly mcpToSession = new Map<string, string>();
  /** Adopted ghost id → session id (for world event routing). */
  readonly byGhostId = new Map<string, string>();
  readonly byAgent = new Map<string, Set<string>>();
  /** T029: per-session rolling 60s stamps for rate limiting. */
  readonly actionStamps = new Map<string, number[]>();
  /** Maps sessionId → root supervision fiber (interrupt in shutdown, T027). */
  readonly healthFibers = new Map<string, Fiber.RuntimeFiber<void, unknown>>();
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export type SupervisionConfigValue = {
  readonly healthIntervalMs: number;
  readonly healthTimeoutMs: number;
  readonly restartBaseMs: number;
  readonly maxRestartsPerHour: number;
  readonly maxActionsPerMinute: number;
};

/** Reads supervision config from env on every call (no module-level cache). */
export function readSupervisionConfig(): SupervisionConfigValue {
  const n = (k: string, d: number): number => {
    const v = process.env[k];
    if (v == null || v === "") return d;
    const x = parseInt(v, 10);
    return Number.isFinite(x) && x > 0 ? x : d;
  };
  return {
    healthIntervalMs: n("GHOST_HOUSE_HEALTH_INTERVAL_MS", 30_000),
    healthTimeoutMs: n("GHOST_HOUSE_HEALTH_TIMEOUT_MS", 30_000),
    restartBaseMs: n("GHOST_HOUSE_RESTART_BASE_MS", 5_000),
    maxRestartsPerHour: n("GHOST_HOUSE_MAX_RESTARTS_PER_HOUR", 5),
    maxActionsPerMinute: n("GHOST_HOUSE_MAX_ACTIONS_PER_MIN", 60),
  };
}

type Deps = {
  readonly catalog: ICatalogService;
  readonly a2a: IA2AHostService;
  readonly publicHouseBaseUrl: string;
  readonly defaultCapabilityManifest: ReadonlySet<string>;
  readonly getConfig: () => Readonly<SupervisionConfigValue>;
  /** Tests: override H3 for spawn (avoids real MCP in unit tests). */
  readonly resolveWorldH3ForSpawn?: (c: WorldCredential) => Promise<string>;
};

const slog = (k: string, f: Record<string, unknown>) => {
  /* eslint-disable no-console */
  console.error(JSON.stringify({ kind: k, ...f }));
  /* eslint-enable no-console */
};

function prunedStamps(t: number[], now: number, w: number): number[] {
  return t.filter((x) => now - x < w);
}

function canAction(
  st: SupervisorState,
  sid: string,
  cap: number,
  now: number,
): { ok: boolean; next: number[] } {
  const cur = prunedStamps(st.actionStamps.get(sid) ?? [], now, MINUTE_MS);
  st.actionStamps.set(sid, cur);
  if (cur.length >= cap) {
    return { ok: false, next: cur };
  }
  return { ok: true, next: [...cur, now] };
}

/**
 * T027: `Effect.forkDaemon(whileLoop…)`; interrupted when shutdown calls `Fiber.interrupt`.
 */
function sessionHealthLoop(
  st: SupervisorState,
  s: AgentSession,
  a2a: IA2AHostService,
  catalog: ICatalogService,
  getCfg: () => Readonly<SupervisionConfigValue>,
  publicHouseBaseUrl: string,
) {
  const doTick: Effect.Effect<void> = Effect.gen(function* () {
    if (s.status === "failed") {
      return;
    }
    const now = Date.now();
    const cfg = getCfg();
    const a1 = canAction(st, s.sessionId, cfg.maxActionsPerMinute, now);
    if (!a1.ok) {
      slog("supervisor.rate-limit", { sessionId: s.sessionId, message: "dropped tick" });
      return;
    }
    st.actionStamps.set(s.sessionId, a1.next);
    if (!s.spawnClient) {
      s.status = "unhealthy";
      return;
    }
    const pingE = yield* pipe(
      a2a.pingAgent(s.spawnClient, { timeoutMs: cfg.healthTimeoutMs }),
      Effect.either,
    );
    if (pingE._tag === "Right") {
      s.status = "running";
      s.lastHealthCheckAt = new Date();
      s.currentBackoffMs = cfg.restartBaseMs;
      s.restartWindow = prunedStamps(s.restartWindow, Date.now(), HOUR_MS);
      return;
    }
    slog("supervisor.health-fail", { sessionId: s.sessionId, message: pingE.left.message });
    s.status = "unhealthy";
    yield* Effect.sleep(Duration.millis(s.currentBackoffMs));
    s.status = "restarting";
    if (!s.lastSpawnContext) {
      s.status = "failed";
      slog("supervisor.permanent-fail", { sessionId: s.sessionId, message: "no spawn context" });
      return;
    }
    const windowSoFar = prunedStamps(s.restartWindow, Date.now(), HOUR_MS);
    if (windowSoFar.length >= cfg.maxRestartsPerHour) {
      s.status = "failed";
      slog("supervisor.permanent-fail", { sessionId: s.sessionId, message: "max restarts / hour" });
      return;
    }
    s.restartWindow = [...windowSoFar, Date.now()];

    const t2 = Date.now();
    const a2 = canAction(st, s.sessionId, getCfg().maxActionsPerMinute, t2);
    if (!a2.ok) {
      s.status = "unhealthy";
      s.currentBackoffMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(s.currentBackoffMs, cfg.restartBaseMs) * 2,
      );
      return;
    }
    st.actionStamps.set(s.sessionId, a2.next);

    const houseBase = publicHouseBaseUrl.replace(/\/$/, "");
    const housePushIngest = `${houseBase}/v1/internal/a2a-agent-push`;
    const lastCtx = s.lastSpawnContext;

    const reconE = yield* pipe(
      Effect.gen(function* () {
        const entry = yield* catalog.get(s.agentId);
        const client: Client = yield* a2a.createClient(entry.baseUrl);
        s.spawnClient = client;
        const r = yield* (s.usesA2APush
          ? a2a.startPushSpawnContext(client, lastCtx, {
              houseAgentPushIngestUrl: housePushIngest,
              pushToken: s.mcpToken,
              timeoutMs: 30_000,
            })
          : a2a.sendSpawnContext(client, lastCtx, { timeoutMs: 30_000 }));
        s.currentTaskId = r.taskId;
        s.currentA2AContextId = r.contextId ?? s.currentA2AContextId;
        s.restartCount += 1;
        s.status = "running";
        s.currentBackoffMs = getCfg().restartBaseMs;
      }),
      Effect.mapError(
        (e): Error => (e instanceof Error ? e : new Error(String(e))),
      ),
      Effect.either,
    );
    if (reconE._tag === "Left") {
      s.status = "unhealthy";
      s.currentBackoffMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(s.currentBackoffMs, cfg.restartBaseMs) * 2,
      );
      slog("supervisor.reconnect-fail", { sessionId: s.sessionId, message: reconE.left.message });
    }
  });

  return Effect.whileLoop({
    while: () => s.status !== "failed",
    body: () =>
      pipe(
        Effect.sleep(Duration.millis(getCfg().healthIntervalMs)),
        Effect.flatMap(() => doTick),
      ),
    step: () => void 0,
  }) as Effect.Effect<void>;
}

function startHealth(
  st: SupervisorState,
  s: AgentSession,
  a2a: IA2AHostService,
  catalog: ICatalogService,
  getCfg: () => Readonly<SupervisionConfigValue>,
  publicHouseBaseUrl: string,
): Effect.Effect<void> {
  // T027: daemon fiber per session, interrupted on shutdown.
  const loop = sessionHealthLoop(st, s, a2a, catalog, getCfg, publicHouseBaseUrl);
  const program = pipe(
    loop,
    Effect.ensuring(Effect.sync(() => void st.healthFibers.delete(s.sessionId))),
  );
  return Effect.forkDaemon(program).pipe(
    Effect.tap((f) => Effect.sync(() => st.healthFibers.set(s.sessionId, f))),
    Effect.asVoid,
  );
}

function ensureH3Res15(h3: string): Effect.Effect<void, SpawnFailed> {
  if (!isValidCell(h3) || getResolution(h3) !== 15) {
    return Effect.fail(
      new SpawnFailed({
        message: `whereami did not return a valid H3 res-15 index, got ${h3}`,
      }),
    );
  }
  return Effect.void;
}

function fetchWorldH3(worldCredential: WorldCredential): Effect.Effect<string, SpawnFailed> {
  return Effect.tryPromise({
    try: async () => {
      const mcp = new GhostMcpClient({
        worldApiBaseUrl: worldCredential.worldApiBaseUrl,
        token: worldCredential.token,
      });
      await mcp.connect();
      try {
        const loc = (await mcp.callTool("whereami", {})) as { h3Index?: string; tileId?: string };
        const h3 =
          typeof loc.h3Index === "string" && loc.h3Index.length > 0 ? loc.h3Index : loc.tileId;
        if (typeof h3 !== "string" || h3.length === 0) {
          throw new SpawnFailed({ message: "whereami returned no h3 / tile" });
        }
        return h3;
      } finally {
        await mcp.disconnect().catch(() => {});
      }
    },
    catch: (e) =>
      e instanceof SpawnFailed
        ? e
        : new SpawnFailed({ message: e instanceof Error ? e.message : String(e) }),
  }).pipe(
    Effect.flatMap((h3) =>
      pipe(
        ensureH3Res15(h3),
        Effect.map(() => h3),
      ),
    ),
  );
}

export interface IAgentSupervisor {
  readonly spawn: (input: {
    agentId: string;
    ghostId: string;
    credential: WorldCredential;
  }) => Effect.Effect<AgentSession, SpawnFailed | SpawnTimeout | CapabilityUnmet>;
  readonly shutdown: (sessionId: string) => Effect.Effect<void, SessionNotFound>;
  readonly getSession: (sessionId: string) => AgentSession | undefined;
  readonly getByMcpToken: (mcpToken: string) => AgentSession | undefined;
  readonly listSessionIdsByAgent: (agentId: string) => string[];
  readonly listSessions: () => ReadonlyArray<{ ghostId: string; agentId: string; status: AgentSessionStatus }>;
  /** Routes IC-004 world events to the A2A push session for the target ghost, if any. */
  readonly deliverWorldEvent: (event: WorldEvent) => Effect.Effect<void>;
}

export class AgentSupervisor extends Context.Tag("ghost-house/AgentSupervisor")<
  AgentSupervisor,
  IAgentSupervisor
>() {}

function makeAgentSupervisor(deps: Deps, state: SupervisorState): IAgentSupervisor {
  const {
    catalog,
    a2a,
    publicHouseBaseUrl,
    defaultCapabilityManifest,
    getConfig,
    resolveWorldH3ForSpawn,
  } = deps;

  const resolveH3 = resolveWorldH3ForSpawn
    ? (cred: WorldCredential): Effect.Effect<string, SpawnFailed> =>
        Effect.tryPromise({
          try: () => Promise.resolve(resolveWorldH3ForSpawn(cred)),
          catch: (e) =>
            e instanceof SpawnFailed
              ? e
              : new SpawnFailed({ message: e instanceof Error ? e.message : String(e) }),
        })
    : fetchWorldH3;

  return {
    spawn: (input) =>
      Effect.gen(function* () {
        const existingSid = state.byGhostId.get(input.ghostId);
        if (existingSid && state.sessions.has(existingSid)) {
          return yield* Effect.fail(
            new SpawnFailed({ message: "ghostId already has an active session" }),
          );
        }
        const entry = yield* pipe(
          catalog.get(input.agentId),
          Effect.mapError(
            () => new SpawnFailed({ message: `agent ${input.agentId} not found in catalog` }),
          ),
        );
        const ac = entry.agentCard as {
          capabilities?: { pushNotifications?: boolean };
          matrix?: {
            tier?: string;
            requiredTools?: string[];
            capabilitiesRequired?: string[];
          };
        };
        const capReq = ac.matrix?.capabilitiesRequired ?? [];
        const missing = capReq.filter((c) => !defaultCapabilityManifest.has(c));
        if (missing.length > 0) {
          return yield* Effect.fail(new CapabilityUnmet({ missing }));
        }
        const usesA2APush = ac.capabilities?.pushNotifications === true;
        const tier = ac.matrix?.tier ?? "wanderer";
        const worldEntryPoint = yield* resolveH3(input.credential);
        const mcpToken = ulid();
        const sessionId = ulid();
        const requiredTools = ac.matrix?.requiredTools ?? [];
        const cfg = getConfig();
        const session: AgentSession = {
          sessionId,
          agentId: input.agentId,
          ghostId: input.ghostId,
          status: "spawning",
          restartCount: 0,
          lastHealthCheckAt: null,
          spawnedAt: new Date(),
          mcpToken,
          worldCredential: input.credential,
          requiredTools,
          currentTaskId: null,
          currentA2AContextId: null,
          usesA2APush,
          restartWindow: [],
          currentBackoffMs: cfg.restartBaseMs,
        };
        const houseBase = publicHouseBaseUrl.replace(/\/$/, "");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
        const spawnContext: SpawnContext = {
          schema: "aie-matrix.ghost-house.spawn-context.v1",
          ghostId: input.ghostId,
          ghostCard: {
            class: tier,
            displayName: `ghost-${input.ghostId.slice(0, 8)}`,
            partnerEmail: null,
          },
          worldEntryPoint,
          houseEndpoints: {
            mcp: `${houseBase}/v1/mcp`,
            a2a: `${houseBase}/`,
          },
          token: mcpToken,
          expiresAt,
        };
        const houseAgentPushIngest = `${houseBase}/v1/internal/a2a-agent-push`;

        // Register token before sending spawn context — agent may call MCP immediately on receipt
        // (e.g. social-tier movement loop starts before startPushSpawnContext returns).
        state.sessions.set(sessionId, session);
        state.mcpToSession.set(mcpToken, sessionId);
        state.byGhostId.set(input.ghostId, sessionId);
        if (!state.byAgent.has(input.agentId)) {
          state.byAgent.set(input.agentId, new Set());
        }
        state.byAgent.get(input.agentId)!.add(sessionId);

        const spawnResult = yield* pipe(
          Effect.gen(function* () {
            const client = yield* a2a.createClient(entry.baseUrl);
            session.spawnClient = client;
            const r = yield* (usesA2APush
              ? a2a.startPushSpawnContext(client, spawnContext, {
                  houseAgentPushIngestUrl: houseAgentPushIngest,
                  pushToken: mcpToken,
                  timeoutMs: 30_000,
                })
              : a2a.sendSpawnContext(client, spawnContext, { timeoutMs: 30_000 }));
            return r;
          }),
          Effect.tapError(() =>
            Effect.sync(() => {
              session.status = "failed";
              state.sessions.delete(sessionId);
              state.mcpToSession.delete(mcpToken);
              state.byGhostId.delete(input.ghostId);
              state.byAgent.get(input.agentId)?.delete(sessionId);
            }),
          ),
        );

        session.currentTaskId = spawnResult.taskId;
        if (spawnResult.contextId) {
          session.currentA2AContextId = spawnResult.contextId;
        }
        session.status = "running";
        session.lastSpawnContext = spawnContext;

        yield* startHealth(state, session, a2a, catalog, getConfig, publicHouseBaseUrl);
        return session;
      }),

    shutdown: (sessionId) =>
      Effect.gen(function* () {
        const s = state.sessions.get(sessionId);
        if (!s) {
          return yield* Effect.fail(new SessionNotFound({ sessionId }));
        }
        const hf = state.healthFibers.get(sessionId);
        if (hf) {
          yield* Fiber.interrupt(hf);
          state.healthFibers.delete(sessionId);
        }
        s.status = "shutdown";
        const shutdownGraceMs = (() => {
          const r = process.env.GHOST_HOUSE_SHUTDOWN_GRACE_MS;
          if (r == null || r === "") return 10_000;
          const n = parseInt(r, 10);
          return Number.isFinite(n) && n >= 0 ? n : 10_000;
        })();
        if (s.spawnClient && s.currentTaskId) {
          yield* a2a.cancelTask(s.spawnClient, s.currentTaskId);
          yield* Effect.sleep(Duration.millis(shutdownGraceMs));
        } else {
          yield* Effect.sleep(Duration.millis(100));
        }
        s.spawnClient = undefined;
        state.sessions.delete(sessionId);
        state.mcpToSession.delete(s.mcpToken);
        state.byGhostId.delete(s.ghostId);
        state.actionStamps.delete(sessionId);
        const aset = state.byAgent.get(s.agentId);
        if (aset) {
          aset.delete(sessionId);
          if (aset.size === 0) {
            state.byAgent.delete(s.agentId);
          }
        }
      }),

    getSession: (sessionId) => state.sessions.get(sessionId),

    getByMcpToken: (mcpToken) => {
      const sid = state.mcpToSession.get(mcpToken);
      if (!sid) return undefined;
      return state.sessions.get(sid);
    },

    listSessionIdsByAgent: (agentId) => [...(state.byAgent.get(agentId) ?? [])],

    listSessions: () =>
      Array.from(state.sessions.values()).map((s) => ({
        ghostId: s.ghostId,
        agentId: s.agentId,
        status: s.status,
      })),

    deliverWorldEvent: (event) =>
      Effect.gen(function* () {
        const sid = state.byGhostId.get(event.ghostId);
        if (sid == null) return;
        const s = state.sessions.get(sid);
        if (s == null || s.status !== "running" || s.spawnClient == null) return;
        if (!s.usesA2APush) return;
        if (s.currentTaskId == null || s.currentA2AContextId == null) return;
        yield* pipe(
          a2a.sendWorldEvent(s.spawnClient, {
            taskId: s.currentTaskId,
            contextId: s.currentA2AContextId,
            event,
          }),
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              slog("supervisor.world-event-fail", {
                sessionId: s.sessionId,
                ghostId: s.ghostId,
                message: String(cause),
              }),
            ),
          ),
        );
      }),
  };
}

export const AgentSupervisorLayer = (opts: {
  publicHouseBaseUrl: string;
  defaultCapabilityManifest: ReadonlySet<string>;
}): Layer.Layer<AgentSupervisor, never, CatalogService | A2AHostService> => {
  const st = new SupervisorState();
  return Layer.effect(
    AgentSupervisor,
    Effect.gen(function* () {
      const catalog = yield* CatalogService;
      const a2a = yield* A2AHostService;
      return makeAgentSupervisor(
        {
          catalog,
          a2a,
          publicHouseBaseUrl: opts.publicHouseBaseUrl,
          defaultCapabilityManifest: opts.defaultCapabilityManifest,
          getConfig: readSupervisionConfig,
        },
        st,
      );
    }),
  );
};

export const makeTestSupervisor = (
  deps: Omit<Deps, "getConfig"> & { getConfig?: Deps["getConfig"] },
  st = new SupervisorState(),
): IAgentSupervisor =>
  makeAgentSupervisor({ ...deps, getConfig: deps.getConfig ?? readSupervisionConfig }, st);
