/**
 * Listener TCK: IC-001/IC-002 listener tier, IC-004 event receipt, non-speech (no `say` from agent process).
 * Requires: combined aie-matrix server, ghost house, registry chain, internal fanout token, observer-agent.
 */
import { loadRootEnv } from "@aie-matrix/root-env";
import { decodeTime } from "ulid";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const houseBase = (process.env.GHOST_HOUSE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const worldHttpBase = (process.env.AIE_MATRIX_HTTP_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const observerBase = (process.env.OBSERVER_AGENT_BASE_URL ?? "http://127.0.0.1:4002").replace(
  /\/$/,
  "",
);
const devToken = process.env.GHOST_HOUSE_DEV_TOKEN ?? "dev-secret-change-me";
const fanoutToken = process.env.AIE_MATRIX_INTERNAL_FANOUT_TOKEN ?? "";
const fromGhost = process.env.AIE_MATRIX_TCK_MESSAGE_FROM_GHOST ?? "01JARKZP8T0T4T7W8D8V8B8B00";

const ulidRe = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck:listener] ${step} FAILED:${extra}`);
  console.error(`[tck:listener] ${step} ${message}`);
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

function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return getJson<T>(`${registryBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function isPlausibleIsoUtc(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return false;
  }
  return !Number.isNaN(Date.parse(s));
}

async function main() {
  console.error(
    `[tck:listener] house=${houseBase} world=${worldHttpBase} registry=${registryBase} observer=${observerBase}`,
  );

  if (fanoutToken.length === 0) {
    fail("env", "AIE_MATRIX_INTERNAL_FANOUT_TOKEN must be set to inject world events");
  }

  const card = await getJson<{
    protocolVersion?: string;
    capabilities?: { streaming?: boolean; pushNotifications?: boolean };
    matrix?: { tier?: string; schemaVersion?: number; requiredTools?: string[] };
  }>(`${observerBase}/.well-known/agent-card.json`);
  if (card.protocolVersion !== "0.3.0") {
    fail("ic-001", "protocolVersion must be 0.3.0");
  }
  if (card.matrix?.schemaVersion !== 1) {
    fail("ic-001", "matrix.schemaVersion must be 1");
  }
  if (card.matrix?.tier !== "listener") {
    fail("ic-001", "tier must be listener");
  }
  if (card.capabilities?.streaming !== true || card.capabilities.pushNotifications !== true) {
    fail("ic-002", "Listener caps: streaming and pushNotifications true");
  }
  for (const t of card.matrix?.requiredTools ?? []) {
    if (typeof t !== "string" || t.length < 1) {
      fail("ic-001", "requiredTools entries must be non-empty strings if present");
    }
  }

  let registerOk: { ok?: boolean };
  try {
    registerOk = (await getJson(`${houseBase}/v1/catalog/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({ agentId: "observer-agent", baseUrl: observerBase }),
    })) as { ok?: boolean };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("409") || msg.includes("ALREADY") || msg.includes("already")) {
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
      label: "tck-listener",
    });
    const { ghostHouseId } = await postJson<{ ghostHouseId: string }>("/registry/houses", {
      displayName: "tck-listener-house",
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

  let spawn: { sessionId: string; mcpToken: string; ghostId: string };
  try {
    spawn = (await getJson(`${houseBase}/v1/sessions/spawn/observer-agent`, {
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

  // Fan out a world.message.new so the house bridge (or a direct A2A path) can deliver to the session.
  const testText = "tck-listener-hello";
  const fan = await fetch(`${worldHttpBase}/internal/world-fanout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${fanoutToken}`,
    },
    body: JSON.stringify({
      t: "message.new",
      targetGhostId: spawn.ghostId,
      payload: {
        from: fromGhost,
        role: "ghost",
        priority: "NEAR",
        text: testText,
      },
    }),
  });
  if (!fan.ok) {
    const t = await fan.text();
    fail("world-fanout", `POST /internal/world-fanout ${fan.status} ${t.slice(0, 200)}`);
  }

  const deadline = Date.now() + 20_000;
  let last: { worldEvents?: unknown[]; sayEmissions?: number } | null = null;
  while (Date.now() < deadline) {
    try {
      last = (await getJson(`${observerBase}/_tck/observer`, {
        headers: { authorization: `Bearer ${devToken}` },
      })) as { worldEvents?: unknown[]; sayEmissions?: number };
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    if ((last.worldEvents?.length ?? 0) > 0) {
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!last || (last.worldEvents?.length ?? 0) < 1) {
    fail("ic-004", "observer did not record a world event in time (check Colyseus bridge and fanout token)");
  }

  const w = (last.worldEvents as Record<string, unknown>[])[(last.worldEvents as unknown[]).length - 1]!;
  if (w.schema !== "aie-matrix.world-event.v1") {
    fail("ic-004", `expected schema, got ${String(w.schema)}`);
  }
  if (w.kind !== "world.message.new") {
    fail("ic-004", `expected world.message.new, got ${String(w.kind)}`);
  }
  if (w.ghostId !== spawn.ghostId) {
    fail("ic-004", "ghostId mismatch on envelope");
  }
  if (typeof w.eventId !== "string" || !ulidRe.test(w.eventId)) {
    fail("ic-004", "eventId must be a valid ULID string");
  }
  try {
    void decodeTime(w.eventId);
  } catch {
    fail("ic-004", "eventId not decodable as ULID time");
  }
  if (typeof w.sentAt !== "string" || !isPlausibleIsoUtc(w.sentAt)) {
    fail("ic-004", "sentAt must be parseable ISO-8601");
  }
  const p = w.payload;
  if (p == null || typeof p !== "object" || Array.isArray(p)) {
    fail("ic-004", "payload must be an object");
  }
  if ((p as { text?: unknown }).text !== testText) {
    fail("ic-004", "payload.text mismatch (world.message.new)");
  }

  if (last.sayEmissions != null && last.sayEmissions !== 0) {
    fail("tck", "Listener must not emit say (TCK: sayEmissions=0)");
  }
  try {
    const u = `${houseBase}/v1/sessions/${encodeURIComponent(spawn.sessionId)}`;
    const r = await fetch(u, { method: "DELETE", headers: { authorization: `Bearer ${devToken}` } });
    await r.text();
  } catch {
    /* best effort */
  }

  console.error("[tck:listener] PASS");
}

void main().catch((e) => fail("fatal", String(e), e));
