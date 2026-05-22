import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const AGENT_HOST_PORT = 4000;
const RANDOM_AGENT_PORT = 4001;
const WORLD_API_BASE = "http://127.0.0.1:8787";
const AGENT_HOST_BASE = `http://127.0.0.1:${AGENT_HOST_PORT}`;
const DEV_TOKEN = process.env.GHOST_HOUSE_DEV_TOKEN ?? "e2e-dev-token";

/** Mirrors `SpectatorE2eHook` in `clients/debugger/phaser` (debug / `?debug=1` only). */
type SpectatorE2eHook = {
  ghostTilesSize(): number;
  tileCoordsSize(): number;
  ghostMarkerCount(): number;
  stateSyncCount(): number;
};

/** Playwright `use.baseURL` may include a path or query; strip to origin for deterministic loads. */
function spectatorOriginFromConfig(baseURL: string | undefined): string {
  if (baseURL == null || baseURL.length === 0) {
    return "http://127.0.0.1:5179";
  }
  try {
    return new URL(baseURL).origin;
  } catch {
    return "http://127.0.0.1:5179";
  }
}

async function waitUrl(url: string, maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

test.describe.configure({ mode: "serial" });

test.describe("Phaser spectator + Colyseus ghostTiles", () => {
  let agentHost: ChildProcess | undefined;
  let randomAgent: ChildProcess | undefined;
  let activeSessionId: string | undefined;

  const E2E_AGENT_HOSTNAME = "e2e";
  const E2E_AGENT_ID = `random-agent-${E2E_AGENT_HOSTNAME}`;

  test.beforeAll(async () => {
    agentHost = spawn("node", ["server/agent-host/dist/main.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_HOST_TOKEN: DEV_TOKEN,
        AIE_MATRIX_HTTP_BASE_URL: WORLD_API_BASE,
        CATALOG_FILE_PATH: path.join(repoRoot, "server/agent-host/catalog.json"),
        AGENT_HOST_PORT: String(AGENT_HOST_PORT),
        AGENT_HOST_DISABLE_COLYSEUS_BRIDGE: "1",
      },
      stdio: "ignore",
    });

    await waitUrl(`${AGENT_HOST_BASE}/health`);

    randomAgent = spawn("node", ["ghosts/random-agent/dist/agent.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_HOST_TOKEN: DEV_TOKEN,
        AGENT_HOST_URL: AGENT_HOST_BASE,
        AGENT_PORT: String(RANDOM_AGENT_PORT),
        RANDOM_AGENT_PUBLIC_BASE_URL: `http://127.0.0.1:${RANDOM_AGENT_PORT}`,
        RANDOM_AGENT_MOVE_MS: "1000",
        // Deterministic agentId for spawn URL — avoids hostname-dependent lookup
        HOSTNAME: E2E_AGENT_HOSTNAME,
      },
      stdio: "ignore",
    });

    await waitUrl(`http://127.0.0.1:${RANDOM_AGENT_PORT}/.well-known/agent-card.json`);
    // Wait for random-agent to self-register with agent-host catalog
    await waitUrl(`${AGENT_HOST_BASE}/v1/catalog/${E2E_AGENT_ID}`, 30_000);

    // Use the registry API to obtain a valid world-api ghost credential
    const houseRes = await fetch(`${WORLD_API_BASE}/registry/houses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "e2e-agent-host" }),
    });
    if (!houseRes.ok) throw new Error(`/registry/houses failed (${houseRes.status}): ${await houseRes.text()}`);
    const { agentHostId } = await houseRes.json() as { agentHostId: string };

    const caretakerRes = await fetch(`${WORLD_API_BASE}/registry/caretakers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-test-walker" }),
    });
    if (!caretakerRes.ok) throw new Error(`/registry/caretakers failed (${caretakerRes.status}): ${await caretakerRes.text()}`);
    const { caretakerId } = await caretakerRes.json() as { caretakerId: string };

    const adoptRes = await fetch(`${WORLD_API_BASE}/registry/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caretakerId, agentHostId }),
    });
    if (!adoptRes.ok) throw new Error(`/registry/adopt failed (${adoptRes.status}): ${await adoptRes.text()}`);
    const { ghostId, credential } = await adoptRes.json() as {
      ghostId: string;
      credential: { token: string; worldApiBaseUrl: string };
    };

    const spawnRes = await fetch(`${AGENT_HOST_BASE}/v1/sessions/spawn/${E2E_AGENT_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEV_TOKEN}`,
      },
      body: JSON.stringify({
        ghostId,
        credential: { token: credential.token, worldApiBaseUrl: credential.worldApiBaseUrl },
      }),
    });
    if (!spawnRes.ok) throw new Error(`spawn failed (${spawnRes.status}): ${await spawnRes.text()}`);
    const { sessionId } = await spawnRes.json() as { sessionId: string };
    activeSessionId = sessionId;
  });

  test.afterAll(async () => {
    if (activeSessionId) {
      await fetch(`${AGENT_HOST_BASE}/v1/sessions/${activeSessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      }).catch(() => {});
    }
    for (const proc of [agentHost, randomAgent]) {
      if (proc?.pid) {
        proc.kill("SIGTERM");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const proc of [agentHost, randomAgent]) {
      if (proc?.pid) {
        proc.kill("SIGKILL");
      }
    }
  });

  test.beforeEach(({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        process.stderr.write(`[page] ${msg.text()}\n`);
      }
    });
  });

  test("loads default URL without debug (canvas, no fatal bootstrap error)", async ({ page, baseURL }) => {
    await page.goto(`${spectatorOriginFromConfig(baseURL)}/`);
    await expect(page.locator("#app canvas")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#app")).not.toContainText("Spectator failed to start");

    const hookMissing = await page.evaluate(() => {
      const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
      return w.__aieSpectatorE2e === undefined;
    });
    expect(hookMissing).toBe(true);
  });

  test("Phaser ghost markers match synced ghostTiles (regression: joinById root schema)", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${spectatorOriginFromConfig(baseURL)}/?debug=1`);
    await expect(page.locator("#app canvas")).toBeVisible({ timeout: 60_000 });

    await page.waitForFunction(
      () => {
        const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
        const e = w.__aieSpectatorE2e;
        return (
          e !== undefined &&
          e.ghostTilesSize() >= 1 &&
          e.tileCoordsSize() >= 1 &&
          e.ghostMarkerCount() >= 1 &&
          e.ghostMarkerCount() === e.ghostTilesSize()
        );
      },
      { timeout: 45_000 },
    );

    const snapshot = await page.evaluate(() => {
      const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
      const e = w.__aieSpectatorE2e;
      return {
        ghosts: e?.ghostTilesSize() ?? -1,
        tiles: e?.tileCoordsSize() ?? -1,
        markers: e?.ghostMarkerCount() ?? -1,
      };
    });
    expect(snapshot.ghosts).toBeGreaterThanOrEqual(1);
    expect(snapshot.tiles).toBeGreaterThanOrEqual(1);
    expect(snapshot.markers).toBe(snapshot.ghosts);
  });

  test("ghost walk produces multiple Colyseus state syncs (stateSyncCount)", async ({ page, baseURL }) => {
    await page.goto(`${spectatorOriginFromConfig(baseURL)}/?debug=1`);
    await expect(page.locator("#app canvas")).toBeVisible({ timeout: 60_000 });

    await page.waitForFunction(
      () => {
        const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
        const e = w.__aieSpectatorE2e;
        return e !== undefined && e.ghostTilesSize() >= 1 && e.tileCoordsSize() >= 1;
      },
      { timeout: 45_000 },
    );

    await page.waitForFunction(
      () => {
        const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
        const e = w.__aieSpectatorE2e;
        return e !== undefined && e.stateSyncCount() >= 5;
      },
      { timeout: 45_000 },
    );

    const syncCount = await page.evaluate(() => {
      const w = window as unknown as { __aieSpectatorE2e?: SpectatorE2eHook };
      return w.__aieSpectatorE2e?.stateSyncCount() ?? -1;
    });
    expect(syncCount).toBeGreaterThanOrEqual(5);
  });
});
