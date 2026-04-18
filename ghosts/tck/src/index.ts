/**
 * Minimal PoC compatibility smoke (IC-006 subset).
 * @see specs/001-minimal-poc/contracts/tck-scenarios.md
 */
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck] ${step} FAILED:${extra}`);
  console.error(`[tck] ${step} ${message}`);
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return getJson<T>(`${registryBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function stepReachability(): Promise<void> {
  const url = `${registryBase}/spectator/room`;
  try {
    const data = await getJson<{ roomId?: string; error?: string }>(url);
    if (!data.roomId || typeof data.roomId !== "string") {
      fail("reachability", `Expected JSON { roomId } from ${url}, got ${JSON.stringify(data)}`);
    }
    console.error(`[tck] reachability ok (roomId=${data.roomId.slice(0, 8)}…)`);
  } catch (e) {
    fail(
      "reachability",
      `GET ${url} — start the combined server first (e.g. pnpm run server or pnpm run demo).`,
      e,
    );
  }
}

async function stepRegistryAndMcp(): Promise<void> {
  let adopt: {
    ghostId: string;
    credential: { token: string; worldApiBaseUrl: string };
  };
  try {
    const { caretakerId } = await postJson<{ caretakerId: string }>("/registry/caretakers", {
      label: "ghost-tck",
    });
    const { ghostHouseId } = await postJson<{ ghostHouseId: string }>("/registry/houses", {
      displayName: "ghost-tck-house",
    });
    adopt = await postJson<{
      ghostId: string;
      credential: { token: string; worldApiBaseUrl: string };
    }>("/registry/adopt", { caretakerId, ghostHouseId });
    console.error(`[tck] adopt ok (ghostId=${adopt.ghostId.slice(0, 8)}…)`);
  } catch (e) {
    fail("adopt", "Registry caretaker/house/adopt chain failed.", e);
  }

  const mcp = new GhostMcpClient({
    worldApiBaseUrl: adopt.credential.worldApiBaseUrl,
    token: adopt.credential.token,
  });
  try {
    await mcp.connect();
  } catch (e) {
    fail("mcp-connect", "Could not open MCP Streamable HTTP session.", e);
  }

  try {
    const loc = (await mcp.callTool("whereami", {})) as { tileId?: string };
    if (!loc || typeof loc.tileId !== "string" || loc.tileId.length === 0) {
      fail("whereami", `Expected { tileId: string }, got ${JSON.stringify(loc)}`);
    }
    console.error(`[tck] whereami ok (tileId=${loc.tileId})`);
  } catch (e) {
    fail("whereami", "MCP whereami failed or returned no tileId.", e);
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}

async function main(): Promise<void> {
  console.error(`[tck] minimal PoC smoke (registry=${registryBase})`);
  await stepReachability();
  await stepRegistryAndMcp();
  console.error("[tck] PASS");
}

void main().catch((e) => {
  fail("fatal", "Unexpected error.", e);
});
