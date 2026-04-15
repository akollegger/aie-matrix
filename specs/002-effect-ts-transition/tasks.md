# Tasks: Effect-ts Transition for Server Scalability

**Input**: Design documents from `specs/002-effect-ts-transition/`
**Branch**: `002-effect-ts-transition`
**ADR**: `proposals/adr/0002-adopt-effect-ts.md`

**Tests**: Smoke tests documented in `quickstart.md`. No new test framework introduced — e2e (`@aie-matrix/e2e`) and TCK (`@aie-matrix/ghost-tck`) are the regression baselines. The constitution requires at least one smoke test per runnable code change; smoke test commands are captured in quickstart.md and referenced below.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1 and deeply intertwined (service injection and typed errors evolve together across the same migration waves); they are separated here by concern — US1 covers the DI wiring, US2 covers the error-channel cleanup in the MCP layer. Error type definitions are in Foundational (Phase 2) as they unblock both.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label — US1, US2, US3, US4
- File paths use the pnpm workspace monorepo layout; `server/` is the primary target package

---

## Phase 1: Setup

**Purpose**: Add the `effect` dependency and create the new file structure. No behavior changes.

- [X] T001 Add `effect` (v3+) to dependencies in `server/package.json` and run `pnpm install` from repo root
- [X] T002 [P] Create `server/src/services/` directory with `.gitkeep` placeholder (will hold WorldBridgeService, RegistryStoreService, ServerConfigService, TranscriptHubService)
- [X] T003 [P] Verify `pnpm typecheck` passes at baseline before any code changes (confirms clean starting state)
- [X] T004 Confirm ADR-0002 reference is present in `CLAUDE.md` Active Technologies section (already added by agent context update)

**Checkpoint**: `effect` is installed, directory structure exists, baseline typecheck is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Error type definitions and Effect runtime infrastructure. MUST be complete before US1 or US2 work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Create `server/src/errors.ts` — define all `Data.TaggedError` types: `AuthError` (MissingCredentials, InvalidToken, MalformedClaims, ExpiredToken), `RegistryError` (UnknownCaretaker, UnknownGhostHouse, CaretakerAlreadyHasGhost), `WorldApiError` (NoPosition, UnknownCell, MapIntegrity, MovementBlocked), `WorldBridgeError` (NotReady, NoNavigableCells), `McpHandlerError`
- [X] T006 Add `errorToResponse()` function to `server/src/errors.ts` — maps all error types to `{ status: number, body: string }` using `Match.tag` with `Match.exhaustive` (implements IC-001 contract)
- [X] T007 [P] Create `server/src/services/WorldBridgeService.ts` — `Context.Tag("aie-matrix/WorldBridgeService")` using `ColyseusWorldBridge` interface from `@aie-matrix/server-world-api`; export `makeWorldBridgeLayer(bridge: ColyseusWorldBridge): Layer`
- [X] T008 [P] Create `server/src/services/RegistryStoreService.ts` — `Context.Tag("aie-matrix/RegistryStoreService")` using `RegistryStore` from `@aie-matrix/server-registry`; export `makeRegistryStoreLayer(store: RegistryStore): Layer`
- [X] T009 [P] Create `server/src/services/ServerConfigService.ts` — `Context.Tag("aie-matrix/ServerConfigService")` with `{ httpPort, mapPath, mapsRoot, corsHeaders, debugEnabled }`; export `makeServerConfigLayer(env: NodeJS.ProcessEnv): Layer`
- [X] T010 Verify `pnpm typecheck` passes after adding services and errors — new service tags must compile without circular imports

**Checkpoint**: Error types defined, service tags defined, TypeScript compiles. US1 and US2 can now proceed.

---

## Phase 3: User Story 1 — Service-Based Dependency Management (Priority: P1) 🎯 MVP

**Goal**: Replace closure-based `let bridge: ... | undefined` with a typed `WorldBridgeService` Layer so that handlers receive their dependencies without null checks.

**Independent Test**: After this phase, `pnpm typecheck` reports zero `R`-channel violations. The `/registry/adopt` endpoint works end-to-end with a mock-injectable `WorldBridgeService`. No `if (!bridge)` patterns remain in `server/src/index.ts`. TCK tests pass.

