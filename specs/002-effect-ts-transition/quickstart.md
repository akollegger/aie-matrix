# Quickstart: Effect-ts Transition

**Branch**: `002-effect-ts-transition`

This guide covers how to build, run, and verify the server after the Effect-ts migration.

---

## Prerequisites

- Node.js 24+ (see `.tool-versions`)
- pnpm 10+ (`npm install -g pnpm`)
- `.env` at repo root (copy `.env.example` if present, or set `AIE_MATRIX_HTTP_PORT=8787`)

---

## Install

```bash
pnpm install
```

The `effect` package is added to `server/package.json` as part of this feature. `pnpm install` from the repo root installs it.

---

## Run the server (dev mode)

```bash
pnpm dev
# or
pnpm run server:dev
```

The server starts on `http://localhost:8787` (or `AIE_MATRIX_HTTP_PORT`).

Expected startup output:
```
aie-matrix PoC listening on http://127.0.0.1:8787
  Registry: POST /registry/caretakers | /registry/houses | /registry/adopt
  MCP world-api (Streamable HTTP): POST http://127.0.0.1:8787/mcp
  Colyseus WebSocket: ws://127.0.0.1:8787 (matchmake routes on same port)
  Spectator room id: GET http://127.0.0.1:8787/spectator/room
  Map assets (dev): GET http://127.0.0.1:8787/maps/...
```

---

## Smoke Test: Service Layer

Verify the Effect service layer is wired correctly by confirming the server rejects a bridge-dependent request before Colyseus is ready (this should no longer be possible at steady state — the bridge is now provided by a Layer that the server waits for):

```bash
# Should return 200 once server is fully started
curl -s http://localhost:8787/spectator/room | jq .
# Expected: { "roomId": "...", "roomName": "matrix" }
```

Verify typed error mapping — call the MCP endpoint without auth:
```bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"whereami","arguments":{}},"id":1}'
# Expected: HTTP 401 and body { "error": "AUTH_ERROR", "variant": "MissingCredentials", ... }
# Previously: 500 with generic catch-all
```

---

## Notes (US2 — MCP typed errors, Phase 4)

After Phase 4, **auth failures at the `/mcp` boundary** (missing or invalid `Authorization`) still return **HTTP 401** with a JSON body shaped like `{ "error": "AUTH_ERROR", "variant": "...", "message": "..." }` — the Effect handler fails before the MCP transport runs.

**Tool-level domain errors** (`NO_POSITION`, `UNKNOWN_CELL`, `MOVEMENT_BLOCKED`, malformed auth inside a tool session, etc.) are returned as normal MCP **`tools/call` successes** with **`result.isError": true`** and `content[0].text` set to a JSON string such as `{"error":"UNKNOWN_CELL","cellId":"…"}`. The Streamable HTTP transport typically responds with **HTTP 200** for those JSON-RPC responses; clients (including `GhostMcpClient`) treat `isError` as a failed tool and surface the JSON text as the error.

**Smoke checks (2026-04-14)** with `pnpm dev` / server on port 8787:

| Check | Command / expectation |
|-------|-------------------------|
| Missing auth | `curl` POST `/mcp` `tools/call` `whereami` **without** `Authorization` → **401** + `AUTH_ERROR` |
| TCK | `pnpm test:tck` with server running → **PASS** (`whereami` returns a real `tileId`) |

To inspect a tool error payload from the shell (adopt a ghost first for a JWT), call `tools/call` with auth and decode the JSON-RPC `result` object; `isError` and `content[0].text` carry the structured `{ "error": "…" }` codes used by agents and TCK-oriented tooling.

---

## Run Tests

```bash
# End-to-end tests (requires Playwright browsers — auto-installed by pnpm test:e2e)
pnpm test:e2e

# TCK ghost contract tests
pnpm test:tck
```

The e2e suite is the primary regression check for this migration. All existing passing tests must continue to pass after the Effect-ts wiring is introduced.

---

## Type Check

```bash
pnpm typecheck
```

This runs across all workspace packages. TypeScript will fail the build if any Effect `R` channel is not fully satisfied (i.e., a service is consumed but its Layer is not provided to the runtime). This is the primary compile-time safety guarantee of the migration.

---

## Key New Files (after implementation)

```
server/src/
├── errors.ts                      # Data.TaggedError domain errors + errorToResponse()
└── services/
    ├── WorldBridgeService.ts      # Context.Tag + makeWorldBridgeLayer()
    ├── RegistryStoreService.ts    # Context.Tag + makeRegistryStoreLayer()
    ├── TranscriptHubService.ts    # Context.Tag + TranscriptHubLayer (Phase 2)
    └── ServerConfigService.ts     # Context.Tag + makeServerConfigLayer()
```

---

## Debugging

If a request returns an unexpected error shape, check:

1. **`R` channel errors at startup**: TypeScript compile errors mean a required service Layer was not provided. Run `pnpm typecheck` to surface these before runtime.
2. **503 "World is still initializing"**: The `WorldBridgeService` Layer construction depends on Colyseus being ready. The new code waits for this explicitly — a 503 at steady state indicates the Colyseus room failed to create.
3. **401 on all MCP requests**: Check that the ghost JWT includes both `sub` (ghostId) and `caretakerId` claims, and that the token is not expired.
4. **Request tracing (US4 / Phase 6)**: Each `POST /mcp` request gets a UUID written as `traceId` on structured `console.info` JSON lines (`kind`: `mcp.request`, `mcp.tool`, `world-bridge`, and MCP-layer `getGhostCell`/`setGhostCell`). The combined server also logs `traceId` on `/registry/adopt` as `registry.adopt`. Search the server log output for a single `traceId` to correlate entry → tools → bridge → Colyseus (`world-bridge` `setGhostCell` `after-colyseus` is the last app-controlled line before `MatrixRoom` applies state; enable `AIE_MATRIX_DEBUG=1` to see `MatrixRoom.setGhostCell` and correlate by ghost id and ordering).

### Manual trace verification (`go` tool)

1. Run `pnpm dev` and complete registry smoke steps so you have a ghost JWT (`Authorization: Bearer <token>`).
2. Call `tools/call` for `go` with a valid `toward` (e.g. `n`) using the same base URL as the server.
3. Copy one `traceId` from a log line with `"kind":"mcp.request"` and `"phase":"entry"`.
4. Search the captured logs for that UUID and confirm it appears on the `mcp.tool` start/end lines for `go`, on `world-bridge` / MCP `getGhostCell` / `setGhostCell` lines for that request, and (with `AIE_MATRIX_DEBUG=1`) that the matching `MatrixRoom.setGhostCell` line follows the `world-bridge` `after-colyseus` line for the same ghost and cell.
