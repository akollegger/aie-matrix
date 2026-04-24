/**
 * Social TCK: partner message → world fanout → echo MCP say → thread log.
 * Requires: pnpm dev, `AIE_MATRIX_INTERNAL_FANOUT_TOKEN`, echo-agent on ECHO_AGENT_BASE_URL.
 */
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const houseBase = (process.env.GHOST_HOUSE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const worldHttpBase = (process.env.AIE_MATRIX_HTTP_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const echoBase = (process.env.ECHO_AGENT_BASE_URL ?? "http://127.0.0.1:4003").replace(/\/$/, "");
const devToken = process.env.GHOST_HOUSE_DEV_TOKEN ?? "dev-secret-change-me";
const fanoutToken = process.env.AIE_MATRIX_INTERNAL_FANOUT_TOKEN ?? "";
const fromPartner = process.env.AIE_MATRIX_TCK_PARTNER_GHOST ?? "01JARPPARTNER000TCK000TCK0000";

const testText = "social-tck-hello-echo";

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck:social] ${step} FAILED:${extra}`);
  console.error(`[tck:social] ${step} ${message}`);
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

async function main() {
  console.error(
    `[tck:social] house=${houseBase} world=${worldHttpBase} registry=${registryBase} echo=${echoBase}`,
  );
  if (fanoutToken.length === 0) {
    fail("env", "AIE_MATRIX_INTERNAL_FANOUT_TOKEN is required (same as listener TCK)");
  }

  const card = await getJson<{
    protocolVersion?: string;
    matrix?: { tier?: string; schemaVersion?: number };
    capabilities?: { pushNotifications?: boolean; streaming?: boolean };
  }>(`${echoBase}/.well-known/agent-card.json`);
  if (card.protocolVersion !== "0.3.0" || card.matrix?.schemaVersion !== 1) {
    fail("ic-001", "echo agent card");
  }
  if (card.matrix?.tier !== "social") {
    fail("ic-001", "tier must be social");
  }
  if (card.capabilities?.pushNotifications !== true || card.capabilities.streaming !== true) {
    fail("ic-002", "social must stream + push");
  }

  let registerOk: { ok?: boolean };
  try {
    registerOk = (await getJson(`${houseBase}/v1/catalog/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({ agentId: "echo-agent", baseUrl: echoBase }),
    })) as { ok?: boolean };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("409") || msg.includes("ALREADY") || msg.includes("already")) {
      registerOk = { ok: true };
    } else {
      fail("register", "catalog", e);
    }
  }
  if (registerOk?.ok !== true) {
    fail("register", "expected ok");
  }

  const { ghostHouseId } = await postJson<{ ghostHouseId: string }>("/registry/houses", {
    displayName: "tck-social-house",
  });
  const { caretakerId } = await postJson<{ caretakerId: string }>("/registry/caretakers", {
    label: "tck-social",
  });
  const adopt = (await postJson<{
    ghostId: string;
    credential: { token: string; worldApiBaseUrl: string };
  }>("/registry/adopt", { caretakerId, ghostHouseId })) as {
    ghostId: string;
    credential: { token: string; worldApiBaseUrl: string };
  };

  const spawn = (await getJson(`${houseBase}/v1/sessions/spawn/echo-agent`, {
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
  })) as { sessionId: string; ghostId: string };

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
        from: fromPartner,
        role: "partner",
        priority: "PARTNER",
        text: testText,
      },
    }),
  });
  if (!fan.ok) {
    const t = await fan.text();
    fail("world-fanout", `${fan.status} ${t.slice(0, 200)}`);
  }

  const t0 = Date.now();
  let tck: { mcpSayTexts?: string[] } = {};
  while (Date.now() - t0 < 25_000) {
    try {
      tck = (await getJson(`${echoBase}/_tck/echo`, {
        headers: { authorization: `Bearer ${devToken}` },
      })) as { mcpSayTexts?: string[] };
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (tck.mcpSayTexts?.some((x) => x === testText)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!tck.mcpSayTexts?.some((x) => x === testText)) {
    fail("mcp", "echo did not MCP say the expected text (is house + world up?)");
  }

  const threadT0 = Date.now();
  let foundInThread = false;
  while (Date.now() - threadT0 < 20_000) {
    const thread = (await getJson<{
      messages: Array<{ content: string; role: string; thread_id: string }>;
    }>(`${registryBase}/threads/${encodeURIComponent(spawn.ghostId)}?limit=20`, {
      headers: { authorization: `Bearer ${ghostHouseId}` },
    })) as { messages: Array<{ content: string }> };
    if (thread.messages?.some((m) => m.content === testText)) {
      foundInThread = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!foundInThread) {
    fail("thread", "say did not reach GET /threads/:ghostId (conversation log)");
  }

  try {
    const u = `${houseBase}/v1/sessions/${encodeURIComponent(spawn.sessionId)}`;
    await fetch(u, { method: "DELETE", headers: { authorization: `Bearer ${devToken}` } });
  } catch {
    /* best effort */
  }

  console.error("[tck:social] PASS");
}

void main().catch((e) => fail("fatal", String(e), e));
