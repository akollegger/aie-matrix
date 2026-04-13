import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Always: random-house binary + Phaser map assets (tests spawn the ghost walker).
 * With `E2E_AUTOSTART=1`: production bundles for `server start` + `vite preview` (see `dev-stack.mjs`).
 */
export default async function globalSetup() {
  execSync("pnpm --filter @aie-matrix/ghost-random-house build", {
    cwd: root,
    stdio: "inherit",
  });
  execSync("pnpm --filter @aie-matrix/client-phaser run copy-map-assets", {
    cwd: root,
    stdio: "inherit",
  });
  if (process.env.E2E_AUTOSTART === "1") {
    execSync("pnpm --filter @aie-matrix/client-phaser build", {
      cwd: root,
      stdio: "inherit",
    });
    execSync("pnpm --filter @aie-matrix/server build", {
      cwd: root,
      stdio: "inherit",
    });
  }
}
