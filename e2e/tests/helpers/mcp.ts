import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { GhostCredential } from "./adopt.js";

// Same host-reachable base the registry calls use (adopt.ts).
const BASE = process.env["WORLD_API_BASE"] ?? "http://127.0.0.1:8787";

export function makeClient(credential: GhostCredential): GhostMcpClient {
  // The server advertises its in-cluster MCP URL (e.g. http://server:8787/mcp),
  // which a host-side test runner cannot resolve. Rewrite the origin to BASE
  // while preserving the path. In default mode BASE already matches the advertised
  // origin, so this is a no-op; production in-cluster agents use the advertised
  // URL directly and are unaffected.
  const advertised = new URL(credential.worldApiBaseUrl);
  const base = new URL(BASE);
  advertised.protocol = base.protocol;
  advertised.host = base.host;
  return new GhostMcpClient({
    worldApiBaseUrl: advertised.toString(),
    token: credential.token,
  });
}
