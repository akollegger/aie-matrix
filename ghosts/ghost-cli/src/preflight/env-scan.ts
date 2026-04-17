import { Effect } from "effect";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  EnvMissingToken,
  EnvMissingUrl,
  UrlMissingMcpSuffix,
  type PreFlightError,
} from "./errors.js";

function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export function detectRepoContext(cwd: string): {
  readonly inRepoRoot: boolean;
  readonly hasEnvFile: boolean;
} {
  const workspace = findWorkspaceRoot(cwd);
  if (!workspace) {
    return { inRepoRoot: false, hasEnvFile: false };
  }
  const hasEnvFile = existsSync(join(workspace, ".env"));
  const inRepoRoot = resolve(cwd) === resolve(workspace);
  return { inRepoRoot, hasEnvFile };
}

function urlHasMcpSuffix(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/mcp" || u.pathname.endsWith("/mcp");
  } catch {
    return false;
  }
}

/** Phase 1 — configuration presence and URL shape (no network). */
export const runEnvScan = (
  input: {
    readonly token: string;
    readonly url: string;
  },
  cwd: string = process.cwd(),
): Effect.Effect<void, PreFlightError> =>
  Effect.gen(function* () {
    const ctx = detectRepoContext(cwd);
    const token = input.token.trim();
    if (!token) {
      return yield* Effect.fail(new EnvMissingToken({ inRepoRoot: ctx.inRepoRoot }));
    }
    const url = input.url.trim();
    if (!url) {
      return yield* Effect.fail(new EnvMissingUrl({ hasEnvFile: ctx.hasEnvFile }));
    }
    if (!urlHasMcpSuffix(url)) {
      return yield* Effect.fail(new UrlMissingMcpSuffix({ url }));
    }
    try {
      new URL(url);
    } catch {
      return yield* Effect.fail(new UrlMissingMcpSuffix({ url }));
    }
  });
