import { Data } from "effect";

export class AuthMissingCredentials extends Data.TaggedError("AuthError.MissingCredentials")<{
  readonly message?: string;
}> {}

export class AuthInvalidToken extends Data.TaggedError("AuthError.InvalidToken")<{
  readonly message?: string;
}> {}

export class AuthMalformedClaims extends Data.TaggedError("AuthError.MalformedClaims")<{
  readonly message?: string;
}> {}

export class AuthExpiredToken extends Data.TaggedError("AuthError.ExpiredToken")<{
  readonly message?: string;
}> {}

export type AuthError =
  | AuthMissingCredentials
  | AuthInvalidToken
  | AuthMalformedClaims
  | AuthExpiredToken;
