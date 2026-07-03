import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { CatalogServiceLive } from "../../src/catalog/CatalogService.js";
import { AgentSupervisor } from "../../src/supervisor/SupervisorService.js";
import { McpProxyServiceLive } from "../../src/mcp-proxy/mcp-proxy.layer.js";
import type { CatalogEntry } from "../../src/types.js";

const DEV_TOKEN = "test-token-xyz";
const BASE_OPTS = {
  devToken: DEV_TOKEN,
  publicBase: "http://127.0.0.1:4000",
  worldApiUrl: "http://127.0.0.1:9999",
};

const VALID_CARD = {
  name: "test-agent",
  description: "A test agent",
  protocolVersion: "0.3.0",
  version: "0.0.1",
  url: "http://127.0.0.1:4001",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [{ id: "s1", name: "Skill One", description: "Does something" }],
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  matrix: {
    schemaVersion: 1,
    tier: "wanderer",
    ghostClasses: ["any"],
    requiredTools: ["whereami", "exits", "go"],
    capabilitiesRequired: [],
    memoryKind: "none",
    llmProvider: "none",
    profile: { about: "A test ghost" },
    authors: ["test"],
  },
};

const SEEDED_ENTRY: CatalogEntry = {
  agentId: "existing-agent",
  baseUrl: "http://127.0.0.1:4001",
  agentCard: VALID_CARD as unknown as CatalogEntry["agentCard"],
  registeredAt: "2024-01-01T00:00:00.000Z",
  builtIn: false,
};

function makeStubSupervisorLayer(activeSessions: Record<string, string[]> = {}) {
  return Layer.succeed(AgentSupervisor, {
    spawn: () => Effect.die("stub"),
    shutdown: () => Effect.die("stub"),
    getSession: () => undefined,
    getByMcpToken: () => undefined,
    getSessionByGhostId: () => undefined,
    listSessionIdsByAgent: (agentId: string) => activeSessions[agentId] ?? [],
    listSessions: () => [],
    deliverWorldEvent: () => Effect.void,
    despawnByAgent: () => Effect.void,
    spawnRosterForAgent: () => Effect.succeed({ spawned: [], failed: [] }),
  });
}

function makeStubSupervisorWithSpyRoster(
  spawnRosterFn: ReturnType<typeof vi.fn>,
  activeSessions: Record<string, string[]> = {},
) {
  return Layer.succeed(AgentSupervisor, {
    spawn: () => Effect.die("stub"),
    shutdown: () => Effect.die("stub"),
    getSession: () => undefined,
    getByMcpToken: () => undefined,
    getSessionByGhostId: () => undefined,
    listSessionIdsByAgent: (agentId: string) => activeSessions[agentId] ?? [],
    listSessions: () => [],
    deliverWorldEvent: () => Effect.void,
    despawnByAgent: () => Effect.void,
    spawnRosterForAgent: (agentId: string, agentBaseUrl: string) => {
      spawnRosterFn(agentId, agentBaseUrl);
      return Effect.succeed({ spawned: [], failed: [] });
    },
  });
}

async function buildRuntime(
  catalogPath: string,
  activeSessions: Record<string, string[]> = {},
) {
  const layer = Layer.mergeAll(
    CatalogServiceLive(catalogPath),
    makeStubSupervisorLayer(activeSessions),
    McpProxyServiceLive,
  );
  return ManagedRuntime.make(layer);
}

async function seedCatalog(
  path: string,
  agents: Record<string, CatalogEntry>,
): Promise<void> {
  await writeFile(path, JSON.stringify({ agents }, null, 2), "utf8");
}

function stubFetchCard(card: object | "network-error" | "http-error"): void {
  if (card === "network-error") {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
  } else if (card === "http-error") {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
  } else {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(card) }),
    );
  }
}

// Stubs both the agent-card fetch AND the /live?status=active check.
// Differentiates by URL: /live returns sessions, everything else returns the card.
function stubFetchCardAndLive(card: object, sessions: Array<{ id: string }>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/live")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(sessions) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(card) });
    }),
  );
}

const ROSTER_CARD = {
  ...VALID_CARD,
  matrix: { ...VALID_CARD.matrix, rosterAgent: true },
};

