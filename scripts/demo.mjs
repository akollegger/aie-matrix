#!/usr/bin/env node
/**
 * One-terminal PoC: combined server → Vite spectator → random-house.
 * Ctrl+C stops all child processes.
 *
 * Extra args after `--` are forwarded to `ghost-random-house start`, e.g.:
 *   pnpm run demo -- --ghosts 2
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readyUrl = "http://127.0.0.1:8787/spectator/room";

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

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
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
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.info(`[demo] ${label} ready: ${url}`);
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[demo] timeout waiting for ${label} (${url})`);
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
  console.info("[demo] starting combined server (pnpm run server)…");
  start("server", "pnpm", ["run", "server"]);

  await waitUntilReady(readyUrl, "HTTP + spectator meta");

  console.info("[demo] starting Phaser spectator (pnpm run spectator)…");
  start("spectator", "pnpm", ["run", "spectator"]);

  console.info("[demo] building + starting random-house…");
  execSync("pnpm --filter @aie-matrix/ghost-random-house build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });
  const ghostExtra = process.argv.slice(2);
  const ghostStart = ["--filter", "@aie-matrix/ghost-random-house", "start"];
  if (ghostExtra.length > 0) {
    ghostStart.push("--", ...ghostExtra);
  }
  start("ghost", "pnpm", ghostStart);

  console.info(
    "[demo] all processes running. Open the Vite Local URL (default http://127.0.0.1:5174/). Ctrl+C to stop.",
  );

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
