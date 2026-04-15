# Implementation Plan: Effect-ts Transition for Server Scalability

**Branch**: `002-effect-ts-transition` | **Date**: 2026-04-14 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/002-effect-ts-transition/spec.md`

---

## Summary

Refactor `server/src/index.ts` and supporting packages from closure-based dependency management to Effect-ts service/layer architecture. Introduce typed error channels to replace scattered `try/catch` blocks and generic 500 responses. Establish structured concurrency via `PubSub` and supervised fibers for the IRL transcript broadcast path. Add request tracing as a first-class concern across all ghost interactions.

Technical approach: five-wave incremental migration starting at leaf-node pure logic (`session-guard.ts`, `jwt.ts`) and working up to the God File (`server/src/index.ts`). A `ManagedRuntime` bridge enables each wave to coexist with the remaining imperative code until the full migration is complete.

---

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24  
**Primary Dependencies**: `effect` (v3+), `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3, pnpm 10 workspace monorepo  
**Storage**: In-memory `Map` (RegistryStore) — no change; Colyseus room schema — no change  
**Testing**: No unit test framework in server packages yet; e2e via `@aie-matrix/e2e` (Playwright); TCK via `@aie-matrix/ghost-tck`; this feature MUST add at least one smoke test per constitution  
**Target Platform**: Node.js 24+ server (Linux/Docker target; macOS for dev)  
**Performance Goals**: Broadcast latency < 100ms at 5,000 concurrent ghost fibers; API movement response < 200ms p95  
**Constraints**: No breaking changes to public MCP or registry REST contracts; Colyseus room internals (MatrixRoom, schema, map loader) untouched; incremental migration — handlers may coexist during transition; `effect` package added to `server/` only for Phase 1  
**Scale/Scope**: 5,000 concurrent ghost subscriptions, single Colyseus room, single Node process; multi-process Redis scaling is out of scope for this feature

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **Proposal linkage**: ADR-0002 (`proposals/adr/0002-adopt-effect-ts.md`) is accepted and directly scopes the phases, technologies, and risks of this work. ✅
- **Boundary preservation**: Effect wraps around `ColyseusWorldBridge` (not inside Colyseus internals). `MatrixRoom`, `room-schema.ts`, map loader are untouched. The `server/world-api/src/colyseus-bridge.ts` seam is preserved. ✅
- **Contract artifacts**: IC-001 (error-to-HTTP mapping) documented at `contracts/ic-001-error-to-http-mapping.md`. IC-002 (pub-sub broadcast interface) documented at `contracts/ic-002-transcript-broadcast.md`. ✅
- **Verification**: Constitution requires at least one smoke test or equivalent for any runnable code added. This feature must add a service-layer smoke test; the existing e2e suite is the regression check. Smoke test commands documented in `quickstart.md`. ✅
- **Documentation impact**: `docs/architecture.md` — add orchestration layer section and Layer/Context pattern as binding contract for new handlers. `README.md` — update dev startup instructions. `CONTRIBUTING.md` — add Effect pattern guidelines for new services and handlers. ✅

---

## Project Structure

### Documentation (this feature)

```text
specs/002-effect-ts-transition/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-001-error-to-http-mapping.md   # Phase 1 output
│   └── ic-002-transcript-broadcast.md    # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (changes confined to `server/`)

```text
server/
├── package.json                     # Add: effect dependency
├── src/
│   ├── index.ts                     # Refactored: ManagedRuntime wiring, Effect-based routing
│   ├── errors.ts                    # New: Data.TaggedError domain errors + errorToResponse()
│   └── services/
│       ├── WorldBridgeService.ts    # New: Context.Tag + makeWorldBridgeLayer()
│       ├── RegistryStoreService.ts  # New: Context.Tag + makeRegistryStoreLayer()
│       └── ServerConfigService.ts   # New: Context.Tag + makeServerConfigLayer()
├── auth/src/
│   └── jwt.ts                       # Updated: JwtError replaces throw
├── registry/src/
│   ├── session-guard.ts             # Updated: Effect<void, RegistryError>
│   └── routes/
│       ├── adoption.ts              # Updated: Effect pipeline, RegistryStoreService
│       └── register-house.ts        # Updated: Effect pipeline
└── world-api/src/
    ├── auth-context.ts              # Updated: Effect<AuthInfo, AuthError>
    └── mcp-server.ts                # Updated: tool handlers as Effect, ManagedRuntime bridge

