#!/usr/bin/env node
/**
 * peppers-lab — one-command launcher for the full peppers experimentation
 * stack. Runs the combined world server (world-api + ghost-house +
 * intermedium + map-editor) AND the peppers ghosts demo from a single
 * terminal, with shared env wiring for food rain, primal need time-
 * compression, overlay ports, and the capture log.
 *
 * Usage:
 *   pnpm run lab [preset] [overrides...]
 *
 * Presets (see PRESETS table below for tunable values):
 *   baseline     - no food rain; pure mortality dynamics
 *   random-rain  - uniform random food drops across the map
 *   targeted     - feed the first N×fraction ghosts (A/B contrast) [default]
 *   abundance    - very frequent random food drops; most ghosts survive
 *
 * Overrides:
 *   --ghosts N        total ghosts to spawn
 *   --needs-rush N    PEPPERS_NEEDS_RUSH multiplier (compresses demo time)
 *   --rain N          uniform-random food rain interval ms (0 = off)
 *   --targeted N      targeted food rain interval ms (0 = off)
 *   --fraction F      fraction of ghosts fed in targeted mode (0..1)
 *   --no-clean        skip the kill-existing-processes step
 *   --quiet           suppress child output; only print lab notices + URLs
 *   --help, -h        this help
 *
 * Examples:
 *   pnpm run lab
 *   pnpm run lab targeted --ghosts 12 --fraction 0.3
 *   pnpm run lab abundance --ghosts 20
 *   pnpm run lab baseline --ghosts 6 --needs-rush 15
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ----------------------------------------------------------------------------
// Presets — edit here to add new scenarios. Each preset is a complete
// configuration; CLI overrides apply on top.
// ----------------------------------------------------------------------------
const PRESETS = {
  baseline: {
    ghosts: 6,
    needsRush: 15,
    rainInterval: 0,
    targetedInterval: 0,
    targetedFraction: 0.5,
  },
  "random-rain": {
    ghosts: 10,
    needsRush: 4,
    rainInterval: 2000,
    targetedInterval: 0,
    targetedFraction: 0.5,
  },
  targeted: {
    ghosts: 10,
    needsRush: 4,
    rainInterval: 0,
    targetedInterval: 1000,
    targetedFraction: 0.5,
  },
  abundance: {
    ghosts: 10,
    needsRush: 4,
    rainInterval: 500,
    targetedInterval: 0,
    targetedFraction: 0.5,
  },
};

const DEFAULT_PRESET = "targeted";

// ----------------------------------------------------------------------------
// CLI parsing
// ----------------------------------------------------------------------------
function printHelp() {
  console.info(`
peppers-lab — one-command launcher for the peppers stack

Usage:
  pnpm run lab [preset] [overrides...]

Presets:
  baseline      no food rain; pure mortality dynamics (6 ghosts, rush=15)
  random-rain   uniform random food drops every 2s (10 ghosts, rush=4)
  targeted      A/B contrast: feed first 50% at their tile (10 ghosts, rush=4) [default]
  abundance     very frequent random food, 0.5s (10 ghosts, rush=4)

Overrides:
  --ghosts N        total ghosts to spawn
  --needs-rush N    PEPPERS_NEEDS_RUSH (time-compression multiplier)
  --rain N          uniform-random food rain interval ms (0 = off)
  --targeted N      targeted food rain interval ms (0 = off)
  --fraction F      fraction of ghosts fed in targeted mode (0..1)
  --no-clean        skip the kill-existing-processes step
  --quiet           suppress child output
  --help, -h        this help

Examples:
  pnpm run lab
  pnpm run lab targeted --ghosts 12 --fraction 0.3
  pnpm run lab abundance --ghosts 20
  pnpm run lab baseline --ghosts 6
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let preset = DEFAULT_PRESET;
  const overrides = { clean: true, quiet: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    if (PRESETS[a] !== undefined) {
      preset = a;
      continue;
    }
    if (a === "--ghosts") {
      overrides.ghosts = parseInt(args[++i] ?? "", 10);
      if (!Number.isFinite(overrides.ghosts) || overrides.ghosts < 1) {
        die(`--ghosts requires a positive integer; got ${args[i]}`);
      }
      continue;
    }
    if (a === "--needs-rush") {
      overrides.needsRush = parseFloat(args[++i] ?? "");
      if (!Number.isFinite(overrides.needsRush) || overrides.needsRush <= 0) {
        die(`--needs-rush requires a positive number; got ${args[i]}`);
      }
      continue;
    }
    if (a === "--rain") {
      overrides.rainInterval = parseInt(args[++i] ?? "", 10);
      if (!Number.isFinite(overrides.rainInterval) || overrides.rainInterval < 0) {
        die(`--rain requires a non-negative integer (ms); got ${args[i]}`);
      }
      continue;
    }
    if (a === "--targeted") {
      overrides.targetedInterval = parseInt(args[++i] ?? "", 10);
      if (!Number.isFinite(overrides.targetedInterval) || overrides.targetedInterval < 0) {
        die(`--targeted requires a non-negative integer (ms); got ${args[i]}`);
      }
      continue;
    }
    if (a === "--fraction") {
      overrides.targetedFraction = parseFloat(args[++i] ?? "");
      if (!Number.isFinite(overrides.targetedFraction) || overrides.targetedFraction < 0 || overrides.targetedFraction > 1) {
        die(`--fraction requires a value in [0, 1]; got ${args[i]}`);
      }
      continue;
    }
    if (a === "--no-clean") {
      overrides.clean = false;
      continue;
    }
    if (a === "--quiet") {
      overrides.quiet = true;
      continue;
    }
    die(`unknown argument: ${a}\n(run with --help for usage)`);
  }
  return { preset, ...PRESETS[preset], ...overrides };
}

function die(msg) {
  console.error(`[peppers-lab] ${msg}`);
  process.exit(1);
}

const cfg = parseArgs(process.argv);

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------
console.info(`
[peppers-lab] preset=${cfg.preset}
[peppers-lab]   ghosts             = ${cfg.ghosts}
[peppers-lab]   PEPPERS_NEEDS_RUSH = ${cfg.needsRush}
[peppers-lab]   uniform food rain  = ${cfg.rainInterval > 0 ? `every ${cfg.rainInterval}ms (random tile)` : "off"}
[peppers-lab]   targeted food rain = ${cfg.targetedInterval > 0 ? `every ${cfg.targetedInterval}ms (first ${(cfg.targetedFraction * 100).toFixed(0)}% of ghosts)` : "off"}
`);

if (cfg.clean) {
  console.info("[peppers-lab] killing any existing aie-matrix processes...");
  // The peppers-agent A2A server runs as `node --import tsx src/agent.ts`
  // with no "aie-matrix" or "peppers-agent" string in its argv (the cwd
  // carries the package identity). Match it by the tsx src/agent.ts
  // suffix as well. Catch the world dist runner and the demo wrapper
  // too. Exclude OUR OWN PID and our parent PID so we don't kill the
  // very script running this cleanup.
  const selfPid = process.pid;
  const parentPid = process.ppid;
  spawnSync(
    "bash",
    [
      "-c",
      `ps aux | grep -E 'aie-matrix|peppers-agent|tsx src/(agent|main)|node dist/index\\.js|scripts/demo\\.mjs' | grep -v grep | grep -v Cursor | awk '{print $2}' | grep -v -w ${selfPid} | grep -v -w ${parentPid} | xargs -r kill -9 2>/dev/null`,
    ],
    { stdio: "ignore" },
  );
  // Give the OS a moment to release ports before we bind them.
  await new Promise((r) => setTimeout(r, 2000));
}

// Move any prior capture log aside, timestamped, so each run starts fresh.
const captureFile = path.join(repoRoot, "ghosts/peppers-agent/.local/peppers-cascades.jsonl");
if (existsSync(captureFile)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = captureFile.replace(".jsonl", `.${stamp}.jsonl`);
  try {
    renameSync(captureFile, backup);
    console.info(`[peppers-lab] previous capture → ${path.basename(backup)}`);
  } catch (err) {
    console.warn(`[peppers-lab] could not rotate capture log: ${err.message}`);
  }
}

// Spawn helpers + child registry
const children = [];

function start(label, cmd, args, env) {
  const stdio = cfg.quiet ? ["ignore", "ignore", "ignore"] : "inherit";
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    stdio,
    env: { ...process.env, ...env },
  });
  child.on("error", (err) => {
    console.error(`[peppers-lab] ${label} failed to start: ${err.message}`);
    shutdown(1);
  });
  child.on("exit", (code, sig) => {
    console.info(`[peppers-lab] ${label} exited (code=${code} sig=${sig})`);
  });
  children.push({ label, child });
  return child;
}

function shutdown(code = 0) {
  console.info("[peppers-lab] shutting down children...");
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 1500);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(sig === "SIGINT" ? 130 : 143));
}

// ----------------------------------------------------------------------------
// Stage 1: world stack
// ----------------------------------------------------------------------------
const worldEnv = {
  WORLD_FOOD_RAIN_INTERVAL_MS: String(cfg.rainInterval),
  WORLD_FOOD_TARGETED_INTERVAL_MS: String(cfg.targetedInterval),
  WORLD_FOOD_TARGETED_FRACTION: String(cfg.targetedFraction),
  WORLD_FOOD_RAIN_CLASS: "Food",
};
console.info("[peppers-lab] starting world stack (pnpm run demo)...");
start("world-stack", "pnpm", ["run", "demo"], worldEnv);

// Poll ghost-house catalog as the readiness signal.
const token = process.env.AGENT_HOST_TOKEN || "";
const houseUrl = "http://127.0.0.1:4000/v1/catalog";
const maxWaitMs = 120_000;
const startedAt = Date.now();
let ready = false;
console.info(`[peppers-lab] waiting for ghost-house at ${houseUrl} (timeout ${maxWaitMs / 1000}s)...`);
while (Date.now() - startedAt < maxWaitMs) {
  try {
    const r = await fetch(houseUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {
    /* not ready yet */
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!ready) {
  console.error("[peppers-lab] timed out waiting for ghost-house — aborting");
  shutdown(1);
  // The shutdown() timer will exit the process; abort the await below by throwing.
  throw new Error("ghost-house not ready");
}
console.info("[peppers-lab] ghost-house ready");

