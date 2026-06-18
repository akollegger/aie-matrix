import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import will fail until reconciliation.ts is created (TDD)
import { reconcileRoster } from "../src/reconciliation.js";

describe("reconcileRoster", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns the delta when world API returns fewer ghosts than target", async () => {
    // 3 existing ghosts, target 10 → spawn 7
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { ghostId: "g1", agentId: "test-agent" },
          { ghostId: "g2", agentId: "test-agent" },
          { ghostId: "g3", agentId: "test-agent" },
        ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const spawnFn = vi.fn().mockResolvedValue({ ghostId: "g-new" });

    const result = await reconcileRoster({
      worldApiUrl: "http://localhost:8787",
      agentId: "test-agent",
      token: "secret",
      targetCount: 10,
      activeLoopsCount: 3,
      spawnGhost: spawnFn,
    });

    // 10 - 3 = 7 spawns needed
    expect(spawnFn).toHaveBeenCalledTimes(7);
    expect(result.spawned).toBe(7);

    // Logs reconciliation.spawning event
    const logCalls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map(([m]) => {
      try { return JSON.parse(m as string) as Record<string, unknown>; } catch { return null; }
    });
    const spawningLog = logCalls.find((e) => e?.event === "random-agent.reconciliation.spawning");
    expect(spawningLog).toBeDefined();
    expect(spawningLog!["delta"]).toBe(7);
  });

  it("spawns zero when world API returns target number of ghosts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          Array.from({ length: 10 }, (_, i) => ({ ghostId: `g${i}`, agentId: "test-agent" })),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const spawnFn = vi.fn();
    const result = await reconcileRoster({
      worldApiUrl: "http://localhost:8787",
      agentId: "test-agent",
      token: "secret",
      targetCount: 10,
      activeLoopsCount: 10,
      spawnGhost: spawnFn,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(result.spawned).toBe(0);

    const logCalls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map(([m]) => {
      try { return JSON.parse(m as string) as Record<string, unknown>; } catch { return null; }
    });
    const noop = logCalls.find((e) => e?.event === "random-agent.reconciliation.no-op");
    expect(noop).toBeDefined();
  });

  it("logs a warning and spawns 0 when world API call errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const spawnFn = vi.fn();
    const result = await reconcileRoster({
      worldApiUrl: "http://localhost:8787",
      agentId: "test-agent",
      token: "secret",
      targetCount: 10,
      activeLoopsCount: 0,
      spawnGhost: spawnFn,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(result.spawned).toBe(0);
    expect(result.error).toBeDefined();
  });
});
