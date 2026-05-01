/**
 * CLI entry point: spin up one peppers ghost against a running combined
 * server. Defaults match `pnpm run demo`'s server URL.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-house run start
 */

import {
  samplePersonality,
  type PersonalityState,
} from "@aie-matrix/ghost-peppers-inner";

import { loadRootEnv } from "@aie-matrix/root-env";

import { runHouse } from "./run-house.js";
import { registerHouse } from "./runtime/index.js";

loadRootEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}; check .env at repo root`);
  return v;
}

const registryBase =
  process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787";

// Birth a personality with mild variation. Each run produces a
// meaningfully different ghost so the demo doesn't always converge on
// the same monastic register. Pass PEPPERS_BIRTH_SEED for reproducibility.
const seedEnv = process.env.PEPPERS_BIRTH_SEED;
const baseSeed = seedEnv ? Number(seedEnv) : Math.floor(Math.random() * 2 ** 31);

// PEPPERS_GHOSTS = how many parallel peppers ghosts to spawn in one
// process. Default 1. Capped at 16 so we don't accidentally fan out
// dozens of LLM-driven loops.
const ghostsEnv = process.env.PEPPERS_GHOSTS;
const ghostCount = ghostsEnv !== undefined && ghostsEnv !== "" ? Number(ghostsEnv) : 1;
if (!Number.isInteger(ghostCount) || ghostCount < 1 || ghostCount > 16) {
  throw new Error(
    `PEPPERS_GHOSTS must be an integer between 1 and 16; got ${ghostsEnv}`,
  );
}

const personalitiesAndSeeds: ReadonlyArray<{ seed: number; state: PersonalityState }> =
  Array.from({ length: ghostCount }, (_, i) => {
    const seed = baseSeed + i;
    return { seed, state: samplePersonality({ seed, stddev: 1.8 }) };
  });

if (ghostCount === 1) {
  console.info(`[peppers-house] birth seed: ${personalitiesAndSeeds[0]!.seed}`);
} else {
  console.info(
    `[peppers-house] spawning ${ghostCount} parallel peppers ghosts (each on its own overlay port if PEPPERS_OVERLAY_PORT set)`,
  );
  for (let i = 0; i < ghostCount; i++) {
    console.info(`[peppers-house]   #${i} birth seed: ${personalitiesAndSeeds[i]!.seed}`);
  }
}

const verbose =
  process.env.PEPPERS_VERBOSE === "1" ||
  process.env.PEPPERS_VERBOSE?.toLowerCase() === "true";

const objective =
  process.env.PEPPERS_OBJECTIVE ??
  "Make friends with as many other ghosts as you can. When a ghost is nearby in your cluster, speak to them — say hello, share something, ask what they're thinking, find common ground. The more ghosts you genuinely connect with, the better. Don't wait for them to start; open the conversation yourself.";

const overlayPortEnv = process.env.PEPPERS_OVERLAY_PORT;
const overlayPort =
  overlayPortEnv !== undefined && overlayPortEnv !== ""
    ? Number(overlayPortEnv)
    : undefined;
if (overlayPort !== undefined && (!Number.isFinite(overlayPort) || overlayPort < 1)) {
  throw new Error(`PEPPERS_OVERLAY_PORT must be a positive integer; got ${overlayPortEnv}`);
}

const memoryConnection = {
  uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
  username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
  password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
  database: process.env.GHOST_MINDS_NEO4J_DATABASE,
};

// In multi-ghost mode, register a single shared house so all peppers
// ghosts can read each other's conversation threads. The conversation
// router enforces that thread reads only succeed when the requesting
// house owns the speaker's ghost — separate houses → cross-ghost reads
// 403 and incoming utterances disappear silently.
let preRegisteredHouseId: string | undefined;
if (ghostCount > 1) {
  console.info(`[peppers-house] registering shared house at ${registryBase} …`);
  preRegisteredHouseId = await registerHouse({ registryBase });
  console.info(`[peppers-house] shared house id: ${preRegisteredHouseId}`);
}

// Each ghost binds its own overlay port (base + index) so a watcher
// can open one tab per ghost and see every cascade. Without per-ghost
// overlays the user can only watch ghost #0 — and #0 is often the
// lonely one with no conversation partners to display.
const overlayPorts =
  overlayPort !== undefined
    ? Array.from({ length: ghostCount }, (_, i) => overlayPort + i)
    : undefined;
if (overlayPorts && ghostCount > 1) {
  console.info(
    `[peppers-house] overlays: ${overlayPorts.map((p) => `http://127.0.0.1:${p}/`).join(", ")}`,
  );
  console.info(
    `[peppers-house] hub view (all ghosts in one tab): http://127.0.0.1:${overlayPorts[0]}/all`,
  );
}

const runs = personalitiesAndSeeds.map(({ state }, i) =>
  runHouse({
    registryBase,
    memoryConnection,
    initialPersonality: state,
    objective,
    verbose,
    overlayPort: overlayPorts?.[i],
    // Only ghost #0 hosts the hub — give it the full port list.
    overlayPeerPorts: i === 0 && overlayPorts && overlayPorts.length > 1 ? overlayPorts : undefined,
    label: ghostCount > 1 ? `#${i}` : undefined,
    preRegisteredHouseId,
  }),
);

await Promise.all(runs).catch((err: unknown) => {
  console.error("\n[peppers-house] fatal:", err);
  process.exit(1);
});