let tmpDir: string;
let catalogPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "catalog-routes-test-"));
  catalogPath = join(tmpDir, "catalog.json");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("POST /v1/catalog/register", () => {
  it("201 on success — body contains ok:true and agentId", async () => {
    stubFetchCard(VALID_CARD);
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ agentId: "new-agent", baseUrl: "http://127.0.0.1:4001" });
    await rt.dispose();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, agentId: "new-agent" });
  });

  it("201 UPSERT when a different baseUrl registers with the same agentId (pod replacement)", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    stubFetchCard(VALID_CARD);
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      // SEEDED_ENTRY's baseUrl is 4001 — a new pod at 4002 with the same stable
      // AGENT_ID is allowed to take over the slot (Kubernetes rolling deploy).
      .send({ agentId: "existing-agent", baseUrl: "http://127.0.0.1:4002" });
    await rt.dispose();
    expect(res.status).toBe(201);
    expect(res.body.agentId).toBe("existing-agent");
  });

  it("re-register from same baseUrl is an UPSERT — refreshes the agent card", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    // Return a card with NEW requiredTools to prove the catalog refreshed.
    const refreshedCard = {
      ...VALID_CARD,
      matrix: { ...VALID_CARD.matrix, requiredTools: ["whereami", "exits", "go", "say"] },
    };
    stubFetchCard(refreshedCard);
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ agentId: "existing-agent", baseUrl: "http://127.0.0.1:4001" });
    await rt.dispose();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, agentId: "existing-agent" });
  });

  it("502 AGENT_CARD_FETCH_FAILED when the agent is unreachable", async () => {
    stubFetchCard("network-error");
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ agentId: "new-agent", baseUrl: "http://127.0.0.1:4001" });
    await rt.dispose();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("AGENT_CARD_FETCH_FAILED");
  });

  it("400 VALIDATION_FAILED when agentId or baseUrl is missing from the body", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ agentId: "new-agent" }); // missing baseUrl
    await rt.dispose();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("401 UNAUTHORIZED when Authorization header is absent or wrong", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/register")
      .send({ agentId: "new-agent", baseUrl: "http://127.0.0.1:4001" });
    await rt.dispose();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  describe("registration-spawn hook", () => {
    it("calls spawnRosterForAgent when a roster agent registers and a session is active", async () => {
      const spawnRosterFn = vi.fn();
      stubFetchCardAndLive(ROSTER_CARD, [{ id: "session-1" }]);
      const layer = Layer.mergeAll(
        CatalogServiceLive(catalogPath),
        makeStubSupervisorWithSpyRoster(spawnRosterFn),
        McpProxyServiceLive,
      );
      const rt = ManagedRuntime.make(layer);
      const app = createApp(rt, BASE_OPTS);

      const res = await supertest(app)
        .post("/v1/catalog/register")
        .set("Authorization", `Bearer ${DEV_TOKEN}`)
        .send({ agentId: "roster-agent", baseUrl: "http://127.0.0.1:4001" });

      expect(res.status).toBe(201);
      // Wait for the fire-and-forget async block to complete
      await vi.waitFor(() => expect(spawnRosterFn).toHaveBeenCalledWith("roster-agent", "http://127.0.0.1:4001"));
      await rt.dispose();
    });

    it("retries spawn when world-api is initially unreachable then recovers", async () => {
      const spawnRosterFn = vi.fn();
      // First live check throws (world-api down), second returns an active session.
      let liveCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (String(url).includes("/live")) {
            liveCallCount++;
            if (liveCallCount === 1) return Promise.reject(new Error("fetch failed"));
            return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: "session-1" }]) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER_CARD) });
        }),
      );
      const layer = Layer.mergeAll(
        CatalogServiceLive(catalogPath),
        makeStubSupervisorWithSpyRoster(spawnRosterFn),
        McpProxyServiceLive,
      );
      const rt = ManagedRuntime.make(layer);
      // spawnRetryDelayMs=10 makes the retry fire in ~10ms instead of 5s
      const app = createApp(rt, { ...BASE_OPTS, spawnRetryDelayMs: 10 });

      const res = await supertest(app)
        .post("/v1/catalog/register")
        .set("Authorization", `Bearer ${DEV_TOKEN}`)
        .send({ agentId: "roster-agent", baseUrl: "http://127.0.0.1:4001" });

      expect(res.status).toBe(201);
      // Retry fires after spawnRetryDelayMs — give it a generous window
      await vi.waitFor(
        () => expect(spawnRosterFn).toHaveBeenCalledWith("roster-agent", "http://127.0.0.1:4001"),
        { timeout: 2_000 },
      );
      await rt.dispose();
    });

    it("does not call spawnRosterForAgent when a roster agent registers but no session is active", async () => {
      const spawnRosterFn = vi.fn();
      stubFetchCardAndLive(ROSTER_CARD, []); // empty sessions
      const layer = Layer.mergeAll(
        CatalogServiceLive(catalogPath),
        makeStubSupervisorWithSpyRoster(spawnRosterFn),
        McpProxyServiceLive,
      );
      const rt = ManagedRuntime.make(layer);
      const app = createApp(rt, BASE_OPTS);

      const res = await supertest(app)
        .post("/v1/catalog/register")
        .set("Authorization", `Bearer ${DEV_TOKEN}`)
        .send({ agentId: "roster-agent", baseUrl: "http://127.0.0.1:4001" });

      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 100));
      expect(spawnRosterFn).not.toHaveBeenCalled();
      await rt.dispose();
    });

    it("does not call spawnRosterForAgent for a non-roster agent even when a session is active", async () => {
      const spawnRosterFn = vi.fn();
      stubFetchCardAndLive(VALID_CARD, [{ id: "session-1" }]);
      const layer = Layer.mergeAll(
        CatalogServiceLive(catalogPath),
        makeStubSupervisorWithSpyRoster(spawnRosterFn),
        McpProxyServiceLive,
      );
      const rt = ManagedRuntime.make(layer);
      const app = createApp(rt, BASE_OPTS);

      const res = await supertest(app)
        .post("/v1/catalog/register")
        .set("Authorization", `Bearer ${DEV_TOKEN}`)
        .send({ agentId: "new-agent", baseUrl: "http://127.0.0.1:4001" });

      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 100));
      expect(spawnRosterFn).not.toHaveBeenCalled();
      await rt.dispose();
    });
  });
});