### Wave 1 — Leaf Node Refactors

- [X] T011 [US1] Refactor `server/auth/src/jwt.ts` — replace `throw new Error("JWT missing sub")` and similar throws with `JwtError` variants; change `verifyGhostToken` signature to return `Effect<JwtClaims, JwtError>` (or `Either` if callers are not yet Effect-based)
- [X] T012 [US1] Refactor `server/registry/src/session-guard.ts` — replace `throw new RegistryConflictError(...)` with `yield* new RegistryError({ code: ..., message: ... })`; change `assertAdoptionAllowed` return type to `Effect<void, RegistryError>`; preserve existing `RegistryConflictError` code strings verbatim

### Wave 2 — Auth Layer

- [X] T013 [US1] Refactor `server/world-api/src/auth-context.ts` — replace silent `undefined` return on JWT failure with `AuthError.MissingCredentials`; replace `throw` in `requireGhostAuth` and `ghostIdsFromAuth` with `AuthError` variants; return `Effect<AuthInfo, AuthError>` and `Effect<{ ghostId, caretakerId }, AuthError>`

### Wave 3 — Registry Route Handlers

- [X] T014 [P] [US1] Create `server/registry/src/utils/http.ts` — shared Effect-aware `readJsonBody` and `sendJson` helpers to eliminate the three duplicate copies in `index.ts`, `adoption.ts`, and `register-house.ts`
- [X] T015 [P] [US1] Refactor `server/registry/src/routes/register-house.ts` — migrate `handleRegisterGhostHouse` to an Effect pipeline consuming `RegistryStoreService`; replace inline `readJsonBody`/`sendJson` with `server/registry/src/utils/http.ts`
- [X] T016 [US1] Refactor `server/registry/src/routes/adoption.ts` — migrate `handleAdoptGhost` to an Effect pipeline consuming `RegistryStoreService` and `WorldBridgeService`; replace `instanceof RegistryConflictError` catch with `Effect.catchAll(errorToResponse)`; replace `spawnGhostOnMap` closure with `Effect.flatMap(WorldBridgeService, bridge => ...)`
- [X] T017 [US1] Refactor `server/registry/src/index.ts` — compose Wave 3 handlers into a `createRegistryRequestListener` that uses a shared `ManagedRuntime`; consolidate duplicate `readJsonBody`/`sendJson` by importing from `server/registry/src/utils/http.ts`

### Wave 5 — Orchestration (The God File)

- [X] T018 [US1] Refactor `server/src/index.ts` — after `createColyseusBridge(room)`, build `ManagedRuntime.make(Layer.mergeAll(makeWorldBridgeLayer(bridge), makeRegistryStoreLayer(store), makeServerConfigLayer(process.env)))` and assign to `const runtime`
- [X] T019 [US1] Remove `let bridge: ... | undefined` from `server/src/index.ts` — replace all `if (!bridge)` 503 guards with `WorldBridgeError.NotReady` routed through `errorToResponse`; the bridge is now guaranteed by the Layer construction sequence
- [X] T020 [US1] Add `process.on("SIGTERM", async () => { await runtime.dispose(); process.exit(0) })` to `server/src/index.ts` replacing scattered cleanup code
- [X] T021 [US1] Update `/mcp` POST route in `server/src/index.ts` to call `runtime.runPromise(handleMcpEffect(parsed).pipe(Effect.catchAll(errorToResponse)))` with structured response writing; all other routes remain imperative
- [X] T022 [US1] Run `pnpm typecheck` — confirm zero `R`-channel violations across all `server/` packages; fix any compile errors before proceeding
- [X] T023 [US1] Smoke test: start server with `pnpm dev`, run quickstart.md verification commands — confirm `/spectator/room` returns 200, `/registry/adopt` succeeds, unauthenticated `/mcp` POST returns 401

**Checkpoint**: US1 complete — service injection via Effect Layer, no `if (!bridge)` patterns, TypeScript enforces correctness at compile time. TCK passes.

