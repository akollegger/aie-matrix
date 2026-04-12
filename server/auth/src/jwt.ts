import jwt from "jsonwebtoken";

const DEV_FALLBACK =
  "aie-matrix-dev-secret-change-me-poc-only-do-not-ship";

export function getJwtSecret(): string {
  return process.env.AIE_MATRIX_DEV_JWT_SECRET ?? DEV_FALLBACK;
}

export interface GhostClaims {
  sub: string;
  ghostId: string;
  caretakerId: string;
}

export function mintGhostToken(claims: GhostClaims, ttlSeconds = 60 * 60 * 8): string {
  return jwt.sign(
    { ghostId: claims.ghostId, caretakerId: claims.caretakerId },
    getJwtSecret(),
    {
      subject: claims.sub,
      expiresIn: ttlSeconds,
    },
  );
}

export function verifyGhostToken(token: string): GhostClaims {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  if (typeof decoded.sub !== "string") {
    throw new Error("JWT missing sub");
  }
  if (typeof decoded.ghostId !== "string" || typeof decoded.caretakerId !== "string") {
    throw new Error("JWT missing ghostId/caretakerId claims");
  }
  return {
    sub: decoded.sub,
    ghostId: decoded.ghostId,
    caretakerId: decoded.caretakerId,
  };
}
