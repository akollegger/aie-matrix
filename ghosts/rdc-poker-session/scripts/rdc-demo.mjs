#!/usr/bin/env node
/**
 * Red Dead Convention end-to-end demo driver (RFC-0019 Barnacle Protocol).
 *
 *   pnpm run rdc:demo [--ghosts N]   (default 4)
 *
 * Layer this on top of a running `pnpm run demo` session (server +
 * spectator + ghost-house). In a second terminal:
 *
 *   pnpm run rdc:demo
 *
 * What it does:
 *   1. Sanity-check ghost-house + world server are up.
 *   2. Start peppers-agent (shared A2A server, port 4002) — runs the
 *      social cascade for every RDC ghost.
 *   3. Start one rdc-poker-session process (Barnacle mini-game host,
 *      port 4012) bound to the PokerTable cell in freeplay.map.gram.
 *   4. Register peppers-agent in ghost-house's catalog (as agent).
 *   5. Register rdc-poker-session in ghost-house's catalog (as mini-game
 *      claiming `PokerTable`).
 *   6. Create N ghosts: house → caretakers → adopt → spawn peppers-agent.
 *
 * From here ghost-house's Barnacle encounter trigger (on by default
 * since phase 5b.2c) watches Colyseus; when a ghost steps onto a cell
 * adjacent to the PokerTable, it sends `platform.encounter.v1` to
 * peppers; on accept, the supervisor withdraws the ghost from the
 * world, pauses peppers, hands off to rdc-poker-session; the session's
 * auto-loop deals hands; on "leave" the session sends BarnacleComplete
 * back; the supervisor respawns the ghost and resumes peppers.
 *
 * Required env (in repo root .env):
 *   AGENT_HOST_TOKEN, OPENAI_API_KEY,
 *   GHOST_MINDS_NEO4J_URI, GHOST_MINDS_NEO4J_USERNAME, GHOST_MINDS_NEO4J_PASSWORD
 *
 * Optional env:
 *   RDC_GHOSTS               number of ghosts (default 4)
 *   RDC_PLATFORM_ID          override saloon cell (default PokerTable:8f283082aa20cb0)
 *   RDC_BUY_IN               buy-in per player (default 100)
 *   RDC_LEDGER_PATH          file-backed ledger persistence path
 *   RDC_PERSIST_MEMORY       "1" to write hand summaries to Neo4j
 *   PEPPERS_AGENT_PORT       default 4002
 *   RDC_SESSION_PORT         default 4012
 *   AGENT_HOST_PORT         default 4000
 *   AIE_MATRIX_HTTP_PORT     default 8787
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const peppersPort = Number(process.env.PEPPERS_AGENT_PORT ?? 4002);
const sessionPort = Number(process.env.RDC_SESSION_PORT ?? 4012);
const housePort = Number(process.env.AGENT_HOST_PORT ?? 4000);
const httpPort = Number(process.env.AIE_MATRIX_HTTP_PORT ?? 8787);
const buyIn = Number(process.env.RDC_BUY_IN ?? 100);

const houseBase = `http://127.0.0.1:${housePort}`;
const worldBase = `http://127.0.0.1:${httpPort}`;
const peppersBase = `http://127.0.0.1:${peppersPort}`;
const sessionBase = `http://127.0.0.1:${sessionPort}`;

const devToken = process.env.AGENT_HOST_TOKEN;
if (!devToken) {
  console.error("[rdc-demo] AGENT_HOST_TOKEN must be set in .env");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("[rdc-demo] OPENAI_API_KEY must be set in .env (poker brain needs it)");
  process.exit(1);
}

// The PokerTable cell in freeplay.map.gram. Override via env if the map changes.
const platformId =
  process.env.RDC_PLATFORM_ID?.trim() || "PokerTable:8f283082aa20cb0";

// CLI -----------------------------------------------------------------
function parseGhostCount(argv) {
  let n = Number(process.env.RDC_GHOSTS ?? 4);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(
        "Usage: pnpm run rdc:demo [--ghosts N]\n\n" +
          "  Run `pnpm run demo` first (server + spectator + ghost-house).\n" +
          "  Then this script spawns peppers-agent + one rdc-poker-session +\n" +
          "  N RDC ghosts. Barnacle encounter trigger (default-on) handles\n" +
          "  saloon arrivals automatically.\n",
      );
      process.exit(0);
    }
    if (a.startsWith("--ghosts=")) n = parseInt(a.slice("--ghosts=".length), 10) || n;
    else if (a === "--ghosts" || a === "-n") n = parseInt(argv[++i] || `${n}`, 10) || n;
  }
  // Cap matches the NAMES roster so every spawn gets a unique
  // persistent identity. Bump both together if you need more.
  return Math.max(1, Math.min(50, n));
}
const ghostCount = parseGhostCount(process.argv.slice(2));

// Process management --------------------------------------------------
const children = [];
const heldPorts = new Set();

function killAll() {
  for (const c of children) {
    if (c.killed || c.pid == null) continue;
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      try {
        c.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
  if (heldPorts.size > 0) {
    try {
      const ports = [...heldPorts].join(",");
      const out = spawnSync("lsof", ["-ti", ports], { encoding: "utf8" });
      const pids = (out.stdout || "").trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {
          /* ignore */
        }
      }
      setTimeout(() => {
        for (const pid of pids) {
          try {
            process.kill(Number(pid), 0);
          } catch {
            continue;
          }
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }, 300).unref();
    } catch {
      /* lsof not available */
    }
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    killAll();
    setTimeout(() => process.exit(sig === "SIGINT" ? 130 : 143), 400).unref();
  });
}
process.on("exit", () => killAll());