---

## Phase 4: User Story 2 — Predictable Error Handling (Priority: P1)

**Goal**: Replace all per-tool `try/catch → toolError()` patterns in MCP handlers with typed `WorldApiError` channels. Any failed ghost request returns the correct HTTP status code rather than a generic 500.

**Independent Test**: `POST /mcp` with a valid ghost JWT but a non-existent cell returns `404` with `{ "error": "UNKNOWN_CELL" }`. `POST /mcp` without auth returns `401` with `{ "error": "AUTH_ERROR" }`. No 500 responses for expected domain errors.

### Wave 4 — MCP Tool Handlers

- [X] T024 [P] [US2] Refactor MCP tool handler `whoami` in `server/world-api/src/mcp-server.ts` — remove per-tool `try/catch`; yield `AuthError` variants instead of calling `toolError()` on auth failure
- [X] T025 [P] [US2] Refactor MCP tool handler `whereami` in `server/world-api/src/mcp-server.ts` — yield `WorldApiError.NoPosition` when ghost has no recorded cell rather than returning a generic tool error
- [X] T026 [P] [US2] Refactor MCP tool handler `look` in `server/world-api/src/mcp-server.ts` — yield `WorldApiError` variants for missing cell/ghost; remove per-tool `try/catch`
- [X] T027 [P] [US2] Refactor MCP tool handler `exits` in `server/world-api/src/mcp-server.ts` — yield `WorldApiError.UnknownCell` when cell not in map; remove per-tool `try/catch`
- [X] T028 [US2] Refactor MCP tool handler `go` in `server/world-api/src/mcp-server.ts` — yield `WorldApiError.MovementBlocked` or `WorldApiError.UnknownCell` based on `GoFailure` discriminant from `movement.ts`; remove per-tool `try/catch`
- [X] T029 [US2] Add single Effect-to-`CallToolResult` adapter function in `server/world-api/src/mcp-server.ts` — converts Effect exit (success/failure) to MCP `CallToolResult`; replaces per-tool `try/catch` boilerplate (implements IC-001 MCP error mapping section)
- [X] T030 [US2] Refactor `handleGhostMcpRequest` in `server/world-api/src/mcp-server.ts` — provide `WorldBridgeService` and `RegistryStoreService` via `Layer.provide` or `ManagedRuntime`; replace prop-drilled `bridge` argument and `getRegistryGhostTile` callback with service yields
- [X] T031 [US2] Verify typed errors via smoke test: use curl commands from `quickstart.md` to confirm 401 for missing auth, 404 for non-existent ghost, 422 for blocked movement — capture results in `quickstart.md` Notes section
- [X] T032 [US2] Run `pnpm test:tck` — confirm all TCK ghost contract tests pass with no regressions

**Checkpoint**: US2 complete — every expected domain error maps to a typed HTTP response. 500 responses are defects only, never expected domain failures.

---

## Phase 5: User Story 3 — Scalable Event Broadcasting (Priority: P2)

**Goal**: Introduce a `PubSub`-based transcript hub so that IRL event transcripts can be fanned out to 5,000 concurrent ghost subscriber fibers without blocking the main event loop.

**Independent Test**: Start server with 10 simulated ghost subscriptions; publish a `TranscriptEvent` to the hub; verify all 10 receive it. Confirm slow subscribers do not block the publisher (dropping semantics). TypeScript compile confirms `TranscriptHub` Layer is wired in `ManagedRuntime`.