// ----------------------------------------------------------------------------
// Stage 2: peppers stack
// ----------------------------------------------------------------------------
const peppersEnv = {
  PEPPERS_NEEDS_RUSH: String(cfg.needsRush),
  PEPPERS_CAPTURE_LOG: ".local/peppers-cascades.jsonl",
  PEPPERS_IGNORED_ITEM_REFS: "PokerTable",
  PEPPERS_BEARING_ITEM_CLASSES: "Food",
  PEPPERS_OVERLAY_BASE_PORT: "4100",
  PEPPERS_OVERLAY_PEER_PORTS: Array.from({ length: cfg.ghosts }, (_, i) => 4100 + i).join(","),
};
console.info("[peppers-lab] starting peppers stack...");
start("peppers-stack", "pnpm", ["run", "peppers:demo", "--", "--ghosts", String(cfg.ghosts)], peppersEnv);

// ----------------------------------------------------------------------------
// Print URLs once everything's settled
// ----------------------------------------------------------------------------
setTimeout(() => {
  console.info(`
[peppers-lab] === Lab is running ===
[peppers-lab]   Overlay hub        http://127.0.0.1:4100/all
[peppers-lab]   Per-ghost overlays http://127.0.0.1:4100/  ...  http://127.0.0.1:${4100 + cfg.ghosts - 1}/
[peppers-lab]   Spectator UI       http://127.0.0.1:5180/      (deck.gl world view)
[peppers-lab]   Map Editor (admin) http://127.0.0.1:5182/
[peppers-lab]   Capture log        ${captureFile}
[peppers-lab]
[peppers-lab] Ctrl+C stops everything cleanly.
`);
}, 25_000);

// Keep the parent alive while any child runs; if all children exit, so do we.
await new Promise((resolve) => {
  const tick = setInterval(() => {
    const alive = children.some(({ child }) => child.exitCode === null && child.signalCode === null);
    if (!alive) {
      clearInterval(tick);
      resolve(undefined);
    }
  }, 1000);
});
console.info("[peppers-lab] all children exited; bye.");
