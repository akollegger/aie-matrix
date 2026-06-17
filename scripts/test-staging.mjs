#!/usr/bin/env node
/**
 * test:staging — brings up the staging compose stack, runs integration tests, tears down.
 *
 * Usage:
 *   ADMIN_TOKEN=secret AGENT_HOST_TOKEN=secret pnpm test:staging
 *
 * Optional:
 *   COMPOSE_FILE      — path to compose file (default: deploy/staging/docker-compose.yml)
 *   STACK_TIMEOUT_MS  — ms to wait for stack healthy (default: 180000)
 *   WAIT_TIMEOUT_MS   — ms for ghost tests (default: 90000, longer than CI since build takes time)
 *   KEEP_UP           — set to "1" to leave the stack running after tests
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = process.env.COMPOSE_FILE ?? "deploy/staging/docker-compose.yml";
const STACK_TIMEOUT_MS = parseInt(process.env.STACK_TIMEOUT_MS ?? "180000", 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const AGENT_HOST_TOKEN = process.env.AGENT_HOST_TOKEN;

if (!ADMIN_TOKEN) { console.error("[test:staging] ERROR: ADMIN_TOKEN is required"); process.exit(1); }
if (!AGENT_HOST_TOKEN) { console.error("[test:staging] ERROR: AGENT_HOST_TOKEN is required"); process.exit(1); }

// Detect compose command (podman compose or docker compose)
function findComposeCmd() {
  for (const cmd of ["podman", "docker"]) {
    try { execSync(`which ${cmd}`, { stdio: "ignore" }); return `${cmd} compose`; } catch { /* next */ }
  }
  console.error("[test:staging] ERROR: neither podman nor docker found in PATH");
  process.exit(1);
}
const COMPOSE_CMD = findComposeCmd();

function compose(args, extraEnv = {}) {
  return execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} ${args}`, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      // Development mode: file-backed maps, no GCS required, auto-activates from maps/ dir
      AIE_MATRIX_MODE: "development",
      NEO4J_AUTH: "neo4j/devpassword",
      NEO4J_PASSWORD: "devpassword",
      ADMIN_TOKEN,
      AGENT_HOST_TOKEN,
      ...extraEnv,
    },
  });
}

async function waitForHealth(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.status === "ok") { console.error(`[test:staging]   ${label} healthy`); return; }
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error(`${label} did not become healthy within ${timeoutMs / 1000}s (last: ${last})`);
}

let stackUp = false;

async function teardown() {
  if (process.env.KEEP_UP === "1") {
    console.error("[test:staging] KEEP_UP=1 — stack left running.");
    return;
  }
  if (stackUp) {
    console.error("[test:staging] Tearing down…");
    try { compose("down --volumes --remove-orphans"); } catch { /* best effort */ }
  }
}

process.on("SIGINT", () => teardown().finally(() => process.exit(130)));
process.on("SIGTERM", () => teardown().finally(() => process.exit(143)));

try {
  // ── Start stack ────────────────────────────────────────────────────────────
  console.error(`[test:staging] Starting compose stack (${COMPOSE_CMD})…`);
  compose("down --volumes --remove-orphans");
  compose("up --build --detach");
  stackUp = true;

  // ── Wait for services ──────────────────────────────────────────────────────
  console.error("[test:staging] Waiting for services to become healthy…");
  await waitForHealth("http://127.0.0.1:8787/health", "world server", STACK_TIMEOUT_MS);
  await waitForHealth("http://127.0.0.1:4000/health", "agent-host", STACK_TIMEOUT_MS);

  // ── Run ghost spawn test ───────────────────────────────────────────────────
  console.error("[test:staging] Running ghost spawn test…");
  const child = spawn(
    "node", ["scripts/test-ghost-spawn.mjs"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        SERVER_URL: "http://127.0.0.1:8787",
        AGENT_HOST_URL: "http://127.0.0.1:4000",
        ADMIN_TOKEN,
        AGENT_HOST_TOKEN,
        GHOST_MIN_COUNT: process.env.GHOST_MIN_COUNT ?? "1",
        WAIT_TIMEOUT_MS: process.env.WAIT_TIMEOUT_MS ?? "90000",
      },
    },
  );
  const code = await new Promise(resolve => child.on("exit", resolve));
  if (code !== 0) throw new Error(`test-ghost-spawn.mjs exited with code ${code}`);

  console.error("[test:staging] ✓ All staging tests passed.");
} catch (e) {
  console.error(`[test:staging] FAIL: ${e instanceof Error ? e.message : String(e)}`);
  // Dump logs before teardown
  try {
    execSync(`${COMPOSE_CMD} -f ${COMPOSE_FILE} logs --no-color --tail=50`, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  } catch { /* ignore */ }
  await teardown();
  process.exit(1);
}

await teardown();