describe("GET /v1/catalog", () => {
  it("200 with agents array", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app).get("/v1/catalog");
    await rt.dispose();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].agentId).toBe("existing-agent");
  });
});

describe("GET /v1/catalog/:agentId", () => {
  it("200 with agentCard JSON for a known agentId", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app).get("/v1/catalog/existing-agent");
    await rt.dispose();
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("test-agent");
  });

  it("404 NOT_FOUND for an unknown agentId", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app).get("/v1/catalog/ghost");
    await rt.dispose();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /v1/catalog/:agentId", () => {
  it("200 on success", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .delete("/v1/catalog/existing-agent")
      .set("Authorization", `Bearer ${DEV_TOKEN}`);
    await rt.dispose();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, agentId: "existing-agent" });
  });

  it("404 NOT_FOUND for an unknown agentId", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .delete("/v1/catalog/ghost")
      .set("Authorization", `Bearer ${DEV_TOKEN}`);
    await rt.dispose();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("409 ACTIVE_SESSIONS when the agent has live sessions", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    const rt = await buildRuntime(catalogPath, { "existing-agent": ["session-1"] });
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .delete("/v1/catalog/existing-agent")
      .set("Authorization", `Bearer ${DEV_TOKEN}`);
    await rt.dispose();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_SESSIONS");
  });

  it("401 UNAUTHORIZED when Authorization header is absent or wrong", async () => {
    await seedCatalog(catalogPath, { "existing-agent": SEEDED_ENTRY });
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .delete("/v1/catalog/existing-agent")
      .set("Authorization", "Bearer wrong-token");
    await rt.dispose();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /v1/internal/a2a-agent-push", () => {
  let tmpDir: string;
  let catalogPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "catalog-routes-push-test-"));
    catalogPath = join(tmpDir, "catalog.json");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("204 when X-A2A-Notification-Token equals devToken (A2A SDK DefaultPushNotificationSender path)", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/internal/a2a-agent-push")
      .set("X-A2A-Notification-Token", DEV_TOKEN)
      .send({ id: "task-1", status: { state: "completed" } });
    await rt.dispose();
    expect(res.status).toBe(204);
  });

  it("204 when Authorization: Bearer devToken is used", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/internal/a2a-agent-push")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ id: "task-1", status: { state: "completed" } });
    await rt.dispose();
    expect(res.status).toBe(204);
  });

  it("401 when token is wrong or absent", async () => {
    const rt = await buildRuntime(catalogPath);
    const app = createApp(rt, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/internal/a2a-agent-push")
      .set("X-A2A-Notification-Token", "wrong-token")
      .send({ id: "task-1", status: { state: "completed" } });
    await rt.dispose();
    expect(res.status).toBe(401);
  });
});
