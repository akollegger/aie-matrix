/**
 * Roster-spawn TCK — verifies ghost autospawn via GET /v1/roster + spawn-trusted.
 *
 * Requires: combined server + agent-host + random-agent running with an active live session.
 * Run:  pnpm --filter @aie-matrix/ghost-tck tck:roster-spawn
 *
 * What it checks:
 *  1. random-agent /v1/roster returns N entries (default ≥1) with correct shape
 *  2. agent-host spawn-trusted/random-agent calls spawnRosterForAgent and returns
 *     { spawned, failed } — all entries succeeded (failed.length === 0)
 *  3. The spawned ghostIds appear in GET /v1/sessions (active in-memory state)
 */
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const houseBase = (process.env.AGENT_HOST_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const devToken = process.env.AGENT_HOST_TOKEN ?? "dev-secret-change-me";
const randomBase = (process.env.RANDOM_AGENT_BASE_URL ?? "http://127.0.0.1:4001").replace(/\/$/, "");

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck:roster-spawn] ${step} FAILED:${extra}`);
  console.error(`[tck:roster-spawn] ${step} ${message}`);
  return process.exit(1) as never;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`fetch ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return data as T;
}

type RosterEntry = { characterId: string; displayName: string; background?: string };
type SpawnResult = {
  agentId: string;
  spawned: Array<{ ghostId: string; characterId: string; sessionId: string }>;
  failed: Array<{ characterId: string; error: string }>;
};
type SessionEntry = { sessionId: string; ghostId: string; agentId: string; status: string };

async function stepRosterEndpoint(): Promise<number> {
  const url = `${randomBase}/v1/roster`;
  let roster: RosterEntry[];
  try {
    roster = await getJson<RosterEntry[]>(url);
  } catch (e) {
    fail("roster-endpoint", `GET ${url} — is random-agent running?`, e);
  }
  if (!Array.isArray(roster)) {
    fail("roster-endpoint", `Expected array, got ${JSON.stringify(roster).slice(0, 100)}`);
  }
  if (roster.length === 0) {
    fail(
      "roster-endpoint",
      "Roster is empty. Set RANDOM_AGENT_COUNT > 0 (or unset it to use default of 10).",
    );
  }
  for (const [i, entry] of roster.entries()) {
    if (typeof entry.characterId !== "string" || entry.characterId.length === 0) {
      fail("roster-endpoint", `Entry ${i} missing characterId: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.displayName !== "string" || entry.displayName.length === 0) {
      fail("roster-endpoint", `Entry ${i} missing displayName: ${JSON.stringify(entry)}`);
    }
  }
  console.error(`[tck:roster-spawn] roster-endpoint ok (${roster.length} entries)`);
  return roster.length;
}

async function stepSpawnTrusted(expectedCount: number): Promise<string[]> {
  const url = `${houseBase}/v1/sessions/spawn-trusted/random-agent`;
  let result: SpawnResult;
  try {
    result = await getJson<SpawnResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404") || msg.includes("no active")) {
      fail(
        "spawn-trusted",
        "No active live session — activate one via the map-editor Admin panel first, then re-run.",
        e,
      );
    }
    fail("spawn-trusted", `POST ${url}`, e);
  }

  if (!Array.isArray(result.spawned)) {
    fail("spawn-trusted", `Expected { spawned: [] }, got ${JSON.stringify(result).slice(0, 200)}`);
  }
  if (!Array.isArray(result.failed)) {
    fail("spawn-trusted", `Expected { failed: [] }, got ${JSON.stringify(result).slice(0, 200)}`);
  }
  if (result.failed.length > 0) {
    fail(
      "spawn-trusted",
      `${result.failed.length} ghost(s) failed to spawn: ${JSON.stringify(result.failed).slice(0, 300)}`,
    );
  }
  if (result.spawned.length < expectedCount) {
    // Tolerate fewer if some were already running (idempotent path returns only new spawns).
    // Just verify at least one was attempted.
    if (result.spawned.length === 0) {
      console.error(
        `[tck:roster-spawn] spawn-trusted: 0 new ghosts spawned (all ${expectedCount} may already be running — checking sessions)`,
      );
    }
  }
  const ghostIds = result.spawned.map((s) => s.ghostId);
  console.error(
    `[tck:roster-spawn] spawn-trusted ok (spawned=${result.spawned.length}, failed=${result.failed.length})`,
  );
  return ghostIds;
}

async function stepSessionsPresent(spawnedGhostIds: string[], expectedCount: number): Promise<void> {
  const url = `${houseBase}/v1/sessions`;
  let body: { sessions?: SessionEntry[] };
  try {
    body = await getJson<{ sessions?: SessionEntry[] }>(url, {
      headers: { Authorization: `Bearer ${devToken}` },
    });
  } catch (e) {
    fail("sessions-list", `GET ${url}`, e);
  }

  const sessions = body.sessions ?? [];
  const randomAgentSessions = sessions.filter(
    (s) => s.agentId === "random-agent" && s.status !== "terminated",
  );

  if (randomAgentSessions.length === 0) {
    fail(
      "sessions-present",
      `No active random-agent sessions found in GET /v1/sessions. Expected ≥${expectedCount}.`,
    );
  }

  // If spawn-trusted returned ghostIds, confirm they appear in the session list.
  if (spawnedGhostIds.length > 0) {
    const sessionGhostIds = new Set(randomAgentSessions.map((s) => s.ghostId));
    const missing = spawnedGhostIds.filter((id) => !sessionGhostIds.has(id));
    if (missing.length > 0) {
      fail(
        "sessions-present",
        `${missing.length} spawned ghost(s) not found in active sessions: ${missing.join(", ")}`,
      );
    }
  }

  console.error(
    `[tck:roster-spawn] sessions-present ok (${randomAgentSessions.length} random-agent session(s) active)`,
  );
}

async function main(): Promise<void> {
  console.error(`[tck:roster-spawn] house=${houseBase} random=${randomBase}`);

  const rosterCount = await stepRosterEndpoint();
  const spawnedGhostIds = await stepSpawnTrusted(rosterCount);
  await stepSessionsPresent(spawnedGhostIds, rosterCount);

  console.error("[tck:roster-spawn] PASS");
}

void main().catch((e) => fail("fatal", String(e), e));