- [ ] T033 [US3] Create `server/src/services/TranscriptHubService.ts` — define `TranscriptEvent` interface (source, text, timestamp) per IC-002; define `TranscriptHub` Context.Tag wrapping `PubSub<TranscriptEvent>`
- [ ] T034 [US3] Add `TranscriptHubLayer` to `server/src/services/TranscriptHubService.ts` — `Layer.scoped` wrapping `PubSub.dropping<TranscriptEvent>(256)` with `Effect.addFinalizer(() => PubSub.shutdown(hub))`
- [ ] T035 [US3] Implement `publishTranscript(event: TranscriptEvent)` in `server/src/services/TranscriptHubService.ts` — `Effect<boolean, never, TranscriptHub>`; returns `true` if published, `false` if dropped
- [ ] T036 [US3] Implement `subscribeGhostToHub(ghostId: string)` in `server/src/services/TranscriptHubService.ts` — subscribes to hub via `PubSub.subscribe`; loops via `Effect.forever` calling `Queue.take` then `notifyGhost`; returns `Effect<never, never, TranscriptHub | WorldBridgeService>`
- [ ] T037 [US3] Wire `TranscriptHubLayer` into `ManagedRuntime.make(Layer.mergeAll(..., TranscriptHubLayer))` in `server/src/index.ts`
- [ ] T038 [US3] In `server/registry/src/routes/adoption.ts` adoption success path — fork `subscribeGhostToHub(ghostId)` as a scoped fiber via `Effect.forkScoped` so each adopted ghost gets a subscriber fiber tied to its session scope
- [ ] T039 [US3] Add a stub ingestion endpoint (`POST /transcripts`) in `server/src/index.ts` that calls `publishTranscript` — accepts `{ source, text }` body; returns 200 or 207 (partial delivery); note this endpoint is a placeholder until the IRL transcript source interface is decided (open question in `docs/architecture.md`)
- [ ] T040 [US3] Verify TypeScript compiles with `TranscriptHub` in `ManagedRuntime` R channel satisfied; run `pnpm dev` and confirm server starts without error

**Checkpoint**: US3 complete — non-blocking fan-out architecture in place; 5,000 fiber capacity available once ghosts adopt.

---

## Phase 6: User Story 4 — System-Wide Observability (Priority: P2)

**Goal**: All requests processed through the Effect pipeline carry a unique trace ID from entry point through world bridge to Colyseus state change.

**Independent Test**: Send one MCP `go` request; search server logs for the request's trace ID; confirm it appears in the entry log, the WorldBridge call log, and the state-change log.

- [ ] T041 [US4] Add trace ID generation at the `/mcp` route boundary in `server/src/index.ts` — use `Effect.withSpan` or a `FiberRef` scoped to each request; include trace ID in all log output within the request pipeline
- [ ] T042 [US4] Propagate trace ID through `WorldBridgeService` calls in `server/world-api/src/mcp-server.ts` — ensure `setGhostCell` and `getGhostCell` log the trace ID alongside the ghost and cell IDs
- [ ] T043 [P] [US4] Add structured logging to `server/registry/src/routes/adoption.ts` — log adoption request with caretakerId, ghostId, and trace ID (or request correlation ID)
- [ ] T044 [P] [US4] Add structured logging to each MCP tool handler in `server/world-api/src/mcp-server.ts` — log tool name, ghost ID, input, and outcome (success/error type) with trace ID
- [ ] T045 [US4] Manual trace verification: send a `go` MCP request, capture server logs, confirm a unique ID appears consistently across entry, bridge, and state-change log lines; document the verification step in `quickstart.md`

**Checkpoint**: US4 complete — every MCP request is traceable end-to-end via a unique ID in structured logs.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates required by the constitution and final validation across the full system.

- [ ] T046 [P] Update `docs/architecture.md` — add orchestration layer section documenting the Layer/Context service pattern as a binding contract for new handlers; mark "Observability and Telemetry" open question as decided (resolved by ADR-0002 + this implementation)
- [ ] T047 [P] Update `README.md` — note `effect` dependency in server package; update server startup instructions if commands changed; confirm `pnpm dev` instructions are accurate
- [ ] T048 Update `CONTRIBUTING.md` — add Effect pattern guidelines: how to define a new service (Context.Tag + Layer), how to write a typed error (Data.TaggedError), how to compose handlers in Effect.gen, how to add a new Layer to ManagedRuntime
- [ ] T049 Run `pnpm test:e2e` — confirm all existing end-to-end tests pass with no regressions introduced by the migration
- [ ] T050 Run `pnpm test:tck` — confirm all TCK ghost contract tests pass
- [ ] T051 Run `pnpm typecheck` across all workspace packages — confirm zero TypeScript errors
- [ ] T052 Review `server/src/index.ts` for any remaining `if (!x)` null guard patterns that should have been removed — fix any missed instances

