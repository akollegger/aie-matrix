import jwt from "jsonwebtoken";
import { Effect } from "effect";
import { JwtMissingGhostClaims, JwtMissingSub, JwtVerificationFailed, type JwtError } from "./jwt-errors.js";

const DEV_FALLBACK =
  "aie-matrix-dev-secret-change-me-poc-only-do-not-ship";

export function getJwtSecret(): string {
  return process.env.AIE_MATRIX_DEV_JWT_SECRET ?? DEV_FALLBACK;
}

export interface GhostClaims {
  sub: string;
  ghostId: string;
  caretakerId?: string;
  agentHostId?: string;
}

export function mintGhostToken(claims: GhostClaims, ttlSeconds = 60 * 60 * 8): string {
  return jwt.sign(
    {
      ghostId: claims.ghostId,
      ...(claims.caretakerId !== undefined ? { caretakerId: claims.caretakerId } : {}),
      ...(claims.agentHostId !== undefined ? { agentHostId: claims.agentHostId } : {}),
    },
    getJwtSecret(),
    {
      subject: claims.sub,
      expiresIn: ttlSeconds,
    },
  );
}

export function verifyGhostToken(token: string): Effect.Effect<GhostClaims, JwtError> {
  return Effect.gen(function* () {
    const decoded = yield* Effect.try({
      try: () => jwt.verify(token, getJwtSecret()) as jwt.JwtPayload,
      catch: (e) =>
        new JwtVerificationFailed({
          message: e instanceof Error ? e.message : String(e),
        }),
    });
    if (typeof decoded.sub !== "string") {
      return yield* Effect.fail(new JwtMissingSub({ message: "JWT missing sub" }));
    }
    if (typeof decoded.ghostId !== "string") {
      return yield* Effect.fail(
        new JwtMissingGhostClaims({
          message: "JWT missing ghostId claim",
        }),
      );
    }
    return {
      sub: decoded.sub,
      ghostId: decoded.ghostId,
      caretakerId: typeof decoded.caretakerId === "string" ? decoded.caretakerId : undefined,
      agentHostId: typeof decoded.agentHostId === "string" ? decoded.agentHostId : undefined,
    };
  });
}
