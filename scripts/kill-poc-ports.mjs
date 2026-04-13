#!/usr/bin/env node
/**
 * List (default) or stop processes listening on well-known PoC TCP ports.
 * Uses `lsof` (macOS / Linux) — identify by port, not by matching "node" in argv
 * (avoids killing unrelated tools).
 *
 * Usage:
 *   node scripts/kill-poc-ports.mjs           # print listeners on 8787, 5174, 5179
 *   node scripts/kill-poc-ports.mjs --kill   # SIGTERM those listeners
 *   node scripts/kill-poc-ports.mjs --kill --force   # SIGKILL
 */
import { execSync } from "node:child_process";
import process from "node:process";

/** Default HTTP + Colyseus; Vite dev; Vite preview (e2e). Override: PORTS=3000,4000 node ... */
const DEFAULT_PORTS = [8787, 5174, 5179];

function parsePorts() {
  const raw = process.env.PORTS?.trim();
  if (!raw) return DEFAULT_PORTS;
  return raw
    .split(/[\s,]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}

function lsofRows(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim().split("\n").slice(1);
  } catch {
    return [];
  }
}

function parsePid(line) {
  const parts = line.trim().split(/\s+/);
  const pid = Number.parseInt(parts[1], 10);
  return Number.isFinite(pid) ? pid : null;
}

function collectListeners(ports) {
  /** @type {Map<number, { port: number; lines: string[] }>} */
  const byPid = new Map();
  for (const port of ports) {
    for (const line of lsofRows(port)) {
      const pid = parsePid(line);
      if (pid == null || pid === process.pid) continue;
      const cur = byPid.get(pid) ?? { port, lines: [] };
      cur.lines.push(line);
      byPid.set(pid, cur);
    }
  }
  return byPid;
}

const ports = parsePorts();
const kill = process.argv.includes("--kill");
const force = process.argv.includes("--force");
const byPid = collectListeners(ports);

if (byPid.size === 0) {
  console.info(`[kill-poc-ports] no listeners on ports: ${ports.join(", ")}`);
  process.exit(0);
}

console.info(`[kill-poc-ports] listeners (ports ${ports.join(", ")}):\n`);
for (const [, { lines }] of byPid) {
  for (const line of lines) console.info(line);
}

if (!kill) {
  console.info("\n[kill-poc-ports] dry-run. Re-run with --kill to SIGTERM, or add --force for SIGKILL.");
  process.exit(0);
}

const signal = force ? "SIGKILL" : "SIGTERM";
let n = 0;
for (const pid of byPid.keys()) {
  try {
    process.kill(pid, signal);
    n += 1;
    console.info(`[kill-poc-ports] sent ${signal} to pid ${pid}`);
  } catch (e) {
    console.warn(`[kill-poc-ports] pid ${pid}: ${/** @type {Error} */ (e).message}`);
  }
}
console.info(`[kill-poc-ports] done (${n} process(es)).`);
