/**
 * Integration timing test for seedPentagonPortals using a testcontainer Neo4j instance.
 * Requires a Docker daemon. Runs anywhere without pre-existing infrastructure.
 *
 * To run:
 *   pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import { GenericContainer, Wait } from "testcontainers";
import neo4j from "neo4j-driver";
import { seedPentagonPortals } from "../src/neo4j-graph-seed.js";
import { ensureMapManagementConstraints, ensureTileH3UniqueConstraint } from "../src/neo4j-graph-init.js";

const SEED_TIMEOUT_MS = 60_000;
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

let driver: ReturnType<typeof neo4j.driver>;

test.before(async () => {
  const container = await new GenericContainer("neo4j:5")
    .withEnvironment({ NEO4J_AUTH: "neo4j/testpassword" })
    .withExposedPorts(7474, 7687)
    // Wait for TCP port only — neo4j's built-in HEALTHCHECK exhausts its retry
    // budget on slow CI runners before the JVM is ready. Bolt readiness is
    // confirmed by the polling loop below.
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
    .start();

  const boltUrl = `bolt://${container.getHost()}:${container.getMappedPort(7687)}`;
  driver = neo4j.driver(boltUrl, neo4j.auth.basic("neo4j", "testpassword"));

  // Poll until Bolt accepts queries — port open doesn't mean Neo4j is ready
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const s = driver.session();
      await s.run("RETURN 1");
      await s.close();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}, { timeout: CONTAINER_STARTUP_TIMEOUT_MS + 65_000 });

test.after(async () => {
  await driver?.close();
});

test("seedPentagonPortals completes within 60s (cold — indexes just created)", async () => {
  await ensureTileH3UniqueConstraint(driver);
  await ensureMapManagementConstraints(driver);

  const start = performance.now();
  await seedPentagonPortals(driver);
  const elapsed = performance.now() - start;

  console.log(`seedPentagonPortals (cold): ${elapsed.toFixed(0)}ms`);
  assert.ok(elapsed < SEED_TIMEOUT_MS, `seeding took ${elapsed.toFixed(0)}ms, expected < ${SEED_TIMEOUT_MS}ms`);
}, { timeout: SEED_TIMEOUT_MS + 5_000 });

test("seedPentagonPortals completes within 60s (warm — idempotent re-run)", async () => {
  const start = performance.now();
  await seedPentagonPortals(driver);
  const elapsed = performance.now() - start;

  console.log(`seedPentagonPortals (warm): ${elapsed.toFixed(0)}ms`);
  assert.ok(elapsed < SEED_TIMEOUT_MS, `seeding took ${elapsed.toFixed(0)}ms, expected < ${SEED_TIMEOUT_MS}ms`);
}, { timeout: SEED_TIMEOUT_MS + 5_000 });
