import { describe, it, expect, beforeEach } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { AgentNotFound } from "../../src/errors.js";

// ioredis-mock must be imported before the service under test so the
// dynamic `import("ioredis")` call inside the service receives the mock.
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";

// We test the implementation class directly (not via Effect Layer) so
// we can exercise load/save/register without a full ManagedRuntime.
import { RedisCatalogServiceImpl } from "../../src/catalog/RedisCatalogService.js";
import type { CatalogEntry } from "../../src/types.js";

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

const SEEDED_ENTRY: Extract<CatalogEntry, { kind?: "agent" }> = {
  kind: "agent",
  agentId: "test-agent",
  baseUrl: "http://127.0.0.1:4001",
  agentCard: VALID_CARD as unknown as Extract<CatalogEntry, { kind?: "agent" }>["agentCard"],
  registeredAt: "2024-01-01T00:00:00.000Z",
  builtIn: false,
  healthStatus: "active",
};

function runEffect<A>(eff: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(eff);
}

let redis: Redis;
let svc: RedisCatalogServiceImpl;

describe("RedisCatalogServiceImpl", () => {
  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    svc = new RedisCatalogServiceImpl(redis);
  });

  it("load() on empty Redis returns empty catalog", async () => {
    const catalog = await runEffect(svc.load());
    expect(catalog.agents).toEqual({});
  });

  it("save() + load() round-trips a catalog entry", async () => {
    await runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }));
    const loaded = await runEffect(svc.load());
    expect(loaded.agents["test-agent"]).toMatchObject({
      agentId: "test-agent",
      baseUrl: "http://127.0.0.1:4001",
    });
  });

  it("save() followed by a second load() produces the same data as the first", async () => {
    await runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }));
    const a = await runEffect(svc.load());
    const b = await runEffect(svc.load());
    expect(a).toEqual(b);
  });

  it("deregister() removes the entry from Redis", async () => {
    await runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }));
    await runEffect(svc.deregister("test-agent"));
    const loaded = await runEffect(svc.load());
    expect(loaded.agents["test-agent"]).toBeUndefined();
  });

  it("deregister() fails with AgentNotFound for unknown agentId", async () => {
    const exit = await Effect.runPromiseExit(svc.deregister("no-such-agent"));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("deregister() AgentNotFound is a typed failure, not a Die (regression: runPromise-in-Effect.promise)", async () => {
    // Regression test for: RedisCatalogService.deregister wrapping Effect.runPromise inside
    // Effect.promise caused typed AgentNotFound failures to become Dies (defects).
    // Dies escape Effect.catchAll and crash the Node.js process as unhandled rejections.
    const exit = await Effect.runPromiseExit(svc.deregister("no-such-agent"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Must NOT be a defect (Die) — must be a typed failure (Fail)
      expect(Cause.isDie(exit.cause)).toBe(false);
      expect(Cause.isFailure(exit.cause)).toBe(true);
      const maybeErr = Cause.failureOption(exit.cause);
      expect(maybeErr._tag).toBe("Some");
      if (maybeErr._tag === "Some") {
        expect(maybeErr.value).toBeInstanceOf(AgentNotFound);
      }
    }
  });

  it("double-register() of same agentId is idempotent (upsert, no error) when baseUrl matches", async () => {
    // Seed the catalog with the entry already present
    await runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }));

    // A second save of the same entry should not throw or duplicate
    await runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }));
    const loaded = await runEffect(svc.load());
    const keys = Object.keys(loaded.agents);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("test-agent");
  });

  it("Redis ECONNREFUSED returns empty catalog gracefully", async () => {
    // Simulate a broken client by overriding get to throw
    (redis as unknown as { get: () => never }).get = () => { throw new Error("ECONNREFUSED"); };
    const catalog = await runEffect(svc.load());
    expect(catalog.agents).toEqual({});
  });

  it("Redis save error is swallowed (graceful degradation)", async () => {
    (redis as unknown as { set: () => never }).set = () => { throw new Error("ECONNREFUSED"); };
    // Should not throw
    await expect(runEffect(svc.save({ agents: { "test-agent": SEEDED_ENTRY } }))).resolves.toBeUndefined();
  });
});
