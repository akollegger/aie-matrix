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
import { Match, pipe } from "effect";

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
      "RegistryError.UNKNOWN_CARETAKER",
      "RegistryError.UNKNOWN_GHOST_HOUSE",
      "RegistryError.CARETAKER_ALREADY_HAS_GHOST",
      (e) => ({
        status: e.httpStatus,
        body: JSON.stringify({ error: e.code, message: e.message }),
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
