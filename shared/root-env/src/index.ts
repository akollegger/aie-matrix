import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export { isEnvTruthy } from "./debug-env.js";

/**
 * Walks up from this package (or its compiled `dist/`) until `pnpm-workspace.yaml`
 * is found, then loads that directory’s `.env` and optional `.env.local` if present.
 *
 * `.env` does not override variables already set in the process environment (dotenv default).
 * `.env.local` is loaded second with `override: true` so its keys win over `.env` (still
 * not overriding the shell unless a key is only set via these files).
 */
export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const envPath = join(dir, ".env");
      const localPath = join(dir, ".env.local");
      if (existsSync(envPath)) {
        const result = config({ path: envPath });
        if (result.error) {
          console.warn(`[root-env] could not read ${envPath}: ${result.error.message}`);
        }
      }
      if (existsSync(localPath)) {
        const local = config({ path: localPath, override: true });
        if (local.error) {
          console.warn(`[root-env] could not read ${localPath}: ${local.error.message}`);
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      console.warn("[root-env] pnpm-workspace.yaml not found; skipping .env load");
      return;
    }
    dir = parent;
  }
}
