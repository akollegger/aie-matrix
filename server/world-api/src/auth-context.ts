import type { IncomingMessage } from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { verifyGhostToken } from "@aie-matrix/server-auth";

declare module "node:http" {
  interface IncomingMessage {
    /** Populated by the combined server before MCP Streamable HTTP handling. */
    auth?: AuthInfo;
  }
}

/**
 * Validates `Authorization: Bearer` as a ghost session JWT and attaches MCP `AuthInfo`.
 * Returns `undefined` when the header is missing or invalid.
 */
export function authenticateGhostRequest(req: IncomingMessage): AuthInfo | undefined {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = raw.slice("Bearer ".length).trim();
  if (!token) {
    return undefined;
  }
  try {
    const claims = verifyGhostToken(token);
    return {
      token,
      clientId: claims.ghostId,
      scopes: [],
      extra: { ghostId: claims.ghostId, caretakerId: claims.caretakerId },
    };
  } catch {
    return undefined;
  }
}

export function requireGhostAuth(req: IncomingMessage): AuthInfo {
  const auth = authenticateGhostRequest(req);
  if (!auth) {
    throw new Error("Missing or invalid ghost credentials");
  }
  return auth;
}

export function ghostIdsFromAuth(auth: AuthInfo): { ghostId: string; caretakerId: string } {
  const extra = auth.extra as { ghostId?: string; caretakerId?: string } | undefined;
  const ghostId = extra?.ghostId ?? auth.clientId;
  const caretakerId = extra?.caretakerId;
  if (!ghostId || !caretakerId) {
    throw new Error("Malformed ghost auth context");
  }
  return { ghostId, caretakerId };
}
