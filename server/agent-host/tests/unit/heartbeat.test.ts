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

const DEV_TOKEN = "test-token-heartbeat";
const BASE_OPTS = {
  devToken: DEV_TOKEN,
  publicBase: "http://127.0.0.1:4000",
  worldApiUrl: "http://127.0.0.1:9999",
};

const VALID_CARD = {
  name: "hb-agent",
  description: "A heartbeat test agent",
  protocolVersion: "0.3.0",
  version: "0.0.1",
  url: "http://127.0.0.1:4002",
  capabilities: { streaming: false, pushNotifications: false },
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
    profile: { about: "HB test ghost" },
    authors: ["test"],
  },
};

const SEEDED_ENTRY: CatalogEntry = {
  kind: "agent",
  agentId: "hb-agent",
  baseUrl: "http://127.0.0.1:4002",
  agentCard: VALID_CARD as unknown as Extract<CatalogEntry, { kind?: "agent" }>["agentCard"],
  registeredAt: "2024-01-01T00:00:00.000Z",
  builtIn: false,
};

function makeStubSupervisorLayer() {
  return Layer.succeed(AgentSupervisor, {
    spawn: () => Effect.die("stub"),
    shutdown: () => Effect.die("stub"),
    getSession: () => undefined,
    getByMcpToken: () => undefined,
    getSessionByGhostId: () => undefined,
    listSessionIdsByAgent: () => [],
    listSessions: () => [],
    deliverWorldEvent: () => Effect.void,
    spawnRosterForAgent: () => Effect.succeed({ spawned: [], failed: [] }),
  });
}

async function buildRuntime(catalogPath: string) {
  const layer = Layer.mergeAll(
    CatalogServiceLive(catalogPath),
    makeStubSupervisorLayer(),
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

let tmpDir: string;
let catalogPath: string;
let runtime: ManagedRuntime.ManagedRuntime<CatalogService | AgentSupervisor | McpProxyService | BarnacleSupervisor, never>;

type CatalogService = import("../../src/catalog/CatalogService.js").CatalogService;
type McpProxyService = import("../../src/mcp-proxy/McpProxyService.js").McpProxyService;
type BarnacleSupervisor = import("../../src/barnacle/index.js").BarnacleSupervisor;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "hb-test-"));
  catalogPath = join(tmpDir, "catalog.json");
  await seedCatalog(catalogPath, { "hb-agent": SEEDED_ENTRY });
  runtime = await buildRuntime(catalogPath);
});

afterEach(async () => {
  await (runtime as unknown as { dispose: () => Promise<void> }).dispose?.();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("POST /v1/catalog/:agentId/heartbeat", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const app = createApp(runtime as unknown as import("../../src/app.js").AppRuntime, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/hb-agent/heartbeat")
      .send({ ts: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown agentId", async () => {
    const app = createApp(runtime as unknown as import("../../src/app.js").AppRuntime, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/no-such-agent/heartbeat")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ ts: new Date().toISOString() });
    expect(res.status).toBe(404);
  });

  it("returns 200 with sessionActive: false for a known agent with no active sessions", async () => {
    const app = createApp(runtime as unknown as import("../../src/app.js").AppRuntime, BASE_OPTS);
    const res = await supertest(app)
      .post("/v1/catalog/hb-agent/heartbeat")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ ts: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionActive: false });
  });

  it("updates lastSeenAt on the catalog entry after a successful heartbeat", async () => {
    const app = createApp(runtime as unknown as import("../../src/app.js").AppRuntime, BASE_OPTS);
    const ts = new Date().toISOString();
    const hbRes = await supertest(app)
      .post("/v1/catalog/hb-agent/heartbeat")
      .set("Authorization", `Bearer ${DEV_TOKEN}`)
      .send({ ts });
    // Heartbeat must succeed for lastSeenAt to be updated
    expect(hbRes.status).toBe(200);

    // Query the catalog to verify lastSeenAt was persisted on the entry.
    // The detailed entry endpoint may not exist yet; fall back to checking
    // the catalog JSON file written to disk by CatalogServiceLive.
    const catalogJson = JSON.parse(
      await import("node:fs/promises").then((fs) => fs.readFile(catalogPath, "utf8")),
    ) as { agents: Record<string, { lastSeenAt?: string }> };
    expect(catalogJson.agents["hb-agent"]?.lastSeenAt).toBeDefined();
  });
});
