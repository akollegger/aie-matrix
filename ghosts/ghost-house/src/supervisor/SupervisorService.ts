import { Context, Effect, Layer } from "effect";
import { ulid } from "ulid";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { Client } from "@a2a-js/sdk/client";
import { CatalogService, type ICatalogService } from "../catalog/CatalogService.js";
import { A2AHostService, type IA2AHostService } from "../a2a-host/A2AHostService.js";
import type { AgentSession, SpawnContext, WorldCredential } from "../types.js";
import { CapabilityUnmet, SessionNotFound, SpawnFailed, SpawnTimeout } from "../errors.js";
import { getResolution, isValidCell } from "h3-js";

class SupervisorState {
  readonly sessions = new Map<string, AgentSession>();
  readonly mcpToSession = new Map<string, string>();
  readonly byAgent = new Map<string, Set<string>>();
}

type Deps = {
  readonly catalog: ICatalogService;
  readonly a2a: IA2AHostService;
  readonly publicHouseBaseUrl: string;
  readonly defaultCapabilityManifest: ReadonlySet<string>;
};

function ensureH3Res15(h3: string): void {
  if (!isValidCell(h3) || getResolution(h3) !== 15) {
    throw new SpawnFailed({ message: `whereami did not return a valid H3 res-15 index, got ${h3}` });
  }
}

async function fetchWorldH3(worldCredential: WorldCredential): Promise<string> {
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
    ensureH3Res15(h3);
    return h3;
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}

export interface IAgentSupervisor {
  readonly spawn: (input: { agentId: string; ghostId: string; credential: WorldCredential }) => Promise<AgentSession>;
  readonly shutdown: (sessionId: string) => Promise<void>;
  readonly getSession: (sessionId: string) => AgentSession | undefined;
  readonly getByMcpToken: (mcpToken: string) => AgentSession | undefined;
  readonly listSessionIdsByAgent: (agentId: string) => string[];
}

export class AgentSupervisor extends Context.Tag("ghost-house/AgentSupervisor")<
  AgentSupervisor,
  IAgentSupervisor
>() {}

function makeAgentSupervisor(deps: Deps, state: SupervisorState): IAgentSupervisor {
  const { catalog, a2a, publicHouseBaseUrl, defaultCapabilityManifest } = deps;
  return {
    spawn: async (input) => {
      const entry = await catalog.get(input.agentId);
      const ac = entry.agentCard as {
        matrix?: { requiredTools?: string[]; capabilitiesRequired?: string[] };
      };
      const capReq = ac.matrix?.capabilitiesRequired ?? [];
      const missing = capReq.filter((c) => !defaultCapabilityManifest.has(c));
      if (missing.length > 0) {
        throw new CapabilityUnmet({ missing });
      }
      const worldEntryPoint = await fetchWorldH3(input.credential);
      const mcpToken = ulid();
      const sessionId = ulid();
      const requiredTools = ac.matrix?.requiredTools ?? [];
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
      };
      const houseBase = publicHouseBaseUrl.replace(/\/$/, "");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const spawnContext: SpawnContext = {
        schema: "aie-matrix.ghost-house.spawn-context.v1",
        ghostId: input.ghostId,
        ghostCard: {
          class: "wanderer",
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
      let client: Client;
      try {
        client = await a2a.createClient(entry.baseUrl);
        session.spawnClient = client;
        const r = await a2a.sendSpawnContext(client, spawnContext, { timeoutMs: 30_000 });
        session.currentTaskId = r.taskId;
        if (r.contextId) {
          session.currentA2AContextId = r.contextId;
        }
        session.status = "running";
      } catch (e) {
        session.status = "failed";
        if (e instanceof SpawnTimeout) {
          throw e;
        }
        throw new SpawnFailed({
          message: e instanceof Error ? e.message : String(e),
        });
      }
      if (session.status !== "running") {
        throw new SpawnFailed({ message: "session did not reach running" });
      }
      state.sessions.set(sessionId, session);
      state.mcpToSession.set(mcpToken, sessionId);
      if (!state.byAgent.has(input.agentId)) {
        state.byAgent.set(input.agentId, new Set());
      }
      state.byAgent.get(input.agentId)!.add(sessionId);
      return session;
    },
    shutdown: async (sessionId) => {
      const s = state.sessions.get(sessionId);
      if (!s) {
        throw new SessionNotFound({ sessionId });
      }
      s.status = "shutdown";
      if (s.spawnClient && s.currentTaskId) {
        await a2a.cancelTask(s.spawnClient, s.currentTaskId);
        await new Promise((r) => setTimeout(r, 10_000));
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
      s.spawnClient = undefined;
      state.sessions.delete(sessionId);
      state.mcpToSession.delete(s.mcpToken);
      const aset = state.byAgent.get(s.agentId);
      if (aset) {
        aset.delete(sessionId);
        if (aset.size === 0) {
          state.byAgent.delete(s.agentId);
        }
      }
    },
    getSession: (sessionId) => state.sessions.get(sessionId),
    getByMcpToken: (mcpToken) => {
      const sid = state.mcpToSession.get(mcpToken);
      if (!sid) {
        return undefined;
      }
      return state.sessions.get(sid);
    },
    listSessionIdsByAgent: (agentId) => [...(state.byAgent.get(agentId) ?? [])],
  };
}

/** Composes `IAgentSupervisor` from `CatalogService` + `A2AHostService` in the same runtime. */
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
        },
        st,
      );
    }),
  );
};

export const makeTestSupervisor = (deps: Deps, st = new SupervisorState()): IAgentSupervisor =>
  makeAgentSupervisor(deps, st);
