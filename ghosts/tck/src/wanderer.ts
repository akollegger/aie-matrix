/**
 * Wanderer A2A tier TCK (IC-001, IC-002, IC-003, IC-006).
 * Requires: combined server, ghost-house, random-agent, registered agent, active spawn session.
 */
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { loadRootEnv, isEnvTruthy } from "@aie-matrix/root-env";
import { getResolution, isValidCell } from "h3-js";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const houseBase = (process.env.GHOST_HOUSE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const devToken = process.env.GHOST_HOUSE_DEV_TOKEN ?? "dev-secret-change-me";
const randomBase = (process.env.RANDOM_AGENT_BASE_URL ?? "http://127.0.0.1:4001").replace(/\/$/, "");

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck:wanderer] ${step} FAILED:${extra}`);
  console.error(`[tck:wanderer] ${step} ${message}`);
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

function assertValidH3Res15(id: string, step: string): void {
  if (!isValidCell(id) || getResolution(id) !== 15) {
    fail(step, `Expected valid H3 res-15, got ${JSON.stringify(id)}`);
  }
}

async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return getJson<T>(`${registryBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function main() {
  console.error(`[tck:wanderer] house=${houseBase} random=${randomBase} registry=${registryBase}`);

  const t0 = Date.now();
  const cardUrl = `${randomBase}/.well-known/agent-card.json`;
  const card = await getJson<{
    name?: string;
    protocolVersion?: string;
    capabilities?: { streaming?: boolean; pushNotifications?: boolean };
    matrix?: {
      schemaVersion?: number;
      tier?: string;
      requiredTools?: string[];
    };
  }>(cardUrl);
  if (card.protocolVersion !== "0.3.0") {
    fail("ic-001", "protocolVersion must be 0.3.0");
  }
  if (card.matrix?.schemaVersion !== 1) {
    fail("ic-001", "matrix.schemaVersion must be 1");
  }
  if (card.matrix?.tier !== "wanderer") {
    fail("ic-001", "tier must be wanderer");
  }
  if (card.capabilities?.streaming !== true || card.capabilities.pushNotifications !== false) {
    fail("ic-002", "Wanderer caps: streaming true, push false");
  }
  for (const t of ["whereami", "exits", "go"]) {
    if (!card.matrix?.requiredTools?.includes(t)) {
      fail("ic-001", `requiredTools must include ${t}`);
    }
  }
  if (!card.name) {
    fail("ic-001", "name is required");
  }

  let registerOk: { ok?: boolean };
  try {
    registerOk = (await getJson(`${houseBase}/v1/catalog/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({ agentId: "random-agent", baseUrl: randomBase }),
    })) as { ok?: boolean };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("409") || msg.includes("ALREADY_REGISTERED") || msg.includes("already")) {
      registerOk = { ok: true };
    } else {
      fail("register", "POST /v1/catalog/register", e);
    }
  }
  if (registerOk?.ok !== true) {
    fail("register", "expected { ok: true }");
  }

  let adopt: { ghostId: string; credential: { token: string; worldApiBaseUrl: string } };
  try {
    const { caretakerId } = await postJson<{ caretakerId: string }>("/registry/caretakers", {
      label: "tck-wanderer",
    });
    const { ghostHouseId } = await postJson<{ ghostHouseId: string }>("/registry/houses", {
      displayName: "tck-wanderer-house",
    });
    adopt = (await postJson<{
      ghostId: string;
      credential: { token: string; worldApiBaseUrl: string };
    }>("/registry/adopt", { caretakerId, ghostHouseId })) as {
      ghostId: string;
      credential: { token: string; worldApiBaseUrl: string };
    };
  } catch (e) {
    fail("adopt", "Registry chain failed. Is pnpm dev running?", e);
  }

  const spawnT0 = Date.now();
  let spawn: { sessionId: string; mcpToken: string; ghostId: string };
  try {
    spawn = (await getJson(`${houseBase}/v1/sessions/spawn/random-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({
        ghostId: adopt.ghostId,
        credential: {
          token: adopt.credential.token,
          worldApiBaseUrl: adopt.credential.worldApiBaseUrl,
        },
      }),
    })) as { sessionId: string; mcpToken: string; ghostId: string };
  } catch (e) {
    fail("spawn", "POST /v1/sessions/spawn", e);
  }
  const ackMs = Date.now() - spawnT0;
  if (ackMs > 30_000) {
    fail("ic-006", `spawn+ack took ${ackMs}ms (limit 30s)`);
  }
  if (Date.now() - t0 > 5_000 && Date.now() - spawnT0 > 5_000) {
    /* spawn ack within 5s of first task message is a soft check */
  }

  const mcp = new GhostMcpClient({
    worldApiBaseUrl: `${houseBase}/v1/mcp`,
    token: spawn.mcpToken,
  });
  await mcp.connect();
  try {
    const loc = (await mcp.callTool("whereami", {})) as { h3Index?: string; tileId?: string };
    const h3 = loc.h3Index && loc.h3Index.length > 0 ? loc.h3Index : loc.tileId;
    if (typeof h3 !== "string" || h3.length === 0) {
      fail("whereami", `bad payload ${JSON.stringify(loc)}`);
    }
    assertValidH3Res15(h3, "whereami");

    for (let s = 0; s < 10; s++) {
      const ex = (await mcp.callTool("exits", {})) as { exits?: ReadonlyArray<{ toward?: string }> };
      const toward = ex.exits?.[0]?.toward;
      if (typeof toward !== "string") {
        fail("go-sequence", `no exit at step ${s}`);
      }
      const g = (await mcp.callTool("go", { toward })) as { ok?: boolean; tileId?: string };
      if (g?.ok !== true || typeof g.tileId !== "string") {
        fail("go", `go failed: ${JSON.stringify(g)}`);
      }
      assertValidH3Res15(g.tileId, `go step ${s}`);
    }
  } finally {
    await mcp.disconnect().catch(() => {});
  }

  if (isEnvTruthy(process.env.AIE_MATRIX_TCK_STRICT_SPAWN_5S)) {
    if (ackMs > 5_000) {
      fail("ic-006", "spawn/ack not within 5s (strict mode)");
    }
  }

  try {
    const u = `${houseBase}/v1/sessions/${encodeURIComponent(spawn.sessionId)}`;
    const r = await fetch(u, { method: "DELETE", headers: { authorization: `Bearer ${devToken}` } });
    await r.text();
  } catch {
    /* best effort */
  }

  console.error("[tck:wanderer] PASS");
}

void main().catch((e) => fail("fatal", String(e), e));
