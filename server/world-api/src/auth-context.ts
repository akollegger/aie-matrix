import type { IncomingMessage } from "node:http";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Effect, Exit, pipe } from "effect";
import {
  JwtMissingGhostClaims,
  JwtMissingSub,
  JwtVerificationFailed,
  verifyGhostToken,
  type JwtError,
} from "@aie-matrix/server-auth";
import {
  AuthExpiredToken,
  AuthInvalidToken,
  AuthMalformedClaims,
  AuthMissingCredentials,
  type AuthError,
} from "./auth-errors.js";

declare module "node:http" {
  interface IncomingMessage {
    /** Populated by the combined server before MCP Streamable HTTP handling. */
    auth?: AuthInfo;
  }
}

function jwtErrorToAuthError(err: JwtError): AuthError {
  if (err instanceof JwtMissingSub || err instanceof JwtMissingGhostClaims) {
    return new AuthMalformedClaims({ message: err.message });
  }
  if (err instanceof JwtVerificationFailed) {
    const msg = err.message.toLowerCase();
    if (msg.includes("expired")) {
      return new AuthExpiredToken({ message: err.message });
    }
    return new AuthInvalidToken({ message: err.message });
  }
  return new AuthInvalidToken({ message: String(err) });
}

/**
 * Validates `Authorization: Bearer` as a ghost session JWT and attaches MCP `AuthInfo`.
 */
export function authenticateGhostRequestEffect(
  req: IncomingMessage,
): Effect.Effect<AuthInfo, AuthError> {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    return Effect.fail(new AuthMissingCredentials({ message: "Missing Authorization bearer token" }));
  }
  const token = raw.slice("Bearer ".length).trim();
  if (!token) {
    return Effect.fail(new AuthMissingCredentials({ message: "Empty bearer token" }));
  }
  return pipe(
    verifyGhostToken(token),
    Effect.mapError(jwtErrorToAuthError),
    Effect.map((claims) => ({
      token,
      clientId: claims.ghostId,
      scopes: [] as string[],
      extra: {
        ghostId: claims.ghostId,
        caretakerId: claims.caretakerId,
        ghostHouseId: claims.ghostHouseId,
      },
    })),
  );
}

/** Legacy sync helper for callers not yet on Effect (MCP tool handlers). */
export function authenticateGhostRequest(req: IncomingMessage): AuthInfo | undefined {
  const exit = Effect.runSyncExit(authenticateGhostRequestEffect(req));
  return Exit.isSuccess(exit) ? exit.value : undefined;
}

export function requireGhostAuthEffect(req: IncomingMessage): Effect.Effect<AuthInfo, AuthError> {
  return authenticateGhostRequestEffect(req);
}

export function requireGhostAuth(req: IncomingMessage): AuthInfo {
  return Effect.runSync(requireGhostAuthEffect(req));
}

export function ghostIdsFromAuthEffect(
  auth: AuthInfo,
): Effect.Effect<{ ghostId: string; caretakerId: string }, AuthError> {
  const extra = auth.extra as { ghostId?: string; caretakerId?: string } | undefined;
  const ghostId = extra?.ghostId ?? auth.clientId;
  const caretakerId = extra?.caretakerId;
  if (!ghostId || !caretakerId) {
    return Effect.fail(new AuthMalformedClaims({ message: "Malformed ghost auth context" }));
  }
  return Effect.succeed({ ghostId, caretakerId });
}

/** Legacy sync helper for MCP tool handlers (try/catch wraps failures). */
export function ghostIdsFromAuth(auth: AuthInfo): { ghostId: string; caretakerId: string } {
  return Effect.runSync(ghostIdsFromAuthEffect(auth));
}
