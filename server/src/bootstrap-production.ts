/**
 * Production bootstrap: ensures the world server is healthy and a live session exists.
 * Agent-host and agents self-register and spawn their roster via spec-038 resilience.
 */

const httpPort = process.env.AIE_MATRIX_HTTP_PORT || "8787";

const worldBase = process.env.WORLD_API_URL || `http://server:${httpPort}`;

const adminToken = process.env.ADMIN_TOKEN || "";

if (!adminToken) {
  console.error("[bootstrap] Error: ADMIN_TOKEN is required in the environment.");
  process.exit(1);
}

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${adminToken}`,
};

interface SessionRecord {
  id: string;
}

interface MapItem {
  id: string;
}

async function waitUntilReady(url: string, label: string, maxMs = 300_000): Promise<void> {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.info(`[bootstrap] ${label} is ready: ${url}`);
        return;
      }
    } catch {
      /* retry */
    }
    const now = Date.now();
    if (now - lastLog > 5000) {
      lastLog = now;
      console.info(`[bootstrap] waiting for ${label} at ${url}…`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`[bootstrap] Timeout waiting for ${label} (${url})`);
}

async function getActiveLiveSessionId(): Promise<string | null> {
  try {
    const r = await fetch(`${worldBase}/live?status=active`);
    if (!r.ok) return null;
    const sessions = (await r.json()) as SessionRecord[];
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    return sessions[0].id ?? null;
  } catch {
    return null;
  }
}

async function startSessionIfNeeded(): Promise<string> {
  const sessionId = await getActiveLiveSessionId();
  if (sessionId) {
    console.info(`[bootstrap] Active live session already exists: ${sessionId}`);
    return sessionId;
  }

  console.info("[bootstrap] No active live session found. Discovering map list…");
  const mapsRes = await fetch(`${worldBase}/maps`);
  if (!mapsRes.ok) {
    throw new Error(`[bootstrap] Failed to fetch map list: ${mapsRes.status} ${await mapsRes.text()}`);
  }
  const mapData = (await mapsRes.json()) as { maps: MapItem[]; active: string | null };
  const maps = mapData.maps ?? [];
  let mapId = mapData.active;

  if (!mapId && maps.length > 0) {
    const mosconeMini = maps.find((m) => m.id.includes("moscone-aiewf-mini"));
    const moscone = maps.find((m) => m.id.includes("moscone"));
    mapId = mosconeMini?.id || moscone?.id || maps[0].id;
  }

  if (!mapId) {
    throw new Error("[bootstrap] No published maps found in the system. Cannot start session.");
  }

  console.info(`[bootstrap] Starting live session with map ID: ${mapId}`);
  const startRes = await fetch(`${worldBase}/live`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: `prod-moscone-${Date.now()}`,
      maps: [{ mapId, role: "primary" }],
    }),
  });

  if (!startRes.ok) {
    throw new Error(`[bootstrap] Failed to start live session: ${startRes.status} ${await startRes.text()}`);
  }

  const session = (await startRes.json()) as SessionRecord;
  console.info(`[bootstrap] Live session started successfully: ${session.id}`);
  return session.id;
}


async function main() {
  try {
    console.info("[bootstrap] Starting production bootstrap sequence…");
    await waitUntilReady(`${worldBase}/health`, "world server");

    // Start (or confirm) the live session. Agent-host and agents are deployed
    // after this job completes and will reconcile their own roster via the
    // startup-reconciliation path (spec-038). No need to wait for agent-host here.
    await startSessionIfNeeded();

    console.info("[bootstrap] Session ready. Agent-host and agents will self-register and spawn roster.");
    process.exit(0);
  } catch (err) {
    console.error("[bootstrap] Fatal error in bootstrap script:", err);
    process.exit(1);
  }
}

main();
