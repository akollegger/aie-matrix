import { Data, Match, pipe } from "effect";

/** --- Auth (401, IC-001) --- */

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

/** --- Registry (409, IC-001) — `error` field matches legacy codes verbatim --- */

export class RegistryUnknownCaretaker extends Data.TaggedError("RegistryError.UnknownCaretaker")<{
  readonly message: string;
}> {}

export class RegistryUnknownGhostHouse extends Data.TaggedError("RegistryError.UnknownGhostHouse")<{
  readonly message: string;
}> {}

export class RegistryCaretakerAlreadyHasGhost extends Data.TaggedError(
  "RegistryError.CaretakerAlreadyHasGhost",
)<{
  readonly message: string;
}> {}

export type RegistryError =
  | RegistryUnknownCaretaker
  | RegistryUnknownGhostHouse
  | RegistryCaretakerAlreadyHasGhost;

/** --- World API / MCP domain (IC-001) --- */

export class WorldApiNoPosition extends Data.TaggedError("WorldApiError.NoPosition")<{
  readonly ghostId: string;
}> {}

export class WorldApiUnknownCell extends Data.TaggedError("WorldApiError.UnknownCell")<{
  readonly cellId: string;
}> {}

export class WorldApiMapIntegrity extends Data.TaggedError("WorldApiError.MapIntegrity")<{
  readonly message: string;
}> {}

export class WorldApiMovementBlocked extends Data.TaggedError("WorldApiError.MovementBlocked")<{
  readonly message: string;
}> {}

export type WorldApiError =
  | WorldApiNoPosition
  | WorldApiUnknownCell
  | WorldApiMapIntegrity
  | WorldApiMovementBlocked;

/** --- Bridge readiness (503, IC-001) --- */

export class WorldBridgeNotReady extends Data.TaggedError("WorldBridgeError.NotReady")<{
  readonly message?: string;
}> {}

export class WorldBridgeNoNavigableCells extends Data.TaggedError("WorldBridgeError.NoNavigableCells")<{
  readonly message: string;
}> {}

export type WorldBridgeError = WorldBridgeNotReady | WorldBridgeNoNavigableCells;

/** --- MCP handler defects (500, IC-001) --- */

export class McpHandlerError extends Data.TaggedError("McpHandlerError")<{
  readonly message: string;
}> {}

/** Union matched exhaustively by {@link errorToResponse}. */
export type HttpMappingError =
  | AuthError
  | RegistryError
  | WorldApiError
  | WorldBridgeError
  | McpHandlerError;

function authErrorBody(error: AuthError): string {
  const variant = error._tag.slice("AuthError.".length);
  return JSON.stringify({
    error: "AUTH_ERROR",
    message: error.message ?? error._tag,
    variant,
  });
}

function registryCode(error: RegistryError): string {
  return error._tag.slice("RegistryError.".length);
}

/**
 * Maps typed domain errors to HTTP status + JSON body (IC-001).
 * Uses `Match.tag` branches with `Match.exhaustive` so new error `_tag`s fail compilation.
 */
export function errorToResponse(error: HttpMappingError): { status: number; body: string } {
  return pipe(
    Match.type<HttpMappingError>(),
    Match.tag(
      "AuthError.MissingCredentials",
      "AuthError.InvalidToken",
      "AuthError.MalformedClaims",
      "AuthError.ExpiredToken",
      (e) => ({ status: 401, body: authErrorBody(e) }),
    ),
    Match.tag(
      "RegistryError.UnknownCaretaker",
      "RegistryError.UnknownGhostHouse",
      "RegistryError.CaretakerAlreadyHasGhost",
      (e) => ({
        status: 409,
        body: JSON.stringify({ error: registryCode(e), message: e.message }),
      }),
    ),
    Match.tag("WorldApiError.NoPosition", (e) => ({
      status: 404,
      body: JSON.stringify({ error: "NO_POSITION", ghostId: e.ghostId }),
    })),
    Match.tag("WorldApiError.UnknownCell", (e) => ({
      status: 404,
      body: JSON.stringify({ error: "UNKNOWN_CELL", cellId: e.cellId }),
    })),
    Match.tag("WorldApiError.MovementBlocked", (e) => ({
      status: 422,
      body: JSON.stringify({ error: "MOVEMENT_BLOCKED", message: e.message }),
    })),
    Match.tag("WorldApiError.MapIntegrity", (e) => ({
      status: 500,
      body: JSON.stringify({ error: "MAP_INTEGRITY", message: e.message }),
    })),
    Match.tag("WorldBridgeError.NotReady", () => ({
      status: 503,
      body: JSON.stringify({
        error: "STARTING",
        message: "World is still initializing",
      }),
    })),
    Match.tag("WorldBridgeError.NoNavigableCells", (e) => ({
      status: 503,
      body: JSON.stringify({ error: "NO_NAVIGABLE_CELLS", message: e.message }),
    })),
    Match.tag("McpHandlerError", (e) => ({
      status: 500,
      body: JSON.stringify({ error: "MCP_HANDLER", message: e.message }),
    })),
    Match.exhaustive,
  )(error);
}
