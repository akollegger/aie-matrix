import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { GhostCredential } from "./adopt.js";

export function makeClient(credential: GhostCredential): GhostMcpClient {
  return new GhostMcpClient({
    worldApiBaseUrl: credential.worldApiBaseUrl,
    token: credential.token,
  });
}
