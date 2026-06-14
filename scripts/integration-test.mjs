#!/usr/bin/env node
/**
 * Run integration tests against a live Neo4j instance.
 *
 * If NEO4J_URI is already set, uses that directly (Aura, remote, already-running container).
 * Otherwise starts the dev compose stack, waits for Neo4j to be healthy, runs tests, then
 * stops the containers.
 *
 * Usage:
 *   pnpm test:integration                   # auto-manage dev compose
 *   NEO4J_URI=bolt://localhost:7687 \
 *     NEO4J_PASSWORD=mypassword \
 *     pnpm test:integration                 # use existing Neo4j, skip compose
 *   pnpm test:integration --keep-running    # don't stop compose after tests
 */
import { execSync, spawnSync } from "node:child_process";
import process from "node:process";

const KEEP = process.argv.includes("--keep-running");
const COMPOSE_FILE = "docker-compose.dev.yml";

const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "devpassword";

// Integration test files in dependency order
const TEST_PACKAGES = [
  "@aie-matrix/server-world-api",
];

let managedCompose = false;

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, stdio: "inherit", ...opts });
}

function composeUp() {
  console.info("[integration-test] Starting dev infrastructure…");
  const r = run(`docker compose -f ${COMPOSE_FILE} up -d`);
  if (r.status !== 0) {
    console.error("[integration-test] Failed to start compose stack.");
    process.exit(1);
  }
  managedCompose = true;
}

function waitForNeo4j(maxWaitMs = 60_000) {
  const deadline = Date.now() + maxWaitMs;
  console.info("[integration-test] Waiting for Neo4j to be ready…");
  while (Date.now() < deadline) {
    const r = run(
      `docker compose -f ${COMPOSE_FILE} exec -T neo4j ` +
      `cypher-shell -u ${NEO4J_USER} -p ${NEO4J_PASSWORD} 'RETURN 1' 2>/dev/null`,
      { stdio: "ignore" },
    );
    if (r.status === 0) {
      console.info("[integration-test] Neo4j ready.");
      return;
    }
    execSync("sleep 2");
  }
  console.error("[integration-test] Neo4j did not become ready in time.");
  process.exit(1);
}

function composeDown() {
  if (!managedCompose || KEEP) return;
  console.info("[integration-test] Stopping dev infrastructure…");
  run(`docker compose -f ${COMPOSE_FILE} down`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const externalNeo4j = !!process.env["NEO4J_URI"];

if (!externalNeo4j) {
  composeUp();
  waitForNeo4j();
}

let anyFailure = false;

for (const pkg of TEST_PACKAGES) {
  console.info(`\n[integration-test] Running ${pkg}…`);
  const r = run(
    `NEO4J_URI="${NEO4J_URI}" NEO4J_USER="${NEO4J_USER}" NEO4J_PASSWORD="${NEO4J_PASSWORD}" ` +
    `pnpm --filter ${pkg} test:integration`,
  );
  if (r.status !== 0) anyFailure = true;
}

composeDown();

if (anyFailure) {
  console.error("\n[integration-test] One or more test packages failed.");
  process.exit(1);
} else {
  console.info("\n[integration-test] All integration tests passed.");
}
