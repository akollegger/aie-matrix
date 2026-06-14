#!/usr/bin/env node
/**
 * List and interactively stop processes on well-known aie-matrix ports.
 * Uses `lsof` (macOS / Linux) — identifies by port, not by process name.
 *
 * Usage:
 *   node scripts/kill-poc-ports.mjs            # list listeners, prompt to kill
 *   node scripts/kill-poc-ports.mjs --yes      # skip confirmation (for scripts)
 *   node scripts/kill-poc-ports.mjs --force    # SIGKILL instead of SIGTERM
 *   PORTS=3000,9000 node scripts/kill-poc-ports.mjs   # override port list
 *
 * Also available as:
 *   pnpm stop   (from repo root)
 */
import { execSync } from "node:child_process";
import * as readline from "node:readline";
import process from "node:process";

const PORT_LABELS = {
  8787: "world-server (Colyseus + MCP)",
  4000: "agent-host",
  4001: "random-agent",
  4002: "peppers-agent",
  4004: "npc-agent",
  5180: "intermedium (Vite)",
  5182: "map-editor (Vite)",
  5183: "map-editor mock (Vite)",
};

const DEFAULT_PORTS = Object.keys(PORT_LABELS).map(Number);

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
    return out.trim().split("\n").slice(1).filter(Boolean);
  } catch {
    return [];
  }
}

function parseRow(line) {
  const parts = line.trim().split(/\s+/);
  return {
    command: parts[0] ?? "?",
    pid: Number.parseInt(parts[1] ?? "", 10),
    user: parts[2] ?? "?",
    raw: line,
  };
}

function collectListeners(ports) {
  /** @type {Map<number, { pid: number; command: string; ports: number[] }>} */
  const byPid = new Map();
  for (const port of ports) {
    for (const line of lsofRows(port)) {
      const { pid, command } = parseRow(line);
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      const cur = byPid.get(pid) ?? { pid, command, ports: [] };
      cur.ports.push(port);
      byPid.set(pid, cur);
    }
  }
  return byPid;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

const ports = parsePorts();
const skipConfirm = process.argv.includes("--yes");
const force = process.argv.includes("--force");
const byPid = collectListeners(ports);

if (byPid.size === 0) {
  console.info(`No listeners found on: ${ports.join(", ")}`);
  process.exit(0);
}

console.info("\naie-matrix processes found:\n");
const colW = [6, 8, 30, 40];
console.info(
  "  " +
  "PORT".padEnd(colW[0]) +
  "PID".padEnd(colW[1]) +
  "LABEL".padEnd(colW[2]) +
  "COMMAND",
);
console.info("  " + "-".repeat(colW[0] + colW[1] + colW[2] + colW[3]));
for (const { pid, command, ports: pids } of byPid.values()) {
  for (const port of pids) {
    const label = PORT_LABELS[port] ?? "";
    console.info(
      "  " +
      String(port).padEnd(colW[0]) +
      String(pid).padEnd(colW[1]) +
      label.padEnd(colW[2]) +
      command,
    );
  }
}
console.info();

let doKill = skipConfirm;
if (!skipConfirm) {
  if (!process.stdin.isTTY) {
    console.info("(Non-interactive stdin — use --yes to kill. Aborting.)");
    process.exit(0);
  }
  const answer = await prompt(`Kill ${byPid.size} process(es) with ${force ? "SIGKILL" : "SIGTERM"}? [y/N] `);
  doKill = /^y(es)?$/i.test(answer);
}

if (!doKill) {
  console.info("Aborted.");
  process.exit(0);
}

const signal = force ? "SIGKILL" : "SIGTERM";
let n = 0;
for (const { pid, command, ports: pids } of byPid.values()) {
  try {
    process.kill(pid, signal);
    n += 1;
    console.info(`  ${signal} → pid ${pid} (${command} on :${pids.join(",")})`);
  } catch (e) {
    console.warn(`  pid ${pid}: ${/** @type {Error} */ (e).message}`);
  }
}
console.info(`\nDone — sent ${signal} to ${n} process(es).`);
