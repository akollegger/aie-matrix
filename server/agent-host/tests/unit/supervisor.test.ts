import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Exit } from "effect";
import {
  makeTestSupervisor,
  type IAgentSupervisor,
  readSupervisionConfig,
} from "../../src/supervisor/SupervisorService.js";
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
    process.env.AGENT_HOST_SHUTDOWN_GRACE_MS = "50";
    ping = vi.fn().mockReturnValue(Effect.void);
    createClient = vi.fn().mockReturnValue(Effect.succeed({}));
    sendSpawnContext = vi
      .fn()
      .mockReturnValue(Effect.succeed({ taskId: "task-1", contextId: "ctx-1" }));
    cancelTask = vi.fn().mockReturnValue(Effect.void);
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
        get: (_id: string) =>
          Effect.succeed({
            agentId: "a1",
            baseUrl: "http://127.0.0.1:4001",
            agentCard: { name: "a", matrix: { requiredTools: [] } } as any,
            registeredAt: new Date().toISOString(),
            builtIn: false,
          }),
        load: () => Effect.succeed({ agents: {} } as any),
        save: () => Effect.void,
        register: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as any,
      a2a: {
        createClient,
        sendSpawnContext,
        sendSpawnContextNonBlocking: sendSpawnContext,
        cancelTask,
        pingAgent: ping,
      } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
        worldHttpBase: "http://127.0.0.1:8787",
      defaultCapabilityManifest: new Set(),
      pushIngestToken: "test-token",
      getConfig,
      resolveWorldH3ForSpawn: async () => testH3r15(),
    });
  }

  it("ping success keeps session running", async () => {
    const cfg = { ...readSupervisionConfig(), healthIntervalMs: 20, healthTimeoutMs: 200 };
    sup = makeSup(() => cfg);
    const s = await Effect.runPromise(sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred }));
    expect(s.status).toBe("running");
    await new Promise((r) => setTimeout(r, 600));
    const s2 = sup.getSession(s.sessionId);
    expect(s2?.status).toBe("running");
    expect(ping).toHaveBeenCalled();
    await Effect.runPromise(sup.shutdown(s.sessionId));
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
      .mockReturnValueOnce(Effect.fail(new Error("down")))
      .mockReturnValue(Effect.void);
    sup = makeSup(() => cfg);
    const s = await Effect.runPromise(sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred }));
    expect(sendSpawnContext).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = sup.getSession(s.sessionId);
    expect(s2?.status).toBe("running");
    expect(sendSpawnContext).toHaveBeenCalledTimes(2);
    await Effect.runPromise(sup.shutdown(s.sessionId));
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
      .mockReturnValueOnce(Effect.succeed({ taskId: "task-1", contextId: "ctx-1" }))
      .mockReturnValue(Effect.fail(new Error("nope")));
    ping.mockReset().mockReturnValue(Effect.fail(new Error("down")));
    sup = makeSup(() => cfg);
    const s = await Effect.runPromise(sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred }));
    await new Promise((r) => setTimeout(r, 400));
    // Session is removed from state maps on permanent-fail (not just marked "failed")
    expect(sup.getSession(s.sessionId)).toBeUndefined();
  });

  it("removes permanently-failed session from state maps (regression: stale sessions accumulate)", async () => {
    // Regression: permanent-fail sessions were never removed from state.sessions,
    // state.byGhostId, or state.byAgent, causing them to accumulate across restarts.
    const cfg = {
      ...readSupervisionConfig(),
      healthIntervalMs: 20,
      healthTimeoutMs: 200,
      restartBaseMs: 5,
      maxRestartsPerHour: 0,
    };
    sendSpawnContext
      .mockReset()
      .mockReturnValueOnce(Effect.succeed({ taskId: "task-1", contextId: "ctx-1" }))
      .mockReturnValue(Effect.fail(new Error("nope")));
    ping.mockReset().mockReturnValue(Effect.fail(new Error("down")));
    sup = makeSup(() => cfg);
    const s = await Effect.runPromise(sup.spawn({ agentId: "a1", ghostId: "g1", credential: cred }));
    // Wait for permanent-fail + cleanup
    await new Promise((r) => setTimeout(r, 600));
    // Session must be gone from the map, not just marked "failed"
    expect(sup.getSession(s.sessionId)).toBeUndefined();
    // Ghost and agent lookups must also be gone
    expect(sup.getSessionByGhostId("g1")).toBeUndefined();
    expect(sup.listSessionIdsByAgent("a1")).toHaveLength(0);
  });
});

