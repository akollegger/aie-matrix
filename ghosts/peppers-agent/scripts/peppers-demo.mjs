#!/usr/bin/env node
/**
 * Layer peppers-agent on top of a running `pnpm run demo` session.
 *
 * Run `pnpm run demo` first (server + spectator + ghost-house + random-agent),
 * then in a second terminal:
 *
 *   pnpm run peppers:demo [--ghosts N]   (default 2)
 *
 * What this script does:
 *   1. Starts the peppers-agent A2A server (default port 4002)
 *   2. Waits for ghost-house (4000) and peppers-agent (4002) to respond
 *   3. Registers peppers-agent with ghost-house's catalog
 *   4. For each ghost: creates a registry house + caretaker, adopts a ghost,
 *      then asks ghost-house to spawn peppers-agent for that ghost
 *
 * Required env (in repo root .env):
 *   AGENT_HOST_TOKEN   shared bearer token (must match ghost-house)
 *   OPENAI_API_KEY          drives Id + Surface LLM calls
 *   GHOST_MINDS_NEO4J_URI   Neo4j for cascade persistence
 *   GHOST_MINDS_NEO4J_USERNAME
 *   GHOST_MINDS_NEO4J_PASSWORD
 *
 * Optional env:
 *   PEPPERS_AGENT_PORT      default 4002
 *   AGENT_HOST_PORT        default 4000
 *   AIE_MATRIX_HTTP_PORT    default 8787
 *   PEPPERS_GHOSTS          default ghost count when --ghosts not passed
 *   PEPPERS_VERBOSE         set "1" for full prompt/response logging
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@aie-matrix/root-env";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

// Stable 32-bit FNV-1a hash so the same ghostId always resolves to the
// same name across restarts — handy for cross-session log archaeology.
function hashSeed(input) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function generateGhostName(seedKey) {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: " ",
    style: "capital",
    length: 3,
    seed: hashSeed(seedKey),
  });
}

loadRootEnv();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const peppersPort = process.env.PEPPERS_AGENT_PORT || "4002";
const housePort   = process.env.AGENT_HOST_PORT   || "4000";
const httpPort    = process.env.AIE_MATRIX_HTTP_PORT || "8787";
const houseBase   = `http://127.0.0.1:${housePort}`;
const worldBase   = `http://127.0.0.1:${httpPort}`;
const token       = process.env.AGENT_HOST_TOKEN || "";

const MAX_GHOSTS = 16;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  let ghostCount = Number(process.env.PEPPERS_GHOSTS || "2");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "-h" || a === "--help") {
      console.log(
        "Usage: pnpm run peppers:demo [--ghosts N]\n\n" +
        "  Starts peppers-agent and bootstraps N peppers ghosts into the world.\n" +
        "  Run `pnpm run demo` first.\n",
      );
      process.exit(0);
    }
    if (a.startsWith("--ghosts=")) {
      ghostCount = Math.min(MAX_GHOSTS, parseInt(a.slice("--ghosts=".length), 10) || 2);
      continue;
    }
    if (a === "--ghosts" || a === "-n") {
      ghostCount = Math.min(MAX_GHOSTS, parseInt(argv[++i] || "2", 10) || 2);
      continue;
    }
  }
  return ghostCount;
}

const ghostCount = parseArgv(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function killAll() {
  for (const c of children) {
    try { if (!c.killed) c.kill("SIGTERM"); } catch { /* ignore */ }
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { killAll(); process.exit(sig === "SIGINT" ? 130 : 143); });
}

function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (err) => {
    console.error(`[peppers-demo] failed to start ${label}:`, err.message);
    killAll();
    process.exit(1);
  });
  children.push(child);
  return child;
}

// ---------------------------------------------------------------------------
// Readiness polling
// ---------------------------------------------------------------------------

async function poll(url, label, opts = {}) {
  const maxMs = opts.maxMs ?? 60_000;
  const auth  = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
  const deadline = Date.now() + maxMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers: auth });
      if (r.ok) {
        console.info(`[peppers-demo] ${label} ready`);
        return;
      }
    } catch { /* retry */ }
    if (Date.now() - lastLog > 4000) {
      console.info(`[peppers-demo] waiting for ${label}…`);
      lastLog = Date.now();
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.warn(`[peppers-demo] timeout waiting for ${label} — continuing anyway`);
}

// ---------------------------------------------------------------------------
// Bootstrap: register → house → caretakers → adopt → spawn
// ---------------------------------------------------------------------------

