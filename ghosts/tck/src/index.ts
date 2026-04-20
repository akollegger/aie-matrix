/**
 * Minimal PoC compatibility smoke (IC-006 subset).
 * @see specs/001-minimal-poc/contracts/tck-scenarios.md
 */
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { isEnvTruthy, loadRootEnv } from "@aie-matrix/root-env";
import { getResolution, isValidCell } from "h3-js";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");

/** Anchor H3 must match `maps/sandbox/freeplay.tmj` when using default map (TCK spawn mode). */
const SANDBOX_ANCHOR_H3 = "8f2830828052d25";

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

function assertValidH3Res15(id: string, step: string): void {
  if (!isValidCell(id) || getResolution(id) !== 15) {
    fail(step, `Expected valid H3 res-15 index, got ${JSON.stringify(id)}`);
  }
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

type ExitsPayload = {
  here?: string;
  exits?: ReadonlyArray<{ toward?: string; tileId?: string }>;
  nonAdjacent?: ReadonlyArray<{ kind?: string; name?: string; tileId?: string }>;
};

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
    const loc = (await mcp.callTool("whereami", {})) as { tileId?: string; h3Index?: string };
    const cell =
      loc && typeof loc.h3Index === "string" && loc.h3Index.length > 0
        ? loc.h3Index
        : loc && typeof loc.tileId === "string" && loc.tileId.length > 0
          ? loc.tileId
          : null;
    if (!cell) {
      fail("whereami", `Expected { h3Index: string } or { tileId: string }, got ${JSON.stringify(loc)}`);
    }
    assertValidH3Res15(cell, "whereami");
    console.error(`[tck] whereami ok (h3Index=${cell})`);

    if (isEnvTruthy(process.env.AIE_MATRIX_TCK_MODE)) {
      if (cell !== SANDBOX_ANCHOR_H3) {
        fail(
          "tck-spawn",
          `With AIE_MATRIX_TCK_MODE the ghost must spawn on map anchor ${SANDBOX_ANCHOR_H3}, got ${cell}`,
        );
      }
      const ex0 = (await mcp.callTool("exits", {})) as ExitsPayload;
      const elevator = ex0.nonAdjacent?.find((x) => x.name === "tck-elevator");
      if (!elevator?.tileId) {
        console.error(
          "[tck] SKIP traverse: no tck-elevator in exits (start server with NEO4J_URI for Neo4j graph seeds)",
        );
      } else {
        assertValidH3Res15(elevator.tileId, "exits-elevator-dest");
        const tr = (await mcp.callTool("traverse", { via: "tck-elevator" })) as {
          ok?: boolean;
          to?: string;
          from?: string;
        };
        if (!tr || tr.ok !== true || typeof tr.to !== "string") {
          fail("traverse", `Expected traverse success, got ${JSON.stringify(tr)}`);
        }
        assertValidH3Res15(tr.to, "traverse-to");
        if (tr.to === cell) {
          fail("traverse", "Traverse should change cell");
        }
        let traverseErrPayload: { error?: string; code?: string } | undefined;
        try {
          await mcp.callTool("traverse", { via: "definitely-missing-exit" });
          fail("traverse-no-exit", "Expected traverse to throw for missing exit");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          try {
            traverseErrPayload = JSON.parse(msg) as { error?: string; code?: string };
          } catch {
            fail("traverse-no-exit", `Could not parse MCP error JSON: ${msg.slice(0, 200)}`);
          }
        }
        if (!traverseErrPayload || traverseErrPayload.code !== "NO_EXIT") {
          fail(
            "traverse-no-exit",
            `Expected code NO_EXIT, got ${JSON.stringify(traverseErrPayload)}`,
          );
        }
        console.error("[tck] traverse ok (elevator + NO_EXIT)");
      }
    }

    for (let step = 0; step < 40; step++) {
      const ex = (await mcp.callTool("exits", {})) as ExitsPayload;
      const first = ex.exits?.[0];
      const toward = first && typeof first.toward === "string" ? first.toward : null;
      if (!toward) {
        fail("go-sequence", `No exits at step ${step} (need ≥1 to continue 40-step walk)`);
      }
      const goRes = (await mcp.callTool("go", { toward })) as { ok?: boolean; tileId?: string };
      if (!goRes || goRes.ok !== true || typeof goRes.tileId !== "string" || goRes.tileId.length === 0) {
        fail("go-sequence", `go failed at step ${step}: ${JSON.stringify(goRes)}`);
      }
      assertValidH3Res15(goRes.tileId, `go step ${step}`);
    }
    console.error("[tck] go-sequence ok (40 steps, H3 res-15 each step)");
  } catch (e) {
    fail("mcp-sequence", "MCP whereami or go sequence failed.", e);
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