describe("AgentSupervisor.spawnRosterForAgent (idempotency)", () => {
  const RES15 = testH3r15();
  let provisionCount: number;

  function makeRosterSup() {
    provisionCount = 0;
    const roster = [
      { characterId: "broker", displayName: "The Broker" },
      { characterId: "hermit",  displayName: "The Hermit"  },
    ];
    let ghostSeq = 0;

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/roster") && (!init || init.method === undefined || init.method === "GET")) {
        return { ok: true, json: async () => roster } as Response;
      }
      if (u.endsWith("/registry/ghosts") && init?.method === "POST") {
        provisionCount++;
        const ghostId = `ghost-${++ghostSeq}`;
        return {
          ok: true,
          json: async () => ({
            ghostId,
            credential: { token: `tok-${ghostId}`, worldApiBaseUrl: "http://127.0.0.1:8787/mcp" },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));

    return makeTestSupervisor({
      catalog: {
        get: (_id: string) =>
          Effect.succeed({
            agentId: "npc-agent-local",
            baseUrl: "http://127.0.0.1:4004",
            agentCard: { name: "npc-agent", matrix: { rosterAgent: true } } as any,
            registeredAt: new Date().toISOString(),
            builtIn: false,
          }),
        load: () => Effect.succeed({ agents: {} } as any),
        save: () => Effect.void,
        register: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as any,
      a2a: {
        createClient: vi.fn().mockReturnValue(Effect.succeed({})),
        sendSpawnContext: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        sendSpawnContextNonBlocking: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        cancelTask: vi.fn().mockReturnValue(Effect.void),
        pingAgent: vi.fn().mockReturnValue(Effect.void),
        sendWorldEvent: vi.fn().mockReturnValue(Effect.void),
      } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
      worldHttpBase: "http://127.0.0.1:8787",
      defaultCapabilityManifest: new Set(),
      pushIngestToken: "test-token",
      resolveWorldH3ForSpawn: async () => RES15,
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("first call spawns all roster characters", async () => {
    const sup = makeRosterSup();
    const { spawned, failed } = await Effect.runPromise(
      sup.spawnRosterForAgent("npc-agent-local", "http://127.0.0.1:4004"),
    );
    expect(spawned).toHaveLength(2);
    expect(failed).toHaveLength(0);
    expect(provisionCount).toBe(2);
  });

  it("second call skips already-running characters (no duplicate ghosts)", async () => {
    const sup = makeRosterSup();

    // First call — spawns both characters.
    await Effect.runPromise(sup.spawnRosterForAgent("npc-agent-local", "http://127.0.0.1:4004"));
    const afterFirst = provisionCount;

    // Second call — simulates the registration hook firing after reconciliation already ran.
    const { spawned, failed } = await Effect.runPromise(
      sup.spawnRosterForAgent("npc-agent-local", "http://127.0.0.1:4004"),
    );

    expect(failed).toHaveLength(0);
    expect(spawned).toHaveLength(2); // counted as ok (already running)
    // No new ghosts provisioned — characterId guard must have fired for both.
    expect(provisionCount).toBe(afterFirst);
  });
});

describe("AgentSupervisor.despawnByAgent (pod-restart scenario)", () => {
  /**
   * Regression test for the "only 9 ghosts after pod reschedule" incident (2026-06-26).
   *
   * Root cause: when a pod (e.g. random-agent) restarts, agent-host still holds the old
   * sessions as "running" because health checks haven't fired yet (default interval: 30s).
   * When the pod re-registers and spawnRosterForAgent is called, the duplicate check
   * finds the stale "running" sessions and skips all characters — leaving 0 fresh ghosts
   * spawned instead of the expected 10.
   *
   * Fix: the registration hook calls despawnByAgent before spawnRosterForAgent so stale
   * sessions are cleared synchronously before the duplicate check runs.
   */
  const RES15 = testH3r15();
  let provisionCount: number;

  function makePodRestartSup() {
    provisionCount = 0;
    const roster = [
      { characterId: "wanderer-1", displayName: "Wanderer One" },
      { characterId: "wanderer-2", displayName: "Wanderer Two" },
    ];
    let ghostSeq = 0;

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/roster") && (!init || !init.method || init.method === "GET")) {
        return { ok: true, json: async () => roster } as Response;
      }
      if (u.endsWith("/registry/ghosts") && init?.method === "POST") {
        provisionCount++;
        const ghostId = `ghost-${++ghostSeq}`;
        return {
          ok: true,
          json: async () => ({
            ghostId,
            credential: { token: `tok-${ghostId}`, worldApiBaseUrl: "http://127.0.0.1:8787/mcp" },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));

    return makeTestSupervisor({
      catalog: {
        get: (_id: string) =>
          Effect.succeed({
            agentId: "random-agent",
            baseUrl: "http://random-agent:4001",
            agentCard: { name: "random-agent", matrix: { rosterAgent: true } } as any,
            registeredAt: new Date().toISOString(),
            builtIn: false,
          }),
        load: () => Effect.succeed({ agents: {} } as any),
        save: () => Effect.void,
        register: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as any,
      a2a: {
        createClient: vi.fn().mockReturnValue(Effect.succeed({})),
        sendSpawnContext: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        sendSpawnContextNonBlocking: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        cancelTask: vi.fn().mockReturnValue(Effect.void),
        pingAgent: vi.fn().mockReturnValue(Effect.void),
        sendWorldEvent: vi.fn().mockReturnValue(Effect.void),
      } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
      worldHttpBase: "http://127.0.0.1:8787",
      defaultCapabilityManifest: new Set(),
      pushIngestToken: "test-token",
      resolveWorldH3ForSpawn: async () => RES15,
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("[BUG] re-registration without cleanup skips all characters as duplicates", async () => {
    const sup = makePodRestartSup();

    // First spawn — simulates original pod startup; both wanderers get ghosts.
    await Effect.runPromise(sup.spawnRosterForAgent("random-agent", "http://random-agent:4001"));
    expect(provisionCount).toBe(2);

    // Pod restarts: agent re-registers, triggers spawnRosterForAgent again.
    // The old sessions are still "running" — health check hasn't fired.
    const { spawned } = await Effect.runPromise(
      sup.spawnRosterForAgent("random-agent", "http://random-agent:4001"),
    );

    // BUG: both characters are skipped as duplicates, no fresh ghosts provisioned.
    expect(provisionCount).toBe(2); // no new provisions
    expect(spawned.every(s => s.ghostId === "(already-running)")).toBe(true);
  });

  it("[FIX] despawnByAgent + re-register provisions fresh ghosts for all characters", async () => {
    const sup = makePodRestartSup();

    // Original pod startup.
    await Effect.runPromise(sup.spawnRosterForAgent("random-agent", "http://random-agent:4001"));
    expect(provisionCount).toBe(2);

    // Pod restarts: registration hook calls despawnByAgent BEFORE spawnRosterForAgent.
    await Effect.runPromise(sup.despawnByAgent("random-agent"));

    // Small delay so background cleanup removes sessions from state maps.
    await new Promise((r) => setTimeout(r, 50));

    const { spawned, failed } = await Effect.runPromise(
      sup.spawnRosterForAgent("random-agent", "http://random-agent:4001"),
    );

    // FIX: both wanderers get fresh ghosts.
    expect(failed).toHaveLength(0);
    expect(spawned).toHaveLength(2);
    expect(provisionCount).toBe(4); // 2 original + 2 fresh
    expect(spawned.every(s => s.ghostId !== "(already-running)")).toBe(true);
  });
});

describe("AgentSupervisor.deliverWorldEvent (chat pipeline)", () => {
  /**
   * Regression test for the "no ghost responds" bug.
   *
   * The full chat pipeline is:
   *   POST /threads/:ghostId/human-say
   *   → fanout(ghostId, payload)
   *   → room.broadcast("world-v1", { t: "message.new", targetGhostId: ghostId, payload })
   *   → ColyseusWorldBridge.onMessage("world-v1", ...)
   *   → translateColyseusWorldV1 → WorldEvent { ghostId }
   *   → supervisor.deliverWorldEvent(event)
   *   → a2a.sendWorldEvent(spawnClient, { taskId, contextId, event })
   *
   * The weakest link — and the previously untested one — is step 6→7:
   * does deliverWorldEvent actually find the session and call sendWorldEvent?
   */
  const cred: WorldCredential = { token: "t", worldApiBaseUrl: "http://127.0.0.1:8787/mcp" };
  const RES15 = testH3r15();

  it("routes world.message.new to the correct ghost session via A2A push", async () => {
    const sendWorldEvent = vi.fn().mockReturnValue(Effect.void);
    const startPushSpawnContext = vi
      .fn()
      .mockReturnValue(Effect.succeed({ taskId: "task-chat", contextId: "ctx-chat" }));
    const createClient = vi.fn().mockReturnValue(Effect.succeed({ _client: true }));
    const ping = vi.fn().mockReturnValue(Effect.void);
    const cancelTask = vi.fn().mockReturnValue(Effect.void);

    const sup = makeTestSupervisor({
      catalog: {
        get: (_id: string) =>
          Effect.succeed({
            agentId: "random-agent",
            baseUrl: "http://127.0.0.1:4001",
            agentCard: {
              name: "random-agent",
              capabilities: { pushNotifications: true },
              matrix: { requiredTools: ["say"] },
            } as any,
            registeredAt: new Date().toISOString(),
            builtIn: false,
          }),
        load: () => Effect.succeed({ agents: {} } as any),
        save: () => Effect.void,
        register: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as any,
      a2a: { createClient, startPushSpawnContext, sendSpawnContextNonBlocking: startPushSpawnContext, cancelTask, pingAgent: ping, sendWorldEvent } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
      worldHttpBase: "http://127.0.0.1:8787",
      defaultCapabilityManifest: new Set(),
      pushIngestToken: "test-token",
      resolveWorldH3ForSpawn: async () => RES15,
    });

    // Spawn a wanderer with a known ghostId.
    const ghostId = "ghost-wanderer-1";
    const session = await Effect.runPromise(sup.spawn({ agentId: "random-agent", ghostId, credential: cred }));

    // Deliver a world.message.new event targeting that ghost — simulates what
    // translateColyseusWorldV1 produces after room.broadcast("world-v1", ...) reaches agent-host.
    const event = {
      schema: "aie-matrix.world-event.v1" as const,
      kind: "world.message.new" as const,
      ghostId,
      eventId: "evt-1",
      sentAt: new Date().toISOString(),
      payload: { from: "human-uuid-123", priority: "PARTNER", text: "hi there" },
    };
    await Effect.runPromise(sup.deliverWorldEvent(event));

    // The key assertion: sendWorldEvent must have been called with the correct
    // ghostId so the agent executor receives the message and can reply.
    expect(sendWorldEvent).toHaveBeenCalledOnce();
    const [, p] = sendWorldEvent.mock.calls[0]!;
    expect(p.event.ghostId).toBe(ghostId);
    expect(p.event.kind).toBe("world.message.new");
    expect(p.taskId).toBe("task-chat");
    expect(p.contextId).toBe("ctx-chat");

    await Effect.runPromise(sup.shutdown(session.sessionId));
  });

  it("silently drops event when ghostId has no active session", async () => {
    const sendWorldEvent = vi.fn().mockReturnValue(Effect.void);
    const sup = makeTestSupervisor({
      catalog: {
        get: () => Effect.succeed({ agentId: "a1", baseUrl: "http://x", agentCard: { name: "a", matrix: {} } as any, registeredAt: "", builtIn: false }),
        load: () => Effect.succeed({ agents: {} } as any),
        save: () => Effect.void,
        register: () => Effect.succeed({} as any),
        list: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as any,
      a2a: {
        createClient: vi.fn().mockReturnValue(Effect.succeed({})),
        startPushSpawnContext: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        sendSpawnContextNonBlocking: vi.fn().mockReturnValue(Effect.succeed({ taskId: "t", contextId: "c" })),
        cancelTask: vi.fn().mockReturnValue(Effect.void),
        pingAgent: vi.fn().mockReturnValue(Effect.void),
        sendWorldEvent,
      } as any,
      publicHouseBaseUrl: "http://127.0.0.1:4000",
      worldHttpBase: "http://127.0.0.1:8787",
      defaultCapabilityManifest: new Set(),
      pushIngestToken: "test-token",
      resolveWorldH3ForSpawn: async () => testH3r15(),
    });

    // No session spawned — event for unknown ghost must not throw, just drop.
    const event = {
      schema: "aie-matrix.world-event.v1" as const,
      kind: "world.message.new" as const,
      ghostId: "ghost-that-does-not-exist",
      eventId: "evt-x",
      sentAt: new Date().toISOString(),
      payload: { from: "human", priority: "PARTNER", text: "hello" },
    };
    await expect(Effect.runPromise(sup.deliverWorldEvent(event))).resolves.toBeUndefined();
    expect(sendWorldEvent).not.toHaveBeenCalled();
  });
});
