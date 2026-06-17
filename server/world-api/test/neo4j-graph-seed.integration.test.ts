/**
 * Integration timing test for seedPentagonPortals.
 * Skipped when NEO4J_URI is not set — run locally or in CI with a live Neo4j instance.
 *
 * To run:
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=devpassword \
 *     pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { seedPentagonPortals } from "../src/neo4j-graph-seed.js";
import { ensureMapManagementConstraints, ensureTileH3UniqueConstraint } from "../src/neo4j-graph-init.js";

const NEO4J_URI = process.env["NEO4J_URI"];
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "devpassword";

const SEED_TIMEOUT_MS = 5_000;

test.skip(!NEO4J_URI, "NEO4J_URI not set — skipping neo4j-graph-seed integration tests");

if (NEO4J_URI) {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

  test("seedPentagonPortals completes within 5 seconds (cold)", async () => {
    // Ensure indexes are in place first, as they would be during real startup
    await ensureTileH3UniqueConstraint(driver);
    await ensureMapManagementConstraints(driver);

    const start = performance.now();
    await seedPentagonPortals(driver);
    const elapsed = performance.now() - start;

    console.log(`seedPentagonPortals (cold): ${elapsed.toFixed(0)}ms`);
    assert.ok(elapsed < SEED_TIMEOUT_MS, `seeding took ${elapsed.toFixed(0)}ms, expected < ${SEED_TIMEOUT_MS}ms`);
  });

  test("seedPentagonPortals completes within 5 seconds (warm — idempotent re-run)", async () => {
    // Second run exercises the MERGE no-op path — simulates a pod restart
    const start = performance.now();
    await seedPentagonPortals(driver);
    const elapsed = performance.now() - start;

    console.log(`seedPentagonPortals (warm): ${elapsed.toFixed(0)}ms`);
    assert.ok(elapsed < SEED_TIMEOUT_MS, `seeding took ${elapsed.toFixed(0)}ms, expected < ${SEED_TIMEOUT_MS}ms`);
  });

  test.after(async () => { await driver.close(); });
}
