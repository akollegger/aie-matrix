import type {
  RegistryCaretakerAlreadyHasGhost,
  RegistryUnknownCaretaker,
  RegistryUnknownGhostHouse,
} from "@aie-matrix/server-registry";
import type {
  AuthError,
  McpHandlerError,
  WorldApiError,
  WorldBridgeError,
} from "@aie-matrix/server-world-api";

export {
  AuthExpiredToken,
  AuthInvalidToken,
  AuthMalformedClaims,
  AuthMissingCredentials,
  type AuthError,
} from "@aie-matrix/server-world-api";
export {
  RegistryCaretakerAlreadyHasGhost,
  RegistryUnknownCaretaker,
  RegistryUnknownGhostHouse,
} from "@aie-matrix/server-registry";
export type { RegistryHttpError as RegistryError } from "@aie-matrix/server-registry";
export {
  McpHandlerError,
  WorldBridgeNoNavigableCells,
  WorldBridgeNotReady,
  type WorldBridgeError,
} from "@aie-matrix/server-world-api";
export {
  WorldApiMapIntegrity,
  WorldApiMovementBlocked,
  WorldApiNoPosition,
  WorldApiUnknownCell,
  type WorldApiError,
} from "@aie-matrix/server-world-api";

type RegistryErrorUnion = RegistryUnknownCaretaker | RegistryUnknownGhostHouse | RegistryCaretakerAlreadyHasGhost;

/** Union matched exhaustively by {@link errorToResponse}. */
export type HttpMappingError =
  | AuthError
  | RegistryErrorUnion
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

function assertNever(x: never): never {
  throw new Error(`Unhandled HttpMappingError tag: ${JSON.stringify(x)}`);
}

/**
 * Maps typed domain errors to HTTP status + JSON body (IC-001).
 * Uses `_tag` switching with `assertNever` so new {@link HttpMappingError} variants fail compilation.
 */
export function errorToResponse(error: HttpMappingError): { status: number; body: string } {
  switch (error._tag) {
    case "AuthError.MissingCredentials":
    case "AuthError.InvalidToken":
    case "AuthError.MalformedClaims":
    case "AuthError.ExpiredToken":
      return { status: 401, body: authErrorBody(error) };
    case "RegistryError.UNKNOWN_CARETAKER":
    case "RegistryError.UNKNOWN_GHOST_HOUSE":
    case "RegistryError.CARETAKER_ALREADY_HAS_GHOST":
      return {
        status: error.httpStatus,
        body: JSON.stringify({ error: error.code, message: error.message }),
      };
    case "WorldApiError.NoPosition":
      return {
        status: 404,
        body: JSON.stringify({ error: "NO_POSITION", ghostId: error.ghostId }),
      };
    case "WorldApiError.UnknownCell":
      return {
        status: 404,
        body: JSON.stringify({ error: "UNKNOWN_CELL", cellId: error.cellId }),
      };
    case "WorldApiError.MovementBlocked":
      return {
        status: 422,
        body: JSON.stringify({
          error: "MOVEMENT_BLOCKED",
          message: error.message,
          ...(error.code !== undefined ? { code: error.code } : {}),
        }),
      };
    case "WorldApiError.MapIntegrity":
      return {
        status: 500,
        body: JSON.stringify({ error: "MAP_INTEGRITY", message: error.message }),
      };
    case "WorldBridgeError.NotReady":
      return {
        status: 503,
        body: JSON.stringify({
          error: "STARTING",
          message: "World is still initializing",
        }),
      };
    case "WorldBridgeError.NoNavigableCells":
      return {
        status: 503,
        body: JSON.stringify({ error: "NO_NAVIGABLE_CELLS", message: error.message }),
      };
    case "McpHandlerError":
      return {
        status: 500,
        body: JSON.stringify({ error: "MCP_HANDLER", message: error.message }),
      };
    default: {
      // `HttpMappingError` spans multiple workspace packages; `switch (error._tag)` can leave the
      // default branch typed as `any` in composite builds, which breaks `assertNever` inference.
      return assertNever(error as never);
    }
  }
}
