import type {
  RegistryCaretakerAlreadyHasGhost,
  RegistryUnknownCaretaker,
  RegistryUnknownGhostHouse,
} from "@aie-matrix/server-registry";
import type {
  AdminAuthError,
  AuthError,
  GcsError,
  LiveSessionAlreadyEndedError,
  LiveSessionMapNotPublishedError,
  LiveSessionNotFoundError,
  MapAlreadyActiveError,
  MapFileReadError,
  MapNotFoundError,
  MapPublishError,
  McpHandlerError,
  MultipartParseError,
  Neo4jNotConfiguredError,
  UnsupportedFormatError,
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
  GramParseError,
  MapFileReadError,
  MapIdCollisionError,
  MapNameMismatchError,
  MapNotFoundError,
  UnsupportedFormatError,
  WorldApiMapIntegrity,
  WorldApiMovementBlocked,
  WorldApiNoPosition,
  WorldApiItemNotCarriable,
  WorldApiItemNotCarrying,
  WorldApiItemNotFound,
  WorldApiItemNotHere,
  WorldApiTileFull,
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
  | McpHandlerError
  | MapNotFoundError
  | UnsupportedFormatError
  | MapFileReadError
  | MapPublishError
  | MapAlreadyActiveError
  | MultipartParseError
  | AdminAuthError
  | GcsError
  | Neo4jNotConfiguredError
  | LiveSessionNotFoundError
  | LiveSessionMapNotPublishedError
  | LiveSessionAlreadyEndedError;

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
    case "WorldApiError.ItemNotHere":
      return {
        status: 200,
        body: JSON.stringify({ ok: false, code: "NOT_HERE", reason: `Item "${error.itemRef}" is not on your current tile.` }),
      };
    case "WorldApiError.ItemNotFound":
      return {
        status: 200,
        body: JSON.stringify({ ok: false, code: "NOT_FOUND", reason: `Item "${error.itemRef}" does not exist.` }),
      };
    case "WorldApiError.ItemNotCarriable":
      return {
        status: 200,
        body: JSON.stringify({ ok: false, code: "NOT_CARRIABLE", reason: `Item "${error.itemRef}" cannot be picked up.` }),
      };
    case "WorldApiError.ItemNotCarrying":
      return {
        status: 200,
        body: JSON.stringify({ ok: false, code: "NOT_CARRYING", reason: `You are not carrying "${error.itemRef}".` }),
      };
    case "WorldApiError.TileFull":
      return {
        status: 200,
        body: JSON.stringify({ ok: false, code: "TILE_FULL", reason: `Tile ${error.h3Index} is at full capacity.` }),
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
    case "MapError.NotFound":
      return {
        status: 404,
        body: JSON.stringify({
          error: "MapNotFoundError",
          message: `Map '${error.mapId}' not found.`,
          mapId: error.mapId,
        }),
      };
    case "MapError.UnsupportedFormat":
      return {
        status: 400,
        body: JSON.stringify({
          error: "UnsupportedFormatError",
          message: `Unsupported format '${error.format}'. Supported formats: gram, tmj.`,
          requested: error.format,
        }),
      };
    case "MapError.FileRead":
      return {
        status: 500,
        body: JSON.stringify({
          error: "MapFileReadError",
          message: `Could not read map file: ${error.cause}`,
          path: error.path,
        }),
      };
    case "MapPublishError":
      return {
        status: 422,
        body: JSON.stringify({
          error: "MapPublishError",
          mapId: error.mapId,
          message: error.cause,
        }),
      };
    case "MapAlreadyActiveError":
      return {
        status: 409,
        body: JSON.stringify({
          error: "MapAlreadyActiveError",
          mapId: error.mapId,
          message: "Map is in use by an active session",
        }),
      };
    case "MultipartParseError":
      return {
        status: 400,
        body: JSON.stringify({
          error: "MultipartParseError",
          message: error.cause,
        }),
      };
    case "AdminAuthError":
      return {
        status: 401,
        body: JSON.stringify({
          error: "Unauthorized",
          message:
            error.reason === "missing"
              ? "Authorization header required"
              : "Invalid token",
        }),
      };
    case "GcsError":
      return {
        status: 500,
        body: JSON.stringify({
          error: "GcsError",
          message: error.message,
        }),
      };
    case "Neo4jNotConfiguredError":
      return {
        status: 503,
        body: JSON.stringify({
          error: "NEO4J_REQUIRED",
          message: "Map management requires Neo4j. Set NEO4J_URI or use AIE_MATRIX_MAP for local file mode.",
        }),
      };
    case "LiveSessionNotFoundError":
      return {
        status: 404,
        body: JSON.stringify({
          error: "LiveSessionNotFoundError",
          id: error.id,
          message: `Session '${error.id}' not found`,
        }),
      };
    case "LiveSessionMapNotPublishedError":
      return {
        status: 422,
        body: JSON.stringify({
          error: "LiveSessionMapNotPublishedError",
          mapId: error.mapId,
          message: `Map '${error.mapId}' is not published`,
        }),
      };
    case "LiveSessionAlreadyEndedError":
      return {
        status: 409,
        body: JSON.stringify({
          error: "LiveSessionAlreadyEndedError",
          id: error.id,
          message: "Session has already ended",
        }),
      };
    case "GhostInLimboError":
      return {
        status: 422,
        body: JSON.stringify({
          ok: false,
          code: "GHOST_IN_LIMBO",
          ghostId: error.ghostId,
          message: "Ghost is in limbo — the map it was on has been removed. Contact an admin to respawn.",
        }),
      };
    default: {
      // `HttpMappingError` spans multiple workspace packages; `switch (error._tag)` can leave the
      // default branch typed as `any` in composite builds, which breaks `assertNever` inference.
      return assertNever(error as never);
    }
  }
}
