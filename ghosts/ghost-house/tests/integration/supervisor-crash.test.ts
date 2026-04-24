import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestSupervisor } from "../../src/supervisor/SupervisorService.js";
import { readSupervisionConfig } from "../../src/supervisor/SupervisorService.js";
import type { WorldCredential } from "../../src/types.js";
import { latLngToCell } from "h3-js";

const cred: WorldCredential = { token: "t", worldApiBaseUrl: "http://127.0.0.1:8787/mcp" };
const h3 = () => latLngToCell(40.0, -74.0, 15);

/**
 * T031: two independent sessions; one can fail (here: max restarts / hour) while
 * the other keeps running. Full process crash+restart is covered by the unit suite mocks.
 */
describe("supervisor crash (integration)", () => {
  const catalog = {
    get: async (id: string) => ({
      agentId: id,
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
  } as any;

  beforeEach(() => {
    process.env.GHOST_HOUSE_SHUTDOWN_GRACE_MS = "50";
    vi.clearAllMocks();
  });

  it("parallel session unaffected by another’s failure (T031)", async () => {
    const badPing = vi.fn().mockRejectedValue(new Error("offline"));
    const supBad = makeTestSupervisor(
      {
        catalog,
        a2a: {
          createClient: vi.fn().mockResolvedValue({}),
          sendSpawnContext: vi
            .fn()
            .mockResolvedValueOnce({ taskId: "1", contextId: "1" })
            .mockRejectedValue(new Error("nope")),
          cancelTask: vi.fn(),
          pingAgent: badPing,
        } as any,
        publicHouseBaseUrl: "http://127.0.0.1:4000",
        defaultCapabilityManifest: new Set(),
        getConfig: () => ({
          ...readSupervisionConfig(),
          healthIntervalMs: 25,
          healthTimeoutMs: 200,
          restartBaseMs: 5,
          maxRestartsPerHour: 0,
        }),
        resolveWorldH3ForSpawn: h3,
      },
      undefined,
    );

    const supOk = makeTestSupervisor(
      {
        catalog,
        a2a: {
          createClient: vi.fn().mockResolvedValue({}),
          sendSpawnContext: vi.fn().mockResolvedValue({ taskId: "a", contextId: "b" }),
          cancelTask: vi.fn(),
          pingAgent: vi.fn().mockResolvedValue(undefined),
        } as any,
        publicHouseBaseUrl: "http://127.0.0.1:4000",
        defaultCapabilityManifest: new Set(),
        getConfig: () => ({
          ...readSupervisionConfig(),
          healthIntervalMs: 25,
          healthTimeoutMs: 200,
        }),
        resolveWorldH3ForSpawn: h3,
      },
      undefined,
    );

    const s1 = await supBad.spawn({ agentId: "x", ghostId: "g1", credential: cred });
    const s2 = await supOk.spawn({ agentId: "y", ghostId: "g2", credential: cred });

    await new Promise((r) => setTimeout(r, 350));

    expect(supBad.getSession(s1.sessionId)?.status).toBe("failed");
    expect(supOk.getSession(s2.sessionId)?.status).toBe("running");

    await supOk.shutdown(s2.sessionId);
  });
});
