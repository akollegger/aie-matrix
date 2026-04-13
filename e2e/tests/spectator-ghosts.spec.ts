import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

  test("ghostTiles syncs after random-house adopts (regression: joinById root schema)", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        process.stderr.write(`[page] ${msg.text()}\n`);
      }
    });

    await page.goto("/?debug=1");
    await expect(page.locator("#app canvas")).toBeVisible({ timeout: 60_000 });

    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __aieSpectatorE2e?: { ghostTilesSize(): number; tileCoordsSize(): number };
        };
        return (w.__aieSpectatorE2e?.ghostTilesSize() ?? 0) >= 1 && (w.__aieSpectatorE2e?.tileCoordsSize() ?? 0) >= 1;
      },
      { timeout: 45_000 },
    );

    const sizes = await page.evaluate(() => {
      const w = window as unknown as {
        __aieSpectatorE2e?: { ghostTilesSize(): number; tileCoordsSize(): number };
      };
      return {
        ghosts: w.__aieSpectatorE2e?.ghostTilesSize() ?? -1,
        tiles: w.__aieSpectatorE2e?.tileCoordsSize() ?? -1,
      };
    });
    expect(sizes.ghosts).toBeGreaterThanOrEqual(1);
    expect(sizes.tiles).toBeGreaterThanOrEqual(1);
  });
});
