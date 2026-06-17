#!/usr/bin/env node
/**
 * Ghost spawn integration test — verifies that ghosts autospawn after a live
 * session is activated against a running stack.
 *
 * Does NOT manage docker/podman compose. Assumes the stack is already up.
 * Run via `pnpm test:staging` (which manages compose lifecycle), or as a step
 * in staging-ci.yml after the stack is healthy.
 *
 * Exit 0 = PASS, exit 1 = FAIL.
 *
 * Env vars:
 *   SERVER_URL          — world server base URL (default http://127.0.0.1:8787)
 *   AGENT_HOST_URL      — agent-host base URL  (default http://127.0.0.1:4000)
 *   ADMIN_TOKEN         — required; used to activate a live session
 *   AGENT_HOST_TOKEN    — required; used to read /v1/sessions
 *   GHOST_MIN_COUNT     — minimum random-agent sessions expected (default 1)
 *   WAIT_TIMEOUT_MS     — ms to wait for ghosts to appear (default 60000)
 */

const SERVER_URL = (process.env.SERVER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const HOUSE_URL = (process.env.AGENT_HOST_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const AGENT_HOST_TOKEN = process.env.AGENT_HOST_TOKEN;
const GHOST_MIN_COUNT = Math.max(1, parseInt(process.env.GHOST_MIN_COUNT ?? "1", 10));
const WAIT_TIMEOUT_MS = Math.max(5000, parseInt(process.env.WAIT_TIMEOUT_MS ?? "60000", 10));

if (!ADMIN_TOKEN) { console.error("[ghost-spawn] ERROR: ADMIN_TOKEN is required"); process.exit(1); }
if (!AGENT_HOST_TOKEN) { console.error("[ghost-spawn] ERROR: AGENT_HOST_TOKEN is required"); process.exit(1); }

function log(msg) { console.error(`[ghost-spawn] ${msg}`); }
function fail(step, msg, cause) {
  const extra = cause ? ` — ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[ghost-spawn] FAIL: ${step}: ${msg}${extra}`);
  process.exit(1);
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ── Step 1: Discover a map ────────────────────────────────────────────────────

log(`Step 1/3: Discovering maps from ${SERVER_URL}/maps`);
let mapId;
try {
  const data = await getJson(`${SERVER_URL}/maps`);
  const maps = Array.isArray(data) ? data : (data.maps ?? []);
  if (maps.length === 0) fail("discover-maps", "No maps available. Is AIE_MATRIX_MODE=development set on the server?");
  const getId = (m) => typeof m === "string" ? m : (m.id ?? m.mapId ?? m.name);
  // Prefer maps large enough for multi-step navigation (freeplay, then moscone, then first)
  const preferred =
    maps.find(m => getId(m)?.includes("freeplay")) ??
    maps.find(m => getId(m)?.includes("moscone-aiewf-mini")) ??
    maps.find(m => getId(m)?.includes("moscone")) ??
    maps[0];
  mapId = getId(preferred);
  if (!mapId) fail("discover-maps", `Could not extract map ID from: ${JSON.stringify(preferred)}`);
} catch (e) {
  fail("discover-maps", `GET ${SERVER_URL}/maps`, e);
}
log(`  using map: ${mapId}`);

// ── Step 2: Activate a live session ───────────────────────────────────────────

log("Step 2/3: Activating a live session");
let sessionId;
try {
  // End any existing active session first (idempotent — ignore 404)
  const existing = await getJson(`${SERVER_URL}/live?status=active`).catch(() => []);
  if (Array.isArray(existing) && existing.length > 0) {
    log(`  ending stale session: ${existing[0].id}`);
    await fetch(`${SERVER_URL}/live/${existing[0].id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    }).catch(() => {});
  }

  const session = await getJson(`${SERVER_URL}/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ name: "ghost-spawn-test", maps: [{ mapId, role: "primary" }] }),
  });
  sessionId = session.id ?? session.sessionId;
  if (!sessionId) fail("activate-session", `No session ID in response: ${JSON.stringify(session)}`);
} catch (e) {
  fail("activate-session", `POST ${SERVER_URL}/live`, e);
}
log(`  session activated: ${sessionId}`);

// ── Step 3: Wait for ghosts ───────────────────────────────────────────────────

log(`Step 3/3: Waiting for ≥${GHOST_MIN_COUNT} random-agent ghost(s) (timeout ${WAIT_TIMEOUT_MS / 1000}s)`);
const deadline = Date.now() + WAIT_TIMEOUT_MS;
let ghostCount = 0;
while (true) {
  try {
    const data = await getJson(`${HOUSE_URL}/v1/sessions`, {
      headers: { Authorization: `Bearer ${AGENT_HOST_TOKEN}` },
    });
    const sessions = data.sessions ?? [];
    // agentId is "random-agent" in compose (AGENT_ID env) or "random-agent-<pod>" in K8s (HOSTNAME)
    const active = sessions.filter(s => s.agentId?.startsWith("random-agent") && s.status !== "terminated");
    ghostCount = active.length;
    log(`  random-agent sessions: ${ghostCount}`);
    if (ghostCount >= GHOST_MIN_COUNT) break;
  } catch (e) {
    log(`  /v1/sessions error: ${e.message}`);
  }
  if (Date.now() >= deadline) {
    fail("wait-for-ghosts", `Timed out. Got ${ghostCount} session(s), need ≥${GHOST_MIN_COUNT}. ` +
      `Check agent-host logs for startup-reconciliation entries.`);
  }
  await new Promise(r => setTimeout(r, 4000));
}

log("");
log(`✓ PASS — ${ghostCount} random-agent ghost(s) active after session activation.`);
