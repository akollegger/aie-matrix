import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

/** Mirrors `SpectatorE2eHook` in `client/phaser` (debug / `?debug=1` only). */
type SpectatorE2eHook = {
  ghostTilesSize(): number;
  tileCoordsSize(): number;
  ghostMarkerCount(): number;
  stateSyncCount(): number;
};

test.describe.configure({ mode: "serial" });

test.describe("Phaser spectator + Colyseus ghostTiles", () => {
  let ghost: ChildProcess | undefined;

  test.beforeAll(async () => {
    ghost = spawn("node", ["ghosts/random-house/dist/index.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AIE_MATRIX_REGISTRY_BASE: "http://127.0.0.1:8787",
      },
      stdio: "ignore",
    });
    await new Promise((r) => setTimeout(r, 2500));
  });

  test.afterAll(async () => {
    if (ghost?.pid) {
      ghost.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      ghost.kill("SIGKILL");
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
