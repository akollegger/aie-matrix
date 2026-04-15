# IC-001: Error-to-HTTP Status Mapping Contract

**Feature**: Effect-ts Transition (`002-effect-ts-transition`)  
**Referenced by**: spec.md § IC-001  
**Status**: Draft

This contract defines how typed domain errors produced by the Effect pipeline are translated into HTTP responses. It is the boundary between the Effect error channel and the HTTP transport layer.

---

## Contract

All HTTP response mapping happens at the request handler boundary, not inside domain logic. Domain functions yield typed errors; the HTTP adapter translates them.

### Error-to-Status Table

| Error Type | `_tag` | HTTP Status | Response Body Shape |
|---|---|---|---|
| `AuthMissingCredentials` | `"AuthError.MissingCredentials"` | 401 | `{ error: "AUTH_ERROR", message: string, variant: string }` |
| `AuthInvalidToken` | `"AuthError.InvalidToken"` | 401 | `{ error: "AUTH_ERROR", message: string, variant: string }` |
| `AuthMalformedClaims` | `"AuthError.MalformedClaims"` | 401 | `{ error: "AUTH_ERROR", message: string, variant: string }` |
| `AuthExpiredToken` | `"AuthError.ExpiredToken"` | 401 | `{ error: "AUTH_ERROR", message: string, variant: string }` |
| `RegistryUnknownCaretaker` | `"RegistryError.UNKNOWN_CARETAKER"` | 404 | `{ error: "UNKNOWN_CARETAKER", message: string }` |
| `RegistryUnknownGhostHouse` | `"RegistryError.UNKNOWN_GHOST_HOUSE"` | 404 | `{ error: "UNKNOWN_GHOST_HOUSE", message: string }` |
| `RegistryCaretakerAlreadyHasGhost` | `"RegistryError.CARETAKER_ALREADY_HAS_GHOST"` | 409 | `{ error: "CARETAKER_ALREADY_HAS_GHOST", message: string }` |
| `WorldApiNoPosition` | `"WorldApiError.NoPosition"` | 404 | `{ error: "NO_POSITION", ghostId: string }` |
| `WorldApiUnknownCell` | `"WorldApiError.UnknownCell"` | 404 | `{ error: "UNKNOWN_CELL", cellId: string }` |
| `WorldApiMovementBlocked` | `"WorldApiError.MovementBlocked"` | 422 | `{ error: "MOVEMENT_BLOCKED", message: string }` |
| `WorldApiMapIntegrity` | `"WorldApiError.MapIntegrity"` | 500 | `{ error: "MAP_INTEGRITY", message: string }` |
| `WorldBridgeNotReady` | `"WorldBridgeError.NotReady"` | 503 | `{ error: "STARTING", message: "World is still initializing" }` |
| `WorldBridgeNoNavigableCells` | `"WorldBridgeError.NoNavigableCells"` | 503 | `{ error: "NO_NAVIGABLE_CELLS", message: string }` |
| `McpHandlerError` | `"McpHandlerError"` | 500 | `{ error: "MCP_HANDLER", message: string }` |

### MCP Tool Error Mapping

MCP tool handlers (`go`, `whereami`, `look`, `exits`, `whoami`) use the MCP SDK's `CallToolResult` response format rather than HTTP status codes. The mapping at the MCP boundary is:

| Error Type | MCP Result | `isError` |
|---|---|---|
| `WorldApiError` (any) | `{ content: [{ type: "text", text: JSON.stringify({ error: code, ...fields }) }] }` | `true` |
| `AuthError` (any) | `{ content: [{ type: "text", text: JSON.stringify({ error: "AUTH_ERROR", message: string, variant: string }) }] }` | `true` |
| Success | `{ content: [{ type: "text", text: JSON.stringify(result) }] }` | `false` |

The payload shapes for `WorldApiError` follow the same `error` codes as the HTTP table above (e.g. `{ error: "NO_POSITION", ghostId }`, `{ error: "UNKNOWN_CELL", cellId }`, etc.).

The outer HTTP `/mcp` endpoint itself still uses the error-to-status table for non-MCP-tool errors (e.g., body parse failures, bridge not ready).

---

## Implementation Notes

- The mapping function (`errorToResponse`) lives in `server/src/errors.ts` alongside the error type definitions.
- It uses `Match.tag` with `Match.exhaustive` so the TypeScript compiler enforces completeness — adding a new error type causes a compile error if the mapping is not updated.
- The CORS headers are always added by the HTTP adapter layer; the mapping function only returns `{ status, body }`.
- Existing `RegistryConflictError` codes (`UnknownCaretaker`, `UnknownGhostHouse`, `CaretakerAlreadyHasGhost`) are preserved verbatim in `RegistryError.code` to avoid breaking existing ghost client error handling.

---

## Contract Change Policy

Changes to this mapping that affect HTTP status codes or error body shapes are **breaking changes** for ghost clients. Any such change requires:
1. A proposal (ADR or PR description) documenting the reason.
2. Version bump in the affected package.
3. Update to `@aie-matrix/ghost-tck` TCK tests.
