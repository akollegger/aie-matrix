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
    return {
      message: "GHOST_TOKEN is not set.",
      remedy: e.inRepoRoot
        ? "Run `pnpm run poc:ghost` from the repo root and copy the token into `.env` as GHOST_TOKEN=…"
        : "Change directory to the aie-matrix repo root, then run `pnpm run poc:ghost` and set GHOST_TOKEN.",
    };
  }
  if (e instanceof EnvMissingUrl) {
    return {
      message: "WORLD_API_URL is not set.",
      remedy: e.hasEnvFile
        ? "Add WORLD_API_URL=http://127.0.0.1:8787/mcp to your `.env` file in the repo root."
        : "Set WORLD_API_URL to your Streamable HTTP MCP endpoint (for example http://127.0.0.1:8787/mcp).",
    };
  }
  if (e instanceof UrlMissingMcpSuffix) {
    return {
      message: `WORLD_API_URL must end with /mcp (got ${e.url}).`,
      remedy: "Set WORLD_API_URL to the MCP path, for example http://127.0.0.1:8787/mcp",
    };
  }
  if (e instanceof ServerUnreachable) {
    return {
      message: `Cannot reach the world server at ${e.host}:${e.port} (${e.errno}).`,
      remedy: "Start the combined server with `pnpm run poc:server` from the repo root.",
    };
  }
  if (e instanceof HostNotFound) {
    return {
      message: `The hostname "${e.host}" could not be resolved.`,
      remedy: "Fix WORLD_API_URL to use a valid host (for local dev, try 127.0.0.1).",
    };
  }
  if (e instanceof McpEndpointNotFound) {
    return {
      message: `Reached an HTTP server at ${e.url}, but the MCP route was not found (404).`,
      remedy: "Point WORLD_API_URL at the Streamable HTTP MCP endpoint ending in /mcp.",
    };
  }
  if (e instanceof TokenRejected) {
    return {
      message: "The ghost session token was rejected by the server.",
      remedy: "Run `pnpm run poc:ghost` again to adopt a fresh ghost and update GHOST_TOKEN.",
    };
  }
  if (e instanceof GhostNotFound) {
    return {
      message: "The authenticated ghost no longer exists in the world (evicted or stale session).",
      remedy: "Run `pnpm run poc:ghost` to adopt a ghost again.",
    };
  }
  if (e instanceof UnknownNetworkError) {
    return {
      message: `Network error while contacting ${e.url}: ${e.detail}`,
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
