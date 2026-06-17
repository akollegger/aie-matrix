import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { GhostCredential } from "./adopt.js";

const MCP_URL_OVERRIDE = (process.env["AIE_MATRIX_MCP_URL"] ?? "").trim();

export function makeClient(credential: GhostCredential): GhostMcpClient {
  return new GhostMcpClient({
    worldApiBaseUrl: MCP_URL_OVERRIDE || credential.worldApiBaseUrl,
    token: credential.token,
  });
}
