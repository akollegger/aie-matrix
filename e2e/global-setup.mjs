import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** E2E expects `spectatorDebugEnabled()` URL-only; strip dev-only Vite flags from the preview bundle. */
const e2eClientEnv = {
  ...process.env,
  VITE_SPECTATOR_DEBUG: "",
};

/**
 * Always: random-house binary + Phaser map assets (tests spawn the ghost walker).
 * With `E2E_AUTOSTART=1`: `dev-stack.mjs` builds the client before Vite preview (see Playwright `webServer` order).
 */
export default async function globalSetup() {
  execSync("pnpm --filter @aie-matrix/ghost-random-house build", {
    cwd: root,
    stdio: "inherit",
  });
  execSync("pnpm --filter @aie-matrix/client-phaser run copy-map-assets", {
    cwd: root,
    stdio: "inherit",
    env: e2eClientEnv,
  });
}
