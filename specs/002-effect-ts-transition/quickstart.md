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
pnpm poc:server:dev
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
curl -s -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"whereami","arguments":{}},"id":1}'
# Expected: 401 with { "error": "AUTH_ERROR", ... }
# Previously: 500 with generic catch-all
```

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
4. **Request tracing**: All requests processed through the Effect pipeline are tagged with a trace ID. Search logs for the trace ID to follow the full execution path.
