/**
 * Integration tests for RedisCatalogService — require a real Redis connection.
 * Skipped automatically when REDIS_URL is unset (CI default).
 *
 * Run locally: REDIS_URL=redis://127.0.0.1:6379 pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";

const REDIS_URL = process.env.REDIS_URL;
const SKIP = !REDIS_URL;

describe.skipIf(SKIP)("RedisCatalogService — integration (requires REDIS_URL)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let redis: any;
  let RedisCatalogServiceImpl: typeof import("../../src/catalog/RedisCatalogService.js").RedisCatalogServiceImpl;
  let svc: InstanceType<typeof RedisCatalogServiceImpl>;

  const TEST_KEY_PREFIX = "test:agent-host:catalog";

  const SEEDED_ENTRY = {
    kind: "agent" as const,
    agentId: "integration-test-agent",
    baseUrl: "http://127.0.0.1:9001",
    agentCard: {} as unknown as Extract<
      import("../../src/types.js").CatalogEntry,
      { kind?: "agent" }
    >["agentCard"],
    registeredAt: new Date().toISOString(),
    builtIn: false,
    healthStatus: "active" as const,
  };

  beforeAll(async () => {
    if (SKIP) return;
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(REDIS_URL!);
    const mod = await import("../../src/catalog/RedisCatalogService.js");
    RedisCatalogServiceImpl = mod.RedisCatalogServiceImpl;
    svc = new RedisCatalogServiceImpl(redis, TEST_KEY_PREFIX);
  });

  afterAll(async () => {
    if (!redis) return;
    // Clean up test keys
    await redis.del(TEST_KEY_PREFIX);
    await redis.quit();
  });

  beforeEach(async () => {
    if (!redis) return;
    await redis.del(TEST_KEY_PREFIX);
  });

  it("persist → restart → restore round-trip", async () => {
    await Effect.runPromise(
      svc.save({ agents: { "integration-test-agent": SEEDED_ENTRY } }),
    );

    // Simulate restart: create a fresh service instance pointing at the same Redis
    const freshSvc = new RedisCatalogServiceImpl(redis, TEST_KEY_PREFIX);
    const restored = await Effect.runPromise(freshSvc.load());

    expect(restored.agents["integration-test-agent"]).toMatchObject({
      agentId: "integration-test-agent",
      baseUrl: "http://127.0.0.1:9001",
    });
  });

  it("TTL expiry → empty catalog", async () => {
    await Effect.runPromise(
      svc.save({ agents: { "integration-test-agent": SEEDED_ENTRY } }),
    );

    // Force the key to expire in 1 second
    await redis.expire(TEST_KEY_PREFIX, 1);

    // Wait 2 seconds for TTL to fire
    await new Promise((r) => setTimeout(r, 2000));

    const restored = await Effect.runPromise(svc.load());
    expect(restored.agents).toEqual({});
  }, 10_000);
});
