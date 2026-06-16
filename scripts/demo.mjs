#!/usr/bin/env node
/**
 * Full local stack: world server → agent-host → random-agent + npc-agent → intermedium + map-editor.
 * Ctrl+C stops all child processes.
 *
 * New dev quickstart:
 *   git clone … && cd aie-matrix
 *   pnpm install
 *   pnpm run demo
 *
 * Then open:
 *   http://127.0.0.1:5180/  — Intermedium (spectator view, ghosts moving)
 *   http://127.0.0.1:5182/  — Map Editor  (admin panel to spawn/manage ghosts)
 *
 * ## Env (repo root `.env` / `.env.local` — loaded via `loadRootEnv()`;
 * all child processes inherit the merged `process.env`.)
 *
 * - `AGENT_HOST_TOKEN` — shared bearer (agent-host + agent A2A). Auto-generated
 *   as a random UUID when absent; set in `.env` to pin a stable value across
 *   restarts (useful for persistent catalog registrations).
 * - `ADMIN_TOKEN` — world server admin bearer (publish map, start/end live session).
 *   Required for the demo to create a live session in the map-editor admin panel.
 *   Without it the map-editor will show maps (if Neo4j is configured) but no session.
 * - `AIE_MATRIX_HTTP_PORT` (optional) — world server port, default `8787`.
 * - `AGENT_HOST_PORT` (optional) — agent-host port, default `4000`.
 * - `AGENT_PORT` (optional) — random-agent port, default `4001`.
 * - `NPC_AGENT_PORT` (optional) — npc-agent port, default `4004`.
 * - `AGENT_HOST_URL` (optional) — override agent-host base URL (e.g. if running
 *   behind a tunnel); default `http://127.0.0.1:<AGENT_HOST_PORT>`.
 *
 * ## Startup order
 *
 * 1. Build + start `@aie-matrix/server` — world + Colyseus + registry (port 8787).
 * 2. Wait for server ready, then start in parallel:
 *    - `@aie-matrix/server-agent-host` — A2A catalog + spawn API (port 4000).
 *    - `@aie-matrix/random-agent`      — Wanderer ghost endpoint (port 4001).
 *    - `@aie-matrix/npc-agent`         — NPC broker ghost endpoint (port 4004).
 *    - `@aie-matrix/intermedium`       — Vite spectator UI (port 5180).
 *    - `@aie-matrix/map-editor`        — Vite admin UI (port 5182).
 * 3. Ghosts spawn automatically when a session is activated via the map-editor Admin panel.
 *    agent-host also reconciles on startup — if a session is already active, ghosts
 *    spawn without waiting for the `world.session.start` event.
 *
 * **CLI:** `-n` / `--ghosts <n>` — number of wanderer ghosts to spawn per session
 * (default `10`, max `32`). Sets `RANDOM_AGENT_COUNT` on the random-agent process.
 * Example: `pnpm run demo -- --ghosts 5`.
 *
 * **Troubleshooting:** If you never see `[demo]` lines you are probably running
 * `pnpm run server` instead of `pnpm run demo`.
 */
import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");

const httpPort = String(process.env.AIE_MATRIX_HTTP_PORT ?? "8787").trim() || "8787";
const readyUrl = `http://127.0.0.1:${httpPort}/spectator/room`;

const housePort = process.env.AGENT_HOST_PORT || "4000";
const agentPort = process.env.AGENT_PORT || "4001";
const npcAgentPort = process.env.NPC_AGENT_PORT || "4004";
const houseBase =
  process.env.AGENT_HOST_URL || `http://127.0.0.1:${housePort}`;
if (process.env.AGENT_HOST_TOKEN === undefined) {
  process.env.AGENT_HOST_TOKEN = randomUUID();
  console.info("[demo] AGENT_HOST_TOKEN not set — using ephemeral token for this session. Add AGENT_HOST_TOKEN to .env to pin it.");
}
const token = /** @type {string} */ (process.env.AGENT_HOST_TOKEN);
const adminToken = process.env.ADMIN_TOKEN || "";

// Vite front-end ports (fixed in each package's vite.config.ts)
const intermediumPort = "5180";
const mapEditorPort = "5182";

const MAX_DEMO_GHOSTS = 32;

