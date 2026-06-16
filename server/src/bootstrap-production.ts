/**
 * Production-grade bootstrapping orchestrator in TypeScript.
 * Compiles to dist/bootstrap-production.js and is packaged in the server image.
 * Automates starting a live session, waiting for registered agents, and spawning:
 *   1. All enabled NPC agent roster characters.
 *   2. 10 random-agent wanderers.
 */

const httpPort = process.env.AIE_MATRIX_HTTP_PORT || "8787";
const housePort = process.env.AGENT_HOST_PORT || "4000";
const npcAgentPort = process.env.NPC_AGENT_PORT || "4004";

const worldBase = process.env.WORLD_API_URL || `http://server:${httpPort}`;
const houseBase = process.env.AGENT_HOST_URL || `http://agent-host:${housePort}`;

const adminToken = process.env.ADMIN_TOKEN || "";
const token = process.env.AGENT_HOST_TOKEN || "";

if (!adminToken || !token) {
  console.error("[bootstrap] Error: ADMIN_TOKEN and AGENT_HOST_TOKEN are required in the environment.");
  process.exit(1);
}

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${adminToken}`,
};

const agentHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

interface SessionRecord {
  id: string;
}

interface MapItem {
  id: string;
}

interface CatalogAgent {
  agentId: string;
  baseUrl: string;
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

async function waitForNpcAgentInCatalog(maxMs = 60_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${houseBase}/v1/catalog`, { headers: agentHeaders });
      if (r.ok) {
        const catalog = (await r.json()) as { agents?: Record<string, CatalogAgent> };
        const agents = catalog.agents ?? catalog ?? [];
        const found = Object.values(agents).find(
          (a) => typeof a === "object" && a !== null && String(a.baseUrl ?? "").includes(`:${npcAgentPort}`),
        );
        if (found) {
          console.info(`[bootstrap] npc-agent found in catalog: ${found.agentId}`);
          return found.agentId;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function main() {
  try {
    console.info("[bootstrap] Starting production bootstrap sequence…");
    await waitUntilReady(`${worldBase}/health`, "world server");
    await waitUntilReady(`${houseBase}/v1/catalog`, "agent-host", 180_000);

    await startSessionIfNeeded();

    console.info("[bootstrap] Bootstrapping NPC agent roster…");
    const npcAgentId = await waitForNpcAgentInCatalog();
    if (npcAgentId) {
      const npcSp = await fetch(`${houseBase}/v1/sessions/spawn-trusted/${npcAgentId}`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({}),
      });
      if (npcSp.ok) {
        const result = (await npcSp.json()) as { spawned?: unknown[]; failed?: unknown[] };
        const spawnedCount = result.spawned?.length ?? 0;
        const failedCount = result.failed?.length ?? 0;
        console.info(`[bootstrap] npc-agent roster: ${spawnedCount} characters spawned, ${failedCount} failed.`);
      } else {
        console.error(`[bootstrap] npc-agent spawn failed: ${npcSp.status}`, await npcSp.text());
      }
    } else {
      console.warn("[bootstrap] npc-agent did not register in catalog. Skipping NPC spawn.");
    }

    console.info("[bootstrap] Bootstrapping 10 random-agent wanderers…");
    let randomSpawned = 0;
    for (let i = 0; i < 10; i++) {
      try {
        const sp = await fetch(`${houseBase}/v1/sessions/spawn-trusted/random-agent`, {
          method: "POST",
          headers: agentHeaders,
          body: JSON.stringify({ displayName: `wanderer-${i + 1}` }),
        });
        if (sp.ok) {
          randomSpawned++;
        } else {
          console.error(`[bootstrap] spawn random-agent ${i + 1} failed: ${sp.status}`, await sp.text());
        }
      } catch (err) {
        console.error(`[bootstrap] Error spawning random-agent ${i + 1}:`, err);
      }
    }
    console.info(`[bootstrap] Bootstrapping complete. Spawned ${randomSpawned}/10 random-agents.`);
    process.exit(0);
  } catch (err) {
    console.error("[bootstrap] Fatal error in bootstrap script:", err);
    process.exit(1);
  }
}

main();
