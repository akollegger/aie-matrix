import { Data } from "effect";

export class JwtMissingSub extends Data.TaggedError("JwtError.MissingSub")<{
  readonly message?: string;
}> {}

export class JwtMissingGhostClaims extends Data.TaggedError("JwtError.MissingGhostClaims")<{
  readonly message?: string;
}> {}

export class JwtVerificationFailed extends Data.TaggedError("JwtError.VerificationFailed")<{
  readonly message: string;
}> {}

export type JwtError = JwtMissingSub | JwtMissingGhostClaims | JwtVerificationFailed;
