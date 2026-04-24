#!/usr/bin/env node
/**
 * One-terminal PoC: combined server → Vite spectator → ghost house → random-agent.
 * Ctrl+C stops all child processes.
 *
 * ## Required env (repo root `.env` — loaded by you / your shell; processes inherit)
 *
 * - `GHOST_HOUSE_DEV_TOKEN` — shared bearer (house + agent A2A).
 * - `AIE_MATRIX_HTTP_BASE_URL` (optional) — e.g. `http://127.0.0.1:8787` for the house Colyseus
 *   bridge. Session MCP uses `credential.worldApiBaseUrl` from registry /adopt after spawn, not
 *   a `WORLD_API_BASE_URL` env var.
 * - `GHOST_HOUSE_PORT` (optional) — default `4000`.
 * - `AGENT_PORT` (optional) — default `4001` for `random-agent`.
 * - `GHOST_HOUSE_URL` — e.g. `http://127.0.0.1:4000` (used by the agent; must match
 *   house port if you override `GHOST_HOUSE_PORT`).
 *
 * ## Startup order
 *
 * 1. `pnpm run server` — world + Colyseus + registry (HTTP `8787`, spectator meta).
 * 2. `pnpm run spectator` — Vite (default `5174`).
 * 3. `pnpm --filter @aie-matrix/ghost-house dev` — A2A + catalog.
 * 4. `pnpm --filter @aie-matrix/random-agent dev` — Wanderer card + endpoint.
 *
 * Optional: set `AIE_MATRIX_DEMO_AUTO_BOOTSTRAP=1` to register the agent, adopt a
 * ghost, and spawn a session (same HTTP flow as
 * `specs/009-ghost-house-a2a/quickstart.md` §5–7) so a wanderer may start moving
 * without extra shells. Otherwise follow that quickstart after the processes are up.
 *
 * Extra `argv` args are **not** forwarded; legacy random-house flags no longer apply.
 *
 * **Troubleshooting:** The output you described (only the `aie-matrix PoC listening` block) is
 * from `pnpm run server` alone. This script always prints lines beginning with `[demo]`
 * *before* the server’s Colyseus banner. From the repo root run: `pnpm run demo` (not `server`
 * or `dev` unless you intend only the combined server).
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");
const readyUrl = "http://127.0.0.1:8787/spectator/room";

const housePort = process.env.GHOST_HOUSE_PORT || "4000";
const agentPort = process.env.AGENT_PORT || "4001";
const houseBase =
  process.env.GHOST_HOUSE_URL || `http://127.0.0.1:${housePort}`;
const token = process.env.GHOST_HOUSE_DEV_TOKEN || "";
const worldBase = "http://127.0.0.1:8787";

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
  let lastLog = 0;
  let lastStatus = "connect error";
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.info(`[demo] ${label} ready: ${url}`);
        return;
      }
      lastStatus = `HTTP ${r.status}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      lastStatus = /refused|ECONNREFUSED/i.test(msg)
        ? "connection refused (nothing listening on 8787 yet — normal for a few seconds after spawn)"
        : msg;
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
    if (houseOk && agentOk) {
      console.info(`[demo] ghost house :${housePort} and random-agent :${agentPort} responding.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(
    "[demo] timeout waiting for house + agent; continue anyway (check GHOST_HOUSE_DEV_TOKEN and root .env).",
  );
}

/**
 * @returns {Promise<void>}
 */
async function autoBootstrap() {
  if (process.env.AIE_MATRIX_DEMO_AUTO_BOOTSTRAP !== "1") {
    console.info(
      "[demo] Optional: set AIE_MATRIX_DEMO_AUTO_BOOTSTRAP=1 to run catalog + registry + spawn (see quickstart §5–7).",
    );
    return;
  }
  if (!token) {
    console.error("[demo] AIE_MATRIX_DEMO_AUTO_BOOTSTRAP=1 requires GHOST_HOUSE_DEV_TOKEN in the environment.");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const reg = await fetch(`${houseBase}/v1/catalog/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      agentId: "random-agent",
      baseUrl: `http://127.0.0.1:${agentPort}`,
    }),
  });
  if (!reg.ok) {
    const t = await reg.text();
    console.error("[demo] catalog register failed:", reg.status, t);
    return;
  }
  console.info("[demo] catalog: random-agent registered.");

  const cr = await fetch(`${worldBase}/registry/caretakers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "demo" }),
  });
  if (!cr.ok) {
    console.error("[demo] registry caretaker failed:", cr.status, await cr.text());
    return;
  }
  const { caretakerId } = await cr.json();

  const gr = await fetch(`${worldBase}/registry/houses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "demo-house" }),
  });
  if (!gr.ok) {
    console.error("[demo] registry house failed:", gr.status, await gr.text());
    return;
  }
  const { ghostHouseId } = await gr.json();

  const ar = await fetch(`${worldBase}/registry/adopt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caretakerId, ghostHouseId }),
  });
  if (!ar.ok) {
    console.error("[demo] registry adopt failed:", ar.status, await ar.text());
    return;
  }
  const adopt = await ar.json();

  const sp = await fetch(`${houseBase}/v1/sessions/spawn/random-agent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ghostId: adopt.ghostId,
      credential: adopt.credential,
    }),
  });
  if (!sp.ok) {
    console.error("[demo] spawn failed:", sp.status, await sp.text());
    return;
  }
  const { sessionId } = await sp.json();
  console.info(`[demo] session ${sessionId} — wanderer may be moving.`);
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
  console.info(
    "[demo] --- If you never see [demo] lines, you are not running `pnpm run demo` (e.g. you used `pnpm run server` instead). ---",
  );
  console.info(
    "[demo] 1/5 building @aie-matrix/server in the parent (same as prestart: `tsc --build` so the child can skip a second tsc)…",
  );
  execSync("npx tsc --build tsconfig.json", {
    cwd: serverRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
  console.info(
    "[demo] 1/5 starting combined server via start:dist (no second tsc in the child) — Colyseus + aie-matrix output follows…",
  );
  start("server", "pnpm", ["--filter", "@aie-matrix/server", "run", "start:dist"]);

  console.info(
    "[demo] 2/5 waiting for GET " + readyUrl + " (then spectator + ghost house + random-agent start)…",
  );
  await waitUntilReady(readyUrl, "HTTP + spectator meta");

  console.info("[demo] 3/5 starting Phaser spectator (Vite — look for a Local: http://… URL)…");
  start("spectator", "pnpm", ["run", "spectator"]);

  console.info("[demo] 4/5 starting @aie-matrix/ghost-house (dev)…");
  start("ghost-house", "pnpm", ["--filter", "@aie-matrix/ghost-house", "dev"]);

  console.info("[demo] 5/5 starting @aie-matrix/random-agent (dev)…");
  start("random-agent", "pnpm", ["--filter", "@aie-matrix/random-agent", "dev"]);

  await waitForHouseAndAgent();
  await autoBootstrap();

  console.info(
    "[demo] all processes running. Vite (default http://127.0.0.1:5174/). Ctrl+C to stop.",
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