**Checkpoint**: All documentation updated, all tests pass, TypeScript clean across workspace.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS US1 and US2
- **US1 (Phase 3)**: Depends on Phase 2; Wave 1 and Wave 2 can start; Waves 3 and 5 follow sequentially
- **US2 (Phase 4)**: Depends on Phase 2; Wave 4 tool refactors [P] can run in parallel after US1 Wave 2 (auth) is complete
- **US3 (Phase 5)**: Depends on US1 (ManagedRuntime must be wired before TranscriptHubLayer can be added)
- **US4 (Phase 6)**: Depends on US1 and US2 (tracing builds on the Effect pipeline established by both)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependency on US2
- **US2 (P1)**: Can start Wave 4 refactors after US1 Wave 2 (auth context) is done; `handleGhostMcpRequest` (T030) requires US1 Wave 3 registry to be complete
- **US3 (P2)**: Requires US1 Phase 3 complete (ManagedRuntime wired)
- **US4 (P2)**: Requires US1 and US2 complete (tracing spans the full Effect pipeline)

### Parallel Opportunities Within US1

- T007, T008, T009 (service Context.Tag files) — all parallel
- T011 (jwt.ts) and T013 (auth-context.ts) share no files — can be done together once T012 (session-guard) is done
- T014, T015 (registry http utils + register-house.ts) — parallel
- T024, T025, T026, T027 (MCP tool handlers whoami/whereami/look/exits) — all parallel

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch in parallel (all different files):
Task: T007 Create server/src/services/WorldBridgeService.ts
Task: T008 Create server/src/services/RegistryStoreService.ts
Task: T009 Create server/src/services/ServerConfigService.ts
```

## Parallel Example: US2 MCP Tool Handlers

```bash
# Launch in parallel (all different tool handlers in mcp-server.ts):
Task: T024 [US2] Refactor whoami tool handler
Task: T025 [US2] Refactor whereami tool handler
Task: T026 [US2] Refactor look tool handler
Task: T027 [US2] Refactor exits tool handler
# Then sequentially:
Task: T028 [US2] Refactor go tool handler (depends on WorldApiError from above)
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only — Waves 1-5)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (error types + service tags)
3. Complete Phase 3: US1 Waves 1-5 (service injection, `let bridge` eliminated)
4. Complete Phase 4: US2 Wave 4 (MCP typed errors)
5. **STOP and VALIDATE**: `pnpm typecheck` clean, TCK passes, smoke tests pass
6. This delivers SC-004 (no `if (!service)` patterns) and SC-003 (traceable requests)

### Incremental Delivery

1. Phases 1-2 → Foundation ready (no behavior change)
2. Phase 3 (US1) → Service DI working; TCK passes → deploy/demo
3. Phase 4 (US2) → Typed errors in MCP; 404 not 500 → deploy/demo
4. Phase 5 (US3) → Broadcast architecture → deploy/demo
5. Phase 6 (US4) → Observability → deploy/demo
6. Phase 7 → Docs and final validation

### Suggested MVP Scope

Phases 1–4 (US1 + US2) deliver the highest-value changes for the ADR's stated goals:
- SC-004: Elimination of all `if (!service) throw new Error(...)` patterns ✅
- SC-003: API requests traceable via typed error channels ✅
- ADR Phase 1 complete: Service Layer + Typed Errors ✅

US3 and US4 (Phases 5-6) can follow in a subsequent sprint.

---

## Notes

- [P] tasks operate on different files — no lock contention; safe to run in parallel
- Each `[USN]` label maps to the user story acceptance scenarios in `spec.md`
- Colyseus internals (`MatrixRoom`, `room-schema.ts`, map loader) are never modified
- `server/world-api/src/movement.ts` is already pure — no migration needed; the MCP `go` handler (T028) wraps its result via a thin adapter
- Constitution requirement: smoke test documentation must be in `quickstart.md` before marking US1 complete
- Commit after each Wave checkpoint, not after every individual task