function printDemoHelp() {
  console.log(`Usage: node scripts/demo.mjs [options]

Full local stack: world server, agent-host, random-agent, intermedium, map-editor.
Ghosts spawn automatically when a session is activated via the map-editor Admin panel.

Options:
  -h, --help              Show this help
  -n, --ghosts <n>        Wanderer ghost count per session (0..${MAX_DEMO_GHOSTS}, default 10)
      --ghosts=<n>       Long option with equals

Examples:
  pnpm run demo
  pnpm run demo -- --ghosts 5
`);
}

/**
 * @param {string} name
 * @param {string} raw
 */
function parseNonNegativeIntArg(name, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} expects a non-negative integer, got: ${String(raw)}`);
  }
  return Math.trunc(n);
}

/**
 * @param {string[]} argv
 * @returns {{ wandererCount: number }}
 */
function parseDemoArgv(argv) {
  let wandererCount = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      continue;
    }
    if (a === "-h" || a === "--help") {
      printDemoHelp();
      process.exit(0);
    }
    if (a.startsWith("--ghosts=")) {
      wandererCount = Math.min(MAX_DEMO_GHOSTS, parseNonNegativeIntArg("--ghosts", a.slice("--ghosts=".length)));
      continue;
    }
    if (a === "--ghosts" || a === "-n") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) {
        throw new Error("--ghosts / -n requires a number");
      }
      wandererCount = Math.min(MAX_DEMO_GHOSTS, parseNonNegativeIntArg("--ghosts", v));
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a} (try --help)`);
    }
    throw new Error(`Unexpected argument: ${a} (try --help)`);
  }
  return { wandererCount };
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function killAll() {
  for (const c of children) {
    try {
      if (!c.killed) c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

function forwardSignal(sig) {
  process.on(sig, () => {
    killAll();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

forwardSignal("SIGINT");
forwardSignal("SIGTERM");

function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (err) => {
    console.error(`[demo] failed to start ${label}:`, err);
    killAll();
    process.exit(1);
  });
  children.push(child);
  return child;
}

async function waitUntilReady(url, label, maxMs = 120_000) {
  const start = Date.now();
  let lastLog = 0;
  let lastStatus = "connect error";
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.info(`[demo] ${label} ready: ${url}`);
        return;
      }
      lastStatus =
        r.status === 503
          ? `HTTP 503 (combined server still starting — registry/MCP not ready yet)`
          : `HTTP ${r.status}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      const cause = e instanceof Error && "cause" in e ? e.cause : undefined;
      const causeCode =
        cause && typeof cause === "object" && "code" in cause
          ? String(/** @type {{ code?: unknown }} */ (cause).code ?? "")
          : "";
      const causeMsg = cause instanceof Error ? cause.message : cause != null ? String(cause) : "";
      const combined = `${msg}${causeMsg ? ` (${causeMsg}` : ""}${causeCode ? ` [${causeCode}]` : ""}${causeMsg ? ")" : ""}`;
      lastStatus = /refused|ECONNREFUSED/i.test(combined) || causeCode === "ECONNREFUSED"
        ? `connection refused (nothing on :${httpPort} yet — normal for a few seconds after spawn)`
        : combined;
    }
    const now = Date.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      console.info(`[demo] still waiting for ${url} — ${lastStatus}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[demo] timeout waiting for ${label} (${url}) — last: ${lastStatus}`);
}

async function waitForHouseAndAgent() {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const start = Date.now();
  const maxMs = 60_000;
  while (Date.now() - start < maxMs) {
    let houseOk = false;
    let agentOk = false;
    let npcAgentOk = false;
    try {
      const c = await fetch(`http://127.0.0.1:${housePort}/v1/catalog`, {
        headers: { ...auth },
      });
      houseOk = c.ok;
    } catch {
      /* retry */
    }
    try {
      const a = await fetch(`http://127.0.0.1:${agentPort}/.well-known/agent-card.json`);
      agentOk = a.ok;
    } catch {
      /* retry */
    }
    try {
      const n = await fetch(`http://127.0.0.1:${npcAgentPort}/.well-known/agent-card.json`);
      npcAgentOk = n.ok;
    } catch {
      /* retry */
    }
    if (houseOk && agentOk && npcAgentOk) {
      console.info(
        `[demo] agent-host :${housePort}, random-agent :${agentPort}, npc-agent :${npcAgentPort} responding.`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(
    "[demo] timeout waiting for agent-host + agents; continue anyway (check AGENT_HOST_PORT / AGENT_PORT / NPC_AGENT_PORT in root .env).",
  );
}


function waitFirstExit() {
  return Promise.race(
    children.map(
      (p) =>
        new Promise((resolve) => {
          p.once("exit", (code, signal) => resolve({ code, signal }));
        }),
    ),
  );
}

try {
  const { wandererCount } = parseDemoArgv(process.argv.slice(2));
  console.info(`[demo] --ghosts ${wandererCount} (wanderers per session via RANDOM_AGENT_COUNT)`);
  console.info(
    "[demo] --- If you never see [demo] lines you are not running `pnpm run demo` (e.g. you used `pnpm run server` instead). ---",
  );
  console.info(
    "[demo] 1/3 building @aie-matrix/server (tsc --build so the child can skip a second compile)…",
  );
  execSync("pnpm exec tsc --build tsconfig.json", {
    cwd: serverRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
  console.info(
    "[demo] 1/3 starting combined server via start:dist — Colyseus + world API output follows…",
  );
  // AIE_MATRIX_MODE=development activates the local file-backed MapManagement and
  // LiveSession implementations so map-editor's admin panel sees the same map that
  // Intermedium renders, without requiring Neo4j or GCS.
  start("server", "pnpm", ["--filter", "@aie-matrix/server", "run", "start:dist"], {
    AIE_MATRIX_MODE: process.env.AIE_MATRIX_MODE ?? "development",
  });

  console.info("[demo] 2/3 waiting for " + readyUrl + "…");
  await waitUntilReady(readyUrl, "world server");

  // Start all remaining services in parallel once the world server is up.
  // The Vite front-ends receive VITE_ env vars so they point at the local stack
  // even when no .env.local files exist (fresh clone scenario).
  const viteEnv = {
    VITE_API_BASE_URL: `http://127.0.0.1:${httpPort}`,
    VITE_AGENT_HOST_URL: `http://127.0.0.1:${housePort}`,
    // Note: an existing .env.local in tools/map-editor/ takes precedence over these.
    // VITE_ADMIN_TOKEN authenticates world-API write ops (publish map, start/end session).
    // VITE_AGENT_HOST_BEARER authenticates agent-host ops (catalog, spawn, shutdown).
    // These are two distinct tokens — do not mix them up.
    ...(adminToken ? { VITE_ADMIN_TOKEN: adminToken } : {}),
    ...(token ? { VITE_AGENT_HOST_BEARER: token } : {}),
  };

  console.info("[demo] 3/3 starting agent-host, random-agent, npc-agent, intermedium, map-editor…");
  start("agent-host",  "pnpm", ["--filter", "@aie-matrix/server-agent-host", "dev"]);
  start("random-agent","pnpm", ["--filter", "@aie-matrix/random-agent",      "dev"], {
    RANDOM_AGENT_COUNT: String(wandererCount),
  });
  start("npc-agent",   "pnpm", ["--filter", "@aie-matrix/npc-agent",         "dev"], {
    AGENT_PORT: npcAgentPort,
    AGENT_HOST_URL: houseBase,
  });
  start("intermedium", "pnpm", ["--filter", "@aie-matrix/intermedium",        "dev"], viteEnv);
  start("map-editor",  "pnpm", ["--filter", "@aie-matrix/map-editor",         "dev"], viteEnv);

  await waitForHouseAndAgent();

  console.info(`
[demo] ✓ Full stack running — Ctrl+C to stop all processes.

  Spectator (Intermedium)  →  http://127.0.0.1:${intermediumPort}/
  Admin UI  (Map Editor)   →  http://127.0.0.1:${mapEditorPort}/
  World API                →  http://127.0.0.1:${httpPort}/
  Agent Host               →  http://127.0.0.1:${housePort}/v1/catalog
  NPC Agent                →  http://127.0.0.1:${npcAgentPort}/

  The Vite front-ends compile on first load — allow a few seconds after opening.
  Open the Map Editor Admin panel, select a map, and activate a session.
  Ghosts (${wandererCount} wanderers + NPC characters) spawn automatically when the session starts.
`);

  const { code, signal } = await waitFirstExit();
  killAll();
  if (signal) {
    process.exit(1);
  }
  process.exit(typeof code === "number" && code !== null ? code : 0);
} catch (e) {
  console.error(e);
  killAll();
  process.exit(1);
}
