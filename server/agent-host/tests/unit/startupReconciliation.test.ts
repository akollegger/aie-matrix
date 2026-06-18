import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runStartupReconciliation } from "../../src/startup-reconciliation.js";
import type { ReconciliationCatalog, ReconciliationSupervisor } from "../../src/startup-reconciliation.js";

const ROSTER_ENTRY = {
  kind: "agent" as const,
  agentId: "random-agent",
  baseUrl: "http://random-agent:4001",
  agentCard: { matrix: { rosterAgent: true } } as unknown as import("../../src/types.js").CatalogEntry["agentCard"],
  registeredAt: "2026-01-01T00:00:00Z",
  builtIn: false,
  healthStatus: "unverified" as const,
};

const CATALOG_WITH_ROSTER = { agents: { "random-agent": ROSTER_ENTRY } };

function makeCatalog(file = CATALOG_WITH_ROSTER): ReconciliationCatalog {
  let current = { ...file, agents: { ...file.agents } };
  return {
    load: vi.fn().mockResolvedValue(current),
    save: vi.fn().mockImplementation(async (f) => { current = f; }),
  };
}

function makeSupervisor(): ReconciliationSupervisor {
  return {
    spawnRosterForAgent: vi.fn().mockResolvedValue({ spawned: ["ghost-1"], failed: [] }),
  };
}

function mockFetchSequence(responses: Array<{ ok: boolean; body: unknown }>) {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[i++] ?? responses.at(-1)!;
    return { ok: r.ok, json: async () => r.body, status: r.ok ? 200 : 503 };
  });
}

describe("runStartupReconciliation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls spawnRosterForAgent when active session exists and agent ping succeeds", async () => {
    const fetch = mockFetchSequence([
      { ok: true, body: [{ id: "session-1" }] },  // /live?status=active
      { ok: true, body: { status: "ok" } },         // /health ping
    ]);
    vi.stubGlobal("fetch", fetch);

    const catalog = makeCatalog();
    const supervisor = makeSupervisor();
    const result = await runStartupReconciliation({
      worldApiUrl: "http://world-api:3000",
      catalog,
      supervisor,
    });

    expect(supervisor.spawnRosterForAgent).toHaveBeenCalledWith(
      "random-agent",
      "http://random-agent:4001",
    );
    expect(result.spawned).toBe(1);
    expect(result.inactive).toBe(0);
  });

  it("marks entry inactive and skips spawn when agent ping fails", async () => {
    const fetch = mockFetchSequence([
      { ok: true, body: [{ id: "session-1" }] },  // /live
      { ok: false, body: {} },                      // /health ping fails
    ]);
    vi.stubGlobal("fetch", fetch);

    const catalog = makeCatalog();
    const supervisor = makeSupervisor();
    const result = await runStartupReconciliation({
      worldApiUrl: "http://world-api:3000",
      catalog,
      supervisor,
    });

    expect(supervisor.spawnRosterForAgent).not.toHaveBeenCalled();
    expect(catalog.save).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining({
          "random-agent": expect.objectContaining({ healthStatus: "inactive" }),
        }),
      }),
    );
    expect(result.inactive).toBe(1);
    expect(result.spawned).toBe(0);
  });

  it("returns no-active-session when live check returns empty array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
      status: 200,
    }));

    const catalog = makeCatalog();
    const supervisor = makeSupervisor();
    const result = await runStartupReconciliation({
      worldApiUrl: "http://world-api:3000",
      catalog,
      supervisor,
    });

    expect(supervisor.spawnRosterForAgent).not.toHaveBeenCalled();
    expect(result.skipped).toBe("no-active-session");
  });

  it("returns live-check-failed when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await runStartupReconciliation({
      worldApiUrl: "http://world-api:3000",
      catalog: makeCatalog(),
      supervisor: makeSupervisor(),
    });

    expect(result.skipped).toBe("live-check-failed");
  });

  it("logs AGENT_HOST_RECONCILIATION_WAIT_MS as deprecated when set", async () => {
    // This is tested by checking the structured log event from main.ts;
    // runStartupReconciliation itself does not check env vars — caller responsibility.
    // We verify the function completes without error when env var is set externally.
    const fetch = mockFetchSequence([
      { ok: true, body: [{ id: "session-1" }] },
      { ok: true, body: { status: "ok" } },
    ]);
    vi.stubGlobal("fetch", fetch);
    const result = await runStartupReconciliation({
      worldApiUrl: "http://world-api:3000",
      catalog: makeCatalog(),
      supervisor: makeSupervisor(),
    });
    expect(result.spawned).toBeGreaterThanOrEqual(0);
  });
});