async function bootstrap() {
  if (!token) {
    console.warn(
      "[peppers-demo] AGENT_HOST_TOKEN not set — skipping bootstrap. " +
      "Add it to repo root .env to put ghosts in-world.",
    );
    return;
  }

  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Register peppers-agent with ghost-house (409 = already registered, fine)
  const reg = await fetch(`${houseBase}/v1/catalog/register`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ agentId: "peppers-agent", baseUrl: `http://127.0.0.1:${peppersPort}` }),
  });
  if (reg.status === 409) {
    console.info("[peppers-demo] catalog: peppers-agent already registered — continuing.");
  } else if (!reg.ok) {
    console.error("[peppers-demo] catalog register failed:", reg.status, await reg.text());
    return;
  } else {
    console.info("[peppers-demo] catalog: peppers-agent registered.");
  }

  // One registry house for all peppers ghosts in this session
  const hr = await fetch(`${worldBase}/registry/houses`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "peppers-demo-house" }),
  });
  if (!hr.ok) {
    console.error("[peppers-demo] registry house failed:", hr.status, await hr.text());
    return;
  }
  const { agentHostId } = await hr.json();

  for (let i = 0; i < ghostCount; i++) {
    const cr = await fetch(`${worldBase}/registry/caretakers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: `peppers-${i + 1}` }),
    });
    if (!cr.ok) {
      console.error(`[peppers-demo] caretaker ${i + 1} failed:`, cr.status, await cr.text());
      return;
    }
    const { caretakerId } = await cr.json();

    // Generate the displayName from the caretakerId so we have it BEFORE
    // adopt. The adopt route persists it onto the registry's ghost
    // record, which is what peer ghosts query via name-resolver.ts.
    // Without this, peers fall back to `ghost_<hex>` when referring to
    // each other and the cascade prose looks like database output.
    const displayName = generateGhostName(caretakerId);

    const ar = await fetch(`${worldBase}/registry/adopt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caretakerId, agentHostId, displayName }),
    });
    if (!ar.ok) {
      console.error(`[peppers-demo] adopt ${i + 1} failed:`, ar.status, await ar.text());
      return;
    }
    const adopt = await ar.json();

    const sp = await fetch(`${houseBase}/v1/sessions/spawn/peppers-agent`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        ghostId: adopt.ghostId,
        credential: adopt.credential,
        displayName,
      }),
    });
    if (!sp.ok) {
      console.error(`[peppers-demo] spawn ${i + 1} failed:`, sp.status, await sp.text());
      return;
    }
    const { sessionId } = await sp.json();
    console.info(
      `[peppers-demo] ghost ${i + 1}/${ghostCount}: ${displayName} ` +
      `(ghostId ${adopt.ghostId}, session ${sessionId}) — peppers loop starting.`,
    );
  }
}

function waitFirstExit() {
  return Promise.race(
    children.map(p => new Promise(resolve => p.once("exit", (code, signal) => resolve({ code, signal })))),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.info(`[peppers-demo] spawning ${ghostCount} peppers ghost(s). Run \`pnpm run demo\` first if not already.`);

if (!token) {
  console.warn("[peppers-demo] AGENT_HOST_TOKEN not set — agent will start but no ghosts will be bootstrapped.");
}

console.info(`[peppers-demo] starting peppers-agent A2A server on port ${peppersPort}…`);
start("peppers-agent", "pnpm", ["--filter", "@aie-matrix/ghost-peppers-agent", "dev"], {
  PEPPERS_AGENT_PORT: peppersPort,
  // Bearing hint: which classes the substrate should auto-compute a
  // nearest-bearing for every cascade. For freeplay this is "Food" so
  // a hungry ghost has a direction to head when no food is in their
  // 7-cell view. The world's `tokens` field on the ItemType decides
  // whether something restores Fuel — this env var is navigation only.
  PEPPERS_BEARING_ITEM_CLASSES:
    process.env.PEPPERS_BEARING_ITEM_CLASSES ?? "Food",
  // Per-ghost overlay servers: base port 4100, ghosts get 4100..4105.
  // The aggregating hub at http://127.0.0.1:4100/all only runs when
  // PEPPERS_OVERLAY_PEER_PORTS lists more than one peer (so it knows
  // to fan in). Both must be set for the live spectator view.
  PEPPERS_OVERLAY_BASE_PORT: process.env.PEPPERS_OVERLAY_BASE_PORT ?? "4100",
  PEPPERS_OVERLAY_PEER_PORTS:
    process.env.PEPPERS_OVERLAY_PEER_PORTS ?? "4100,4101,4102,4103,4104,4105",
});

await poll(`http://127.0.0.1:${housePort}/v1/catalog`,                       "ghost-house",    { token, maxMs: 30_000 });
await poll(`http://127.0.0.1:${peppersPort}/.well-known/agent-card.json`,    "peppers-agent",  { maxMs: 30_000 });

await bootstrap();

console.info(
  "[peppers-demo] all ghosts spawned. Spectator: http://127.0.0.1:5174/  Ctrl+C to stop.",
);

const { code, signal } = await waitFirstExit();
killAll();
process.exit(signal ? 1 : (typeof code === "number" ? code : 0));
