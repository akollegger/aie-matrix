import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Exit } from "effect";
import { makeTestSupervisor, type IAgentSupervisor, readSupervisionConfig } from "../../src/supervisor/SupervisorService.js";
import type { WorldCredential } from "../../src/types.js";
import { latLngToCell } from "h3-js";

const testH3r15: () => string = () => latLngToCell(37.7749, -122.4194, 15);

describe("T027 Effect.forkScoped (spec)", () => {
  it("forkScoped child is bound to the current Scope", async () => {
    const p = Effect.scoped(
      Effect.gen(function* () {
        const child = yield* Effect.forkScoped(Effect.void);
        return child;
      }),
    );
    const e = await Effect.runPromiseExit(p);
    expect(Exit.isSuccess(e)).toBe(true);
  });
});

describe("AgentSupervisor (T030)", () => {
  const cred: WorldCredential = { token: "t", worldApiBaseUrl: "http://127.0.0.1:8787/mcp" };

  let sup: IAgentSupervisor;
  let ping: ReturnType<typeof vi.fn>;
  let createClient: ReturnType<typeof vi.fn>;
  let sendSpawnContext: ReturnType<typeof vi.fn>;
  let cancelTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GHOST_HOUSE_SHUTDOWN_GRACE_MS = "50";
    ping = vi.fn().mockResolvedValue(undefined);
    createClient = vi.fn().mockResolvedValue({});
    sendSpawnContext = vi.fn().mockResolvedValue({ taskId: "task-1", contextId: "ctx-1" });
    cancelTask = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeSup(
    getConfig: () => {
      healthIntervalMs: number;
      healthTimeoutMs: number;
      restartBaseMs: number;
      maxRestartsPerHour: number;
      maxActionsPerMinute: number;
    },
  ) {
    return makeTestSupervisor({
      catalog: {
        get: async () => ({
          agentId: "a1",
          baseUrl: "http://127.0.0.1:4001",
          agentCard: { name: "a", matrix: { requiredTools: [] } } as any,
          registeredAt: new Date().toISOString(),
          builtIn: false,
        }),
        load: async () => ({ agents: {} } as any),
        save: async () => {},
        register: async () => ({} as any),
        list: async () => [],
        deregister: async () => {},
      } as any,
      a2a: {
        createClient,
        sendSpawnContext,
        cancelTask,
        pingAgent: ping,
      } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
      defaultCapabilityManifest: new Set(),
      getConfig,
      resolveWorldH3ForSpawn: async () => testH3r15(),
    });
  }

  it("ping success keeps session running", async () => {
    const cfg = { ...readSupervisionConfig(), healthIntervalMs: 20, healthTimeoutMs: 200 };
    sup = makeSup(() => cfg);
    const s = await sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred });
    expect(s.status).toBe("running");
    await new Promise((r) => setTimeout(r, 600));
    const s2 = sup.getSession(s.sessionId);
    expect(s2?.status).toBe("running");
    expect(ping).toHaveBeenCalled();
    await sup.shutdown(s.sessionId);
  });

  it("ping fail then reconnect transitions unhealthy → running", async () => {
    const cfg = {
      ...readSupervisionConfig(),
      healthIntervalMs: 30,
      healthTimeoutMs: 200,
      restartBaseMs: 20,
      maxRestartsPerHour: 5,
    };
    ping
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    sup = makeSup(() => cfg);
    const s = await sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred });
    expect(sendSpawnContext).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = sup.getSession(s.sessionId);
    expect(s2?.status).toBe("running");
    expect(sendSpawnContext).toHaveBeenCalledTimes(2);
    await sup.shutdown(s.sessionId);
  });

  it("fails session after max restarts / hour (T028)", async () => {
    const cfg = {
      ...readSupervisionConfig(),
      healthIntervalMs: 20,
      healthTimeoutMs: 200,
      restartBaseMs: 5,
      maxRestartsPerHour: 0,
    };
    sendSpawnContext
      .mockReset()
      .mockResolvedValueOnce({ taskId: "task-1", contextId: "ctx-1" })
      .mockRejectedValue(new Error("nope"));
    ping.mockReset().mockRejectedValue(new Error("down"));
    sup = makeSup(() => cfg);
    const s = await sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred });
    await new Promise((r) => setTimeout(r, 400));
    const s2 = sup.getSession(s.sessionId);
    expect(s2?.status).toBe("failed");
  });
});
