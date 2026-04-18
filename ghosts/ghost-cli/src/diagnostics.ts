import {
  EnvMissingToken,
  EnvMissingUrl,
  GhostNotFound,
  HostNotFound,
  McpEndpointNotFound,
  ServerUnreachable,
  TokenRejected,
  UnknownNetworkError,
  UrlMissingMcpSuffix,
  type PreFlightError,
} from "./preflight/errors.js";

export function formatDiagnostic(e: PreFlightError): { readonly message: string; readonly remedy: string } {
  if (e instanceof EnvMissingToken) {
    if (e.inRepoRoot) {
      return {
        message: "GHOST_TOKEN is not set.",
        remedy: "Run `pnpm run ghost:register` and add `GHOST_TOKEN=…` to `.env` at the repo root.",
      };
    }
    if (e.workspaceRoot !== undefined) {
      return {
        message: "GHOST_TOKEN is not set.",
        remedy: `cd ${JSON.stringify(e.workspaceRoot)} && pnpm run ghost:register`,
      };
    }
    return {
      message: "GHOST_TOKEN is not set.",
      remedy: "cd into your aie-matrix clone, then run `pnpm run ghost:register` and set GHOST_TOKEN.",
    };
  }
  if (e instanceof EnvMissingUrl) {
    return {
      message: "WORLD_API_URL is not set.",
      remedy: e.hasEnvFile
        ? "Add `WORLD_API_URL=http://127.0.0.1:8787/mcp` to `.env` in the repo root."
        : "Set `WORLD_API_URL=http://127.0.0.1:8787/mcp` (or your deployed MCP URL) in the environment.",
    };
  }
  if (e instanceof UrlMissingMcpSuffix) {
    return {
      message: `WORLD_API_URL must end with /mcp (got ${e.url}).`,
      remedy: "Try `WORLD_API_URL=http://127.0.0.1:8787/mcp` for the default dev server.",
    };
  }
  if (e instanceof ServerUnreachable) {
    if (e.errno === "ECONNREFUSED" && e.port === 8787) {
      return {
        message: `The world server isn't running (connection refused on ${e.host}:${e.port}).`,
        remedy: "Run `pnpm run server` from the repo root.",
      };
    }
    if (e.errno === "ECONNREFUSED") {
      return {
        message: `Nothing is listening on ${e.host}:${e.port} (${e.errno}).`,
        remedy: "Run `pnpm run server` from the repo root, then set `WORLD_API_URL` to the `/mcp` URL for that server's listen host and port.",
      };
    }
    return {
      message: `Cannot reach the world server at ${e.host}:${e.port} (${e.errno}).`,
      remedy: "Run `pnpm run server` from the repo root and check the listen address in server logs.",
    };
  }
  if (e instanceof HostNotFound) {
    return {
      message: `The hostname "${e.host}" cannot be resolved (DNS lookup failed).`,
      remedy: "Set `WORLD_API_URL` to a resolvable host (for local dev use `127.0.0.1`).",
    };
  }
  if (e instanceof McpEndpointNotFound) {
    const originOk =
      e.originStatus !== undefined && e.originStatus >= 200 && e.originStatus < 300;
    if (originOk) {
      return {
        message: `The HTTP server is up (origin returned ${e.originStatus}), but GET on the MCP path returned 404.`,
        remedy: "Set `WORLD_API_URL` to the Streamable HTTP MCP URL ending in `/mcp` (try `http://127.0.0.1:8787/mcp`).",
      };
    }
    return {
      message: `Reached ${e.url}, but the MCP route was not found (404).`,
      remedy: "Set `WORLD_API_URL` to the Streamable HTTP MCP URL ending in `/mcp`.",
    };
  }
  if (e instanceof TokenRejected) {
    return {
      message: "The ghost session token was rejected by the server.",
      remedy: "Run `pnpm run ghost:register` again to adopt a fresh ghost and update GHOST_TOKEN.",
    };
  }
  if (e instanceof GhostNotFound) {
    return {
      message: "The authenticated ghost no longer exists in the world (evicted or stale session).",
      remedy: "Run `pnpm run ghost:register` to adopt a ghost again.",
    };
  }
  if (e instanceof UnknownNetworkError) {
    return {
      message: `Unexpected network error while contacting ${e.url}: ${e.detail}. Check the world API process logs on the machine running the server.`,
      remedy: "",
    };
  }
  const _never: never = e;
  return _never;
}

/** IC-005 — configuration (1), infrastructure (2), authentication (3). */
export function toExitCode(e: PreFlightError): 1 | 2 | 3 {
  if (
    e instanceof EnvMissingToken ||
    e instanceof EnvMissingUrl ||
    e instanceof UrlMissingMcpSuffix
  ) {
    return 1;
  }
  if (
    e instanceof ServerUnreachable ||
    e instanceof HostNotFound ||
    e instanceof McpEndpointNotFound ||
    e instanceof UnknownNetworkError
  ) {
    return 2;
  }
  if (e instanceof TokenRejected || e instanceof GhostNotFound) {
    return 3;
  }
  const _never: never = e;
  return _never;
}