function start(label, command, args, env, options = {}) {
  if (typeof options.port === "number") heldPorts.add(options.port);
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env },
    detached: true,
  });
  child.on("error", (err) => {
    console.error(`[rdc-demo] failed to start ${label}:`, err);
    killAll();
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal !== null && signal !== "SIGTERM") {
      console.warn(`[rdc-demo] ${label} exited with signal ${signal}`);
    } else if (code !== null && code !== 0 && code !== 143) {
      console.warn(`[rdc-demo] ${label} exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

async function ensurePortFree(port, label) {
  await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} (${label}) already in use — run \`lsof -ti:${port} | xargs kill -9\` ` +
              `or stop the previous rdc:demo`,
          ),
        );
      } else {
        reject(err);
      }
    });
    srv.once("listening", () => {
      srv.close(() => resolve());
    });
    srv.listen(port, "127.0.0.1");
  });
}

async function waitFor(url, label, { token, timeoutMs = 60_000 } = {}) {
  const startedAt = Date.now();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) {
        console.info(`[rdc-demo] ${label} ready`);
        return;
      }
    } catch {
      /* retry */
    }
    await delay(400);
  }
  throw new Error(`[rdc-demo] timeout waiting for ${label} at ${url}`);
}

async function postJson(url, body, { authToken } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (r.status === 409) return { _conflict: true };
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST ${url} → ${r.status} ${r.statusText}: ${text}`);
  }
  return r.json();
}

// Roster --------------------------------------------------------------
const ROLES = ["outlaw", "outlaw", "outlaw", "marshall"];
// Western roster — kept comfortably > the default --ghosts cap (16)
// AND > 30 for stress runs so every spawn gets a unique name. Adding
// duplicates would let two ghosts share a persistent identity, which
// breaks the "each ghost is their name" contract for the chat panel
// and the poker table label.
const NAMES = [
  "The Man with No Label", "Clint Edgewood", "Rooster Nodeburn",
  "The Outlaw Josey Walks", "High Plains Walker", "Hopalong Cypherty",
  "The Lone Traverser", "Yul B-Tree", "Django Decypher", "Tuco Acyclica",
  "Wyatt Hash", "Doc Hopliday", "Pat Garrettraverse", "Butch Cypherty",
  "The Sundance Cypher", "Calamity Cypher", "Annie Adjacency",
  "Belle Subgraph", "Jesse Joins", "Bass Reeb", "Pancho Vertilla",
  "Joaquin Merge", "Bat Matchrelation", "Curly Bipartite", "Tom Hornedge",
  "Stagecoach Cardinality", "John Wesley Hashin'", "Cole Adjacent",
  "Ned Edgy", "Tex Vertex", "Sheriff Hashbrown", "Marshal Hops",
  "Sheriff D.A.G.", "Bart Dijkstra", "Edgewise Bill", "Slim Cypher",
  "Ringo Cycle", "Will Walker", "Cypher McCoy", "Wyatt Iso",
  "Sheriff Spanning Tree", "Walter Whitelist", "The Magnificent Vertex",
  "Aura Calhoun", "Bolt Brody", "Neo Foreigner", "Constraint Cassidy",
  "Index Calamity", "Property McCoy", "Label Lovelace", "Cypher Cassidy",
  "Aura Bandit",
];
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Main ----------------------------------------------------------------
async function main() {
  // 0. Stack readiness
  await waitFor(`${houseBase}/v1/catalog`, "ghost-house", {
    token: devToken,
    timeoutMs: 8_000,
  }).catch(() => {
    console.error(
      `[rdc-demo] ghost-house not reachable at ${houseBase}. Run \`pnpm run demo\` first.`,
    );
    process.exit(1);
  });
  await waitFor(`${worldBase}/spectator/room`, "world server", {
    timeoutMs: 8_000,
  }).catch(() => {
    console.error(
      `[rdc-demo] world server not reachable at ${worldBase}. Run \`pnpm run demo\` first.`,
    );
    process.exit(1);
  });

  try {
    await ensurePortFree(peppersPort, "peppers-agent");
    await ensurePortFree(sessionPort, "rdc-poker-session");
  } catch (err) {
    console.error(`[rdc-demo] ${err.message}`);
    process.exit(1);
  }

  // 1. peppers-agent (shared A2A server for all RDC ghosts)
  // Per-ghost cascade overlay enabled by default at 4100, 4101, 4102…
  // Each spawn allocates the next free port; URLs are logged when
  // assigned. God's-eye hub at http://127.0.0.1:<basePort>/all iframes
  // every ghost. Disable with PEPPERS_OVERLAY_BASE_PORT=0 (or unset).
  const overlayBasePort = Number(process.env.PEPPERS_OVERLAY_BASE_PORT ?? 4100);
  const overlayPeerPorts =
    overlayBasePort > 0
      ? Array.from({ length: ghostCount }, (_, i) => overlayBasePort + i).join(",")
      : "";
  console.info(`[rdc-demo] starting peppers-agent on :${peppersPort} (overlays from :${overlayBasePort}, hub at http://127.0.0.1:${overlayBasePort}/all) …`);
  start(
    "peppers-agent",
    "node",
    ["--import", "tsx", "src/agent.ts"],
    {
      PEPPERS_AGENT_PORT: String(peppersPort),
      PEPPERS_OVERLAY_BASE_PORT: overlayBasePort > 0 ? String(overlayBasePort) : "",
      PEPPERS_OVERLAY_PEER_PORTS: overlayPeerPorts,
      // Wild West / RDC objective. Replaces the default "make friends"
      // objective so ghosts actively *want* to find the saloon and
      // play poker — not just notice it sitting at the edge of their
      // look-around. Social play is still encouraged but framed as
      // part of the wandering, not the goal.
      PEPPERS_OBJECTIVE:
        process.env.PEPPERS_OBJECTIVE ??
        "You are a drifter in a dust-blown Wild West convention. There is a poker saloon nearby — Black Bart's — where the cards are real and Cyphers (the saloon's in-world token; no real-world value) change hands every hand. Your aim is to win Cyphers: the simplest way is to sit at a poker table and play; you can also pick up stories, trade favours, and make allies along the way. When you see a PokerTable in your look-around, head for it. When another ghost is nearby, swap a few words first — names, plans, where they're heading. Don't be the one left with the fewest Cyphers.",
    },
    { cwd: path.join(root, "ghosts", "peppers-agent"), port: peppersPort },
  );

  // 2. rdc-poker-session (Barnacle mini-game host for the saloon)
  console.info(
    `[rdc-demo] starting rdc-poker-session on :${sessionPort} (platform ${platformId}) …`,
  );
  start(
    "rdc-poker-session",
    "node",
    ["--import", "tsx", "src/agent.ts"],
    {
      RDC_AGENT_PORT: String(sessionPort),
      RDC_AGENT_PUBLIC_BASE_URL: sessionBase,
      RDC_PLATFORM_ID: platformId,
      RDC_PLATFORM_CLASS: "PokerTable",
      RDC_BUY_IN: String(buyIn),
      RDC_CAPACITY: process.env.RDC_CAPACITY ?? "6",
      RDC_MIN_PLAYERS: process.env.RDC_MIN_PLAYERS ?? "2",
      RDC_SMALL_BLIND: process.env.RDC_SMALL_BLIND ?? "1",
      RDC_BIG_BLIND: process.env.RDC_BIG_BLIND ?? "2",
      RDC_SETTING:
        process.env.RDC_SETTING ?? "Black Bart's saloon, back room",
    },
    { cwd: path.join(root, "ghosts", "rdc-poker-session"), port: sessionPort },
  );

  // 3. Wait for both to be ready
  await waitFor(
    `${peppersBase}/.well-known/agent-card.json`,
    "peppers-agent",
    { timeoutMs: 60_000 },
  );
  await waitFor(
    `${sessionBase}/.well-known/agent-card.json`,
    "rdc-poker-session",
    { timeoutMs: 60_000 },
  );

  // 4. Register peppers-agent in catalog
  console.info(`[rdc-demo] registering peppers-agent in ghost-house catalog …`);
  const peppersReg = await postJson(
    `${houseBase}/v1/catalog/register`,
    { agentId: "peppers-agent", baseUrl: peppersBase },
    { authToken: devToken },
  );
  if (peppersReg._conflict) {
    console.info("[rdc-demo] peppers-agent already registered — continuing.");
  }

  // 5. Register rdc-poker-session as mini-game claiming PokerTable
  console.info(
    `[rdc-demo] registering rdc-poker-session as mini-game (claims PokerTable) …`,
  );
  const miniReg = await postJson(
    `${houseBase}/v1/catalog/register-mini-game`,
    {
      agentId: "rdc-poker-session",
      baseUrl: sessionBase,
      platformClasses: ["PokerTable"],
      about: "Texas Hold'em saloon — Barnacle Protocol mini-game.",
    },
    { authToken: devToken },
  );
  if (miniReg._conflict) {
    console.info(
      "[rdc-demo] rdc-poker-session already registered — continuing.",
    );
  }

  // 6. Adopt + spawn N ghosts under peppers-agent
  console.info(`[rdc-demo] creating registry house + ${ghostCount} ghost(s) …`);
  const houseRes = await postJson(
    `${worldBase}/registry/houses`,
    { displayName: "rdc-demo-house" },
  );
  const { agentHostId } = houseRes;

  const shuffledNames = shuffle(NAMES);
  for (let i = 0; i < ghostCount; i++) {
    const displayName = shuffledNames[i % shuffledNames.length];
    const role = ROLES[i % ROLES.length];

    const { caretakerId } = await postJson(
      `${worldBase}/registry/caretakers`,
      { label: `rdc-${i + 1}` },
    );
    const adopt = await postJson(
      `${worldBase}/registry/adopt`,
      { caretakerId, agentHostId, displayName },
    );
    const spawn = await postJson(
      `${houseBase}/v1/sessions/spawn/peppers-agent`,
      {
        ghostId: adopt.ghostId,
        credential: adopt.credential,
        // Persistent identity: the Western name flows into peppers
        // (overlay + cascade prompts) and through the Barnacle handoff
        // into the poker session, so the ghost is "Django Decypher"
        // both wandering and at the table.
        displayName,
      },
      { authToken: devToken },
    );

    console.info(
      `[rdc-demo] ghost ${i + 1}/${ghostCount}: ${displayName} (${role}) — ` +
        `session ${spawn.sessionId}, ghostId ${adopt.ghostId}`,
    );
  }

  console.info(
    `\n┌──────────────────────────────────────────────────────────────────┐\n` +
      `│  RDC demo live (Barnacle Protocol).\n` +
      `│  Spectator (world map): http://127.0.0.1:5174/\n` +
      `│  Platform: ${platformId}\n` +
      `│  ${ghostCount} ghost(s) wandering. Ghost-house's encounter trigger\n` +
      `│  will dispatch when one steps adjacent to the saloon; on accept,\n` +
      `│  supervisor hands off to rdc-poker-session, hands deal automatically.\n` +
      `└──────────────────────────────────────────────────────────────────┘\n`,
  );

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`[rdc-demo] fatal:`, err);
  killAll();
  process.exit(1);
});
