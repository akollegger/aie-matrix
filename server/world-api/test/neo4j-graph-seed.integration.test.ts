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
    .withWaitStrategy(Wait.forHttp("/", 7474).forStatusCode(200))
    .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
    .start();

  const boltUrl = `bolt://${container.getHost()}:${container.getMappedPort(7687)}`;
  driver = neo4j.driver(boltUrl, neo4j.auth.basic("neo4j", "testpassword"));
}, { timeout: CONTAINER_STARTUP_TIMEOUT_MS + 5_000 });

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
