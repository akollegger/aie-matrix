/**
 * Integration timing test for seedPentagonPortals.
 *
 * When NEO4J_URI is set (e.g. in staging CI where Neo4j is already running),
 * connects to it directly. Otherwise spins up a testcontainer — requires a
 * Docker daemon but needs no pre-existing infrastructure.
 *
 * To run:
 *   pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { seedPentagonPortals } from "../src/neo4j-graph-seed.js";
import { ensureMapManagementConstraints, ensureTileH3UniqueConstraint } from "../src/neo4j-graph-init.js";

const SEED_TIMEOUT_MS = 60_000;
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

let driver: ReturnType<typeof neo4j.driver>;

test.before(async () => {
  const existingUri = process.env.NEO4J_URI?.trim();

  if (existingUri) {
    // Staging CI: a Neo4j instance is already running in the stack
    const user = process.env.NEO4J_USER?.trim() ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD ?? "";
    driver = neo4j.driver(existingUri, neo4j.auth.basic(user, password));
  } else {
    // Local / standalone: spin up a throwaway container
    const { GenericContainer, Wait } = await import("testcontainers");
    const container = await new GenericContainer("neo4j:5")
      .withEnvironment({ NEO4J_AUTH: "neo4j/testpassword" })
      .withExposedPorts(7474, 7687)
      // Wait for TCP port only — neo4j's built-in HEALTHCHECK exhausts its
      // retry budget on slow runners before the JVM is ready. Bolt readiness
      // is confirmed by the polling loop below.
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