# Phase 2 only (IRL transcript path):
server/src/services/
└── TranscriptHubService.ts          # New: PubSub<TranscriptEvent> + Layer.scoped
```

**Structure Decision**: No new top-level directories. All changes are confined to `server/` packages, consistent with ADR-0002's phasing. The `services/` subdirectory under `server/src/` is new but follows existing naming conventions in the workspace. No repo-level additions require proposal justification.

**What is explicitly untouched**:
- `server/colyseus/src/` — all Colyseus room internals
- `server/world-api/src/colyseus-bridge.ts` — implementation unchanged; only a `Context.Tag` wraps it
- `server/world-api/src/movement.ts` — already pure with discriminated unions
- `server/src/colyseus-cors-patch.ts` — monkey-patch, leave alone
- `client/`, `ghosts/`, `maps/`, `shared/` — completely out of scope

---

## Migration Plan

### Wave 1 — Leaf Nodes (pure domain logic, no HTTP surface)

**Files**: `server/auth/src/jwt.ts`, `server/registry/src/session-guard.ts`

- `jwt.ts`: Replace `throw new Error("JWT missing sub")` and related throws with `JwtError` (`Data.TaggedError`). Return `Effect<JwtClaims, JwtError>` from `verifyGhostToken`.
- `session-guard.ts`: Replace `throw new RegistryConflictError(...)` with `RegistryError` (`Data.TaggedError`). Return `Effect<void, RegistryError>` from `assertAdoptionAllowed`. Existing `RegistryConflictError` error codes preserved verbatim.

**Verification**: TypeScript compile passes. No HTTP surface changes. TCK tests pass (ghost adoption still works).

---

### Wave 2 — Auth Layer

**Files**: `server/world-api/src/auth-context.ts`

- Replace silent `undefined` return on JWT failure with `AuthError.MissingCredentials` or `AuthError.InvalidToken`.
- Replace `throw new Error(...)` in `requireGhostAuth` and `ghostIdsFromAuth` with corresponding `AuthError` variants.
- Return type becomes `Effect<AuthInfo, AuthError>` and `Effect<{ ghostId, caretakerId }, AuthError>`.

**Verification**: TypeScript compile passes. TCK ghost adoption test passes with valid auth. Unauthenticated MCP request returns 401 (not 500).

---

### Wave 3 — Registry Route Handlers

**Files**: `server/registry/src/routes/register-house.ts`, `server/registry/src/routes/adoption.ts`, `server/registry/src/index.ts`

- Introduce `RegistryStoreService` (`Context.Tag` + `Layer.succeed`).
- Migrate `handleRegisterGhostHouse` to an Effect pipeline consuming `RegistryStoreService`.
- Migrate `handleAdoptGhost` to an Effect pipeline consuming `RegistryStoreService` and `WorldBridgeService`. The `spawnGhostOnMap` closure becomes `Effect.flatMap(WorldBridgeService, bridge => ...)`.
- Consolidate duplicate `readJsonBody`/`sendJson` helpers into a shared Effect HTTP utility.
- The `instanceof RegistryConflictError` catch disappears; replaced by `Effect.catchAll(errorToResponse)`.

**Verification**: TCK tests pass. End-to-end ghost adoption flow works.

---

### Wave 4 — MCP World-API

**Files**: `server/world-api/src/mcp-server.ts`

- Migrate individual MCP tool handlers (`whoami`, `whereami`, `look`, `exits`, `go`) to `Effect` pipelines.
- Introduce `WorldApiError` types to replace per-tool `try/catch → toolError()`.
- The `WorldBridgeService` is consumed via `yield* WorldBridgeService` instead of the `bridge` argument closure.
- The per-tool `try/catch` disappears; a single adapter at the `server.registerTool` boundary converts `Effect` exits to `CallToolResult` using IC-001 MCP error mapping.
- `getRegistryGhostTile` callback is replaced by `RegistryStoreService` consumption.

**Verification**: TCK tests pass for all MCP tools (go, exits, whereami, look, whoami). Typed 404 returned for unknown cell/ghost rather than generic 500.

---

### Wave 5 — Orchestration (The God File)

**Files**: `server/src/index.ts`, `server/src/errors.ts`, `server/src/services/*.ts`

- Create `server/src/errors.ts` with all `Data.TaggedError` types and `errorToResponse()` mapping function.
- Create `server/src/services/WorldBridgeService.ts`, `RegistryStoreService.ts`, `ServerConfigService.ts`.
- In `main()`: after Colyseus initialises, construct `ManagedRuntime.make(Layer.mergeAll(worldBridgeLayer, registryStoreLayer, serverConfigLayer))`.
- The mutable `let bridge: ... | undefined` variable is replaced by the `WorldBridgeService` Layer.
- All `if (!bridge)` guards disappear; the 503 "WorldNotReady" case becomes a typed `WorldBridgeError`.
- The `/mcp` POST route handler calls `runtime.runPromise(handleMcpEffect(parsed))`. Other routes stay imperative (or are migrated in this wave — implementer's discretion).
- Add `process.on("SIGTERM", () => runtime.dispose())` for graceful Layer finaliser execution.

**Verification**: All existing e2e tests pass. Smoke test: `curl http://localhost:8787/spectator/room` returns 200. Unauthenticated MCP returns 401. Missing ghost returns 404. TypeScript compiles with zero errors.

---

## Phase 2: Structured Concurrency (Transcript Broadcasting)

*Deferred — may overlap with Phase 1 per ADR-0002. Blocked on: IRL transcript source interface being defined.*

- Add `server/src/services/TranscriptHubService.ts` with `PubSub.dropping<TranscriptEvent>(256)` wrapped in `Layer.scoped`.
- On ghost adoption, fork a scoped fiber per ghost via `Effect.forkScoped(subscribeGhostToHub(ghostId))`.
- Implement the ingestion adapter once the transcript source interface is known (WebSocket / SSE — open question in `docs/architecture.md`).
- Add supervision strategy: if the ingestion stream crashes, restart it automatically via `Effect.retry` with exponential backoff.

**Verification**: Load test — simulate 5,000 ghost connections and 10 transcripts/second. Measure that movement API latency stays under 200ms.

---

## Documentation Updates Required

| Document | Required Change |
|---|---|
| `docs/architecture.md` | Add orchestration layer section; document Layer/Context service pattern as binding contract for new handlers; close the "Observability and Telemetry" open question (resolved by ADR-0002) |
| `README.md` | Update server start-up instructions to note `effect` dependency |
| `CONTRIBUTING.md` | Add guidelines for writing new services and handlers using the Effect pattern (service definition, error handling, Layer composition) |

---

## Complexity Tracking

No Constitution violations. No new top-level directories. No new packages. The `services/` subdirectory within `server/src/` is a standard submodule convention that does not require proposal justification.
