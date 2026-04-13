import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Always: random-house binary + Phaser map assets (tests spawn the ghost walker).
 * With `E2E_AUTOSTART=1`: `dev-stack.mjs` builds client before Vite preview; server `prestart` compiles `dist/`. This hook still runs after webServer starts (Playwright order).
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
}
