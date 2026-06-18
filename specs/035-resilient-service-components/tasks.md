# Tasks: Resilient Service Components

**Input**: Design documents from `/specs/035-resilient-service-components/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Required at every level per user request and constitution §Service Testing Requirements. Unit tests ship in the same change as the code they cover. Integration tests planned in the same change; may land separately if Redis unavailable in CI (documented gap).

**Organization**: 4 user stories → 4 implementation phases after setup. Each phase is independently deployable and verifiable. 39 tasks total (35 original + 4 added by analysis remediation: T036–T039).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US4)

---

## Phase 1: Setup

**Purpose**: RFC, dependency additions, and CatalogEntry type extensions that all later phases depend on.

- [X] T001 Author `proposals/rfc/RFC-035-resilient-service-components.md` referencing spec-035, summarising the four implementation areas and key decisions from `specs/035-resilient-service-components/research.md`
- [X] T002 Add `ioredis` v5 (dependency) and `ioredis-mock` (devDependency) to `server/agent-host/package.json` and run `pnpm install` from workspace root
- [X] T003 Extend `CatalogEntry` (agent kind) in `server/agent-host/src/types.ts` with `lastSeenAt?: string` and `healthStatus?: "active" | "inactive" | "unverified"` — additive only, no breaking changes
- [X] T004 Add `HeartbeatRequest` and `HeartbeatResponse` types to `server/agent-host/src/types.ts`

**Checkpoint**: RFC exists; types compile; no functional changes yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Redis catalog backend and heartbeat endpoint in agent-host. These are the server-side foundation both agent phases (US2, US3) depend on.

**⚠️ CRITICAL**: US2 (random-agent) and US3 (catalog durability) depend on the heartbeat endpoint being live. US1 (NPC reconnect) is independent and can proceed in parallel with this phase.

### Tests (write first, confirm they fail before implementing)

- [X] T005 [P] Write unit tests for `RedisCatalogService` in `server/agent-host/tests/unit/redis-catalog-service.test.ts` using `ioredis-mock`: cover `load()` (empty Redis → empty catalog), `save()` + `load()` round-trip, `register()` persists to Redis, `deregister()` removes entry, Redis ECONNREFUSED returns empty catalog gracefully; assert double-`register()` of the same agentId is idempotent (no duplicate entries, no error)
- [X] T006 [P] Write unit tests for the heartbeat handler in `server/agent-host/tests/unit/heartbeat.test.ts`: cover 200 with `sessionActive: false` for known agent, 404 for unknown agent, `lastSeenAt` field updated on successful heartbeat, 401 for missing token
- [X] T007 Write integration test skeleton in `server/agent-host/tests/integration/redis-catalog-service.integration.test.ts`: skips when `REDIS_URL` unset; covers persist → restart → restore round-trip and TTL expiry → empty catalog

### Implementation

- [X] T008 Implement `RedisCatalogService` in `server/agent-host/src/catalog/RedisCatalogService.ts`: `load()` via `GET agent-host:catalog`, `save()` via `SET` + `EX 86400`, `register()` / `deregister()` delegate to patched `CatalogServiceImpl`; implement `makeRedisCatalogLayerFromEnv()` that falls back to `CatalogServiceLive` (file-backed) when `REDIS_URL` unset — mirrors pattern from `server/world-api/src/redis/RedisGhostStoreService.ts`
- [X] T009 Wire `RedisCatalogService` into `server/agent-host/src/main.ts`: replace `CatalogServiceLive` with `await makeRedisCatalogLayerFromEnv()` using top-level await (ESM module)
- [X] T010 Add `POST /v1/catalog/:agentId/heartbeat` handler to `server/agent-host/src/app.ts`: auth check (bearer token), 404 if agentId absent, update `lastSeenAt` + `healthStatus: "active"` on catalog entry, fetch active session from supervisor, return `HeartbeatResponse`; does NOT call `spawnRosterForAgent`
- [X] T011 Replace polling reconciliation loop with eager ping-and-spawn pass: restore catalog from Redis (T009), for each `rosterAgent` entry ping agent's `/health` URL, on ping success + active session call `supervisor.spawnRosterForAgent()`; mark unreachable entries `healthStatus: "inactive"` (not removed); log deprecation warning if `AGENT_HOST_RECONCILIATION_WAIT_MS` is set in env

**Checkpoint**: `pnpm test` passes in `server/agent-host`. Heartbeat endpoint returns 200/404. Catalog survives agent-host restart when `REDIS_URL` is set (smoke test in quickstart.md).

---

## Phase 3: User Story 1 — NPC Ghosts Resume After Restart (Priority: P1) 🎯 MVP

**Goal**: npc-agent detects broken MCP connections per ghost, reconnects with exponential backoff, and resumes ticking. One structured `degraded`/`recovered` event pair replaces continuous error spam.

**Independent Test**: `kubectl rollout restart deployment/server -n aie-matrix` → confirm `npc-agent.mcp.degraded` logged (one per ghost), then `npc-agent.mcp.recovered` after server ready, then ghost position updates resume in Intermedium within 90s. (Scenario 3 in quickstart.md.)

### Tests (write first, confirm they fail before implementing)

- [X] T012 [P] [US1] Write unit tests for reconnect logic in `ghosts/npc-agent/src/__tests__/reconnect.test.ts`: mock `GhostMcpClient` that throws N consecutive times then succeeds; assert `consecutiveFailures` increments correctly; assert inner loop exits at threshold; assert `npc-agent.mcp.degraded` emitted exactly once; assert `npc-agent.mcp.recovered` emitted on successful reconnect; assert final tick count matches expectations
- [X] T013 [P] [US1] Write unit tests for backoff schedule in `ghosts/npc-agent/src/__tests__/reconnect.test.ts` (same file): assert schedule starts at 2s, doubles, caps at 60s; assert `Effect.retry` with the schedule retries the correct number of times before giving up

### Implementation

- [X] T014 [US1] Create `ghosts/npc-agent/src/reconnect.ts`: export `CONSECUTIVE_FAILURE_THRESHOLD` (default 5), `makeReconnectSchedule()` returning `Schedule.exponential("2 seconds").pipe(Schedule.upTo("60 seconds"))`, `McpReconnectState` type, `logDegraded(ghostId)` and `logRecovered(ghostId)` structured log helpers emitting `npc-agent.mcp.degraded` / `npc-agent.mcp.recovered`
- [X] T015 [US1] Modify `ghostActionLoop` in `ghosts/npc-agent/src/executor.ts`: add consecutive-failure counter inside the tick's `Effect.catchAll`; when counter reaches `CONSECUTIVE_FAILURE_THRESHOLD`, call `logDegraded`, reset counter, and exit the inner loop via `Effect.fail` (triggers the `acquireRelease` release path, cleanly disconnecting the MCP client)
- [X] T016 [US1] Wrap the `ghostActionLoop` Effect.acquireRelease block in `ghosts/npc-agent/src/executor.ts` with `Effect.retry(makeReconnectSchedule())`: on re-acquire success + first tick success, call `logRecovered`; on retry schedule exhausted (hard cap), emit a `npc-agent.mcp.failed-permanently` event and exit the fiber cleanly

**Checkpoint**: `pnpm test` passes in `ghosts/npc-agent`. Chaos scenario 3 (server restart) produces degraded/recovered log pair and ghost movement resumes within 90s.

---

## Phase 4: User Story 2 — Wanderers Reappear After agent-host Restart (Priority: P1)

**Goal**: random-agent sends periodic heartbeats, detects session changes in heartbeat responses, and reconciles its ghost roster (spawning only the missing delta) when the session ID changes.

**Independent Test**: `kubectl rollout restart deployment/agent-host -n aie-matrix` → within 60s, random-agent logs `random-agent.heartbeat.session-change`; within 3 minutes, wanderer ghosts are visible in Intermedium. (Chaos scenario 1 in quickstart.md.)

**Depends on**: Phase 2 (heartbeat endpoint must exist)

### Tests (write first, confirm they fail before implementing)

- [X] T017 [P] [US2] Write unit tests for heartbeat client in `ghosts/random-agent/src/__tests__/heartbeat.test.ts`: mock fetch to `POST /v1/catalog/:agentId/heartbeat`; assert interval fires every 30s; assert `onSessionChange` callback triggered when `sessionId` differs from stored; assert no callback when `sessionId` unchanged; assert heartbeat HTTP error is silently retried (no callback, no crash)
- [X] T018 [P] [US2] Write unit tests for roster reconciliation in `ghosts/random-agent/src/__tests__/reconciliation.test.ts`: mock world API returning 3 existing ghosts with target 10 → expects spawn of 7; mock returning 10 existing → expects zero spawns; mock world API error → expects log + no spawn; assert `random-agent.reconciliation.no-op` logged when delta is zero; assert `random-agent.reconciliation.spawning` logged with correct count when delta > 0

### Implementation

- [X] T019 [US2] Create `ghosts/random-agent/src/heartbeat.ts`: export `startHeartbeat(agentId, agentHostUrl, token, onSessionChange)` that calls `POST /v1/catalog/:agentId/heartbeat` every 30s (±jitter), stores last-seen `sessionId`, calls `onSessionChange(newSessionId)` when session ID changes or becomes newly active; logs structured events; handles HTTP errors silently (retry next interval)
- [X] T020 [US2] Create `ghosts/random-agent/src/reconciliation.ts`: export `reconcileRoster(worldApiUrl, agentId, targetCount, activeLoopsCount)` that queries `GET /registry/ghosts` (or equivalent) filtered by `agentId` in the active session; computes delta = `targetCount − existingCount`; spawns delta ghosts via existing spawn path; emits `random-agent.reconciliation.spawning` (delta > 0) or `random-agent.reconciliation.no-op` (delta = 0); returns spawned ghost IDs
- [X] T021 [US2] Wire heartbeat + reconciliation into `ghosts/random-agent/src/agent.ts`: after successful registration call `startHeartbeat(...)` with `onSessionChange` callback that calls `reconcileRoster(worldApiUrl, agentId, RANDOM_AGENT_COUNT, loopsByGhostId.size)`; store returned `sessionId` as `activeSessionId` for change detection

### Push-notification resilience (FR-007, FR-007a)

- [X] T036 [P] [US2] Write unit tests for push-failure reconnect in `ghosts/random-agent/src/__tests__/pushResilience.test.ts`: mock agent-host returning HTTP 503 for 3 consecutive push attempts → assert `random-agent.push.degraded` structured event emitted once; mock subsequent push succeeding → assert `random-agent.push.recovered` emitted; assert no crash or unhandled rejection throughout
- [X] T037 [P] [US2] Write unit tests for task-not-found handling in `ghosts/random-agent/src/__tests__/pushResilience.test.ts` (same file): mock agent-host returning `{"error":"task not found"}` for a push → assert `ghostIdToTaskId` entry is deleted for that ghost; assert a new task is re-initiated via the existing spawn path; assert total spawn count is 1 (no duplicate)
- [X] T038 [US2] Implement push-failure reconnect state in `ghosts/random-agent/src/executor.ts`: track consecutive push-notification failures per ghost; after ≥3 failures emit `random-agent.push.degraded` (once); on next successful push emit `random-agent.push.recovered`; failures are silent retries, not crashes
- [X] T039 [US2] Implement task-not-found discard-and-reinitiate in `ghosts/random-agent/src/executor.ts`: in the A2A push ingest handler, detect `task-not-found` response shape from agent-host; call `registerSpawnTask` with a new task ID; re-initiate via `startPushSpawnContext` for that ghost's context; log `random-agent.push.task-restarted` with ghostId

**Checkpoint**: `pnpm test` passes in `ghosts/random-agent`. Chaos scenario 1 (agent-host restart) produces `random-agent.heartbeat.session-change` log and wanderers reappear within 3 minutes. Push-notification `task-not-found` errors no longer accumulate after restart.

---

## Phase 5: User Story 3 — Agent Catalog Survives Restarts (Priority: P2)

**Goal**: agent-host startup immediately returns registered agents from Redis (within 5s of readiness), before any heartbeat has fired. Entries that fail health ping are marked `inactive`, not removed.

**Independent Test**: Register npc-agent and random-agent, restart agent-host (`kubectl rollout restart`), query `GET /v1/catalog` within 5s of pod readiness → both agents present with `healthStatus: "unverified"` or `"active"` (depending on ping timing). No 120s wait. (Chaos scenario 4 in quickstart.md.)

**Depends on**: Phase 2 complete (RedisCatalogService and startup reconciliation already in place from T008–T011).

*Note: The core implementation for this story landed in Phase 2 (T008–T011) because it is foundational for US2 as well. This phase adds the observability and verification artifacts that make US3 independently testable.*

### Tests

- [X] T022 [US3] Write unit test for startup reconciliation in `server/agent-host/src/__tests__/startupReconciliation.test.ts`: mock catalog with one `rosterAgent` entry (`healthStatus: "unverified"`); mock agent ping succeeds; mock active session exists → assert `spawnRosterForAgent` called; mock agent ping fails → assert entry marked `"inactive"` and `spawnRosterForAgent` NOT called; assert `AGENT_HOST_RECONCILIATION_WAIT_MS` env var logged as deprecated when present; assert agent ping succeeds but NO active session exists → `spawnRosterForAgent` NOT called (session-ended edge case)
- [X] T023 [P] [US3] Write integration test in `server/agent-host/src/catalog/__tests__/RedisCatalogService.integration.test.ts` (skeleton from T007): implement the persist → clear in-memory → restore round-trip test; implement TTL expiry test (write entry, `EXPIRE` key to 1s, wait 2s, reload → empty)

### Observability

- [X] T024 [P] [US3] Add structured log events to `server/agent-host/src/catalog/RedisCatalogService.ts`: `agent-host.catalog.redis-restore` (with entry count), `agent-host.catalog.redis-restore-empty`, `agent-host.catalog.redis-save-error` (non-fatal)
- [X] T025 [P] [US3] Add structured log events to startup reconciliation in `server/agent-host/src/main.ts`: `agent-host.startup-reconciliation.ping-ok` (with agentId), `agent-host.startup-reconciliation.ping-fail` (with agentId, marks inactive), `agent-host.startup-reconciliation.complete` (with spawned/inactive counts)

**Checkpoint**: `pnpm test` passes in `server/agent-host` (including T022, T023 when Redis available). After agent-host restart with Redis populated, catalog endpoint returns both agents immediately.

---

## Phase 6: User Story 4 — Graceful Degradation with Visible Status (Priority: P3)

**Goal**: Each service's health endpoint reflects degraded status when a critical dependency is unreachable. One structured event per state transition replaces one error per failed operation.

**Independent Test**: Shut down agent-host (`kubectl scale --replicas=0`); check npc-agent health endpoint → response body indicates degraded; check logs → one `npc-agent.mcp.degraded` event per ghost (not one per tick). Scale agent-host back up → `recovered` events logged. (US4 acceptance scenario 1 and 3.)

**Depends on**: US1 (T014–T016) for the degraded/recovered events already in place.

### Tests

- [X] T026 [P] [US4] Write unit tests for health endpoint in `ghosts/npc-agent/src/__tests__/health.test.ts`: mock `McpReconnectState` with `status: "degraded"` → assert health endpoint returns `{ status: "degraded" }`; mock `status: "ok"` → assert `{ status: "ok" }`
- [X] T027 [P] [US4] Write unit tests for health endpoint in `ghosts/random-agent/src/__tests__/health.test.ts`: mock heartbeat client in failing state → assert health endpoint returns `{ status: "degraded" }`; mock normal state → assert `{ status: "ok" }`

### Implementation

- [X] T028 [US4] Update npc-agent health endpoint in `ghosts/npc-agent/src/agent.ts` (or equivalent health handler): return `{ status: "degraded", ghosts: [{ ghostId, status }] }` when any ghost has `McpReconnectState.status !== "ok"`; return `{ status: "ok" }` otherwise
- [X] T029 [US4] Update random-agent health endpoint in `ghosts/random-agent/src/agent.ts` (or equivalent): return `{ status: "degraded" }` when heartbeat client has accumulated ≥3 consecutive failures; return `{ status: "ok" }` otherwise
- [X] T030 [US4] Update agent-host health endpoint in `server/agent-host/src/app.ts`: return `{ status: "degraded", inactiveAgents: [agentId, ...] }` when any catalog entry has `healthStatus: "inactive"`; return `{ status: "ok" }` when all known agents are active or unverified

**Checkpoint**: All three services' `/health` endpoints reflect real degraded state. `pnpm test` passes across all three packages.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T031 [P] Update `docs/architecture.md`: add section documenting the heartbeat pattern, Redis catalog durability, and per-ghost MCP reconnect strategy
- [X] T032 [P] Update `CLAUDE.md` Recent Changes section: add 035-resilient-service-components entry
- [X] T033 [P] Review and update `deploy/staging/docker-compose.yml` and any Kubernetes manifests: add `REDIS_URL` env var to agent-host deployment; verify liveness probe does not fire during MCP backoff window (probe timeout > max backoff cap of 60s)
- [X] T034 Run full validation: `pnpm run build` from workspace root (hard gate per constitution); `pnpm test` across all affected packages; `/speckit-verify` passes with GO verdict before opening PR
- [X] T035 Run chaos runbook from `specs/035-resilient-service-components/quickstart.md` against staging: all 4 scenarios pass; document results in PR description

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational: Redis catalog + heartbeat endpoint)
            ├── Phase 3 (US1: NPC reconnect)      ← independent, can run in parallel with Phase 2
            ├── Phase 4 (US2: random-agent heartbeat + reconciliation)   ← needs Phase 2 done
            ├── Phase 5 (US3: catalog observability)  ← implementation in Phase 2; tests/logs here
            └── Phase 6 (US4: health endpoints)   ← needs Phase 3 for degraded/recovered events
                        └── Phase 7 (Polish)
```

**US1 (Phase 3) can start in parallel with Phase 2** — it only touches `ghosts/npc-agent/` and has no dependency on the heartbeat endpoint.

### User Story Dependencies

- **US1 (NPC reconnect)**: Independent — only npc-agent files
- **US2 (random-agent heartbeat)**: Needs Phase 2 heartbeat endpoint live
- **US3 (catalog durability)**: Core in Phase 2; this phase adds observability + integration tests
- **US4 (health endpoints)**: Needs US1 `McpReconnectState` type for npc-agent health check

### Within Each Phase

- Tests MUST be written before implementation (TDD per user request)
- Confirm tests fail before writing implementation code
- `[P]` tasks within a phase can be parallelised

---

## Parallel Opportunities

### Phase 2 + Phase 3 can run concurrently

```
Developer A: T005–T011 (agent-host: Redis catalog + heartbeat)
Developer B: T012–T016 (npc-agent: MCP reconnect)
```

### Within Phase 2

```
Parallel: T005 (RedisCatalogService tests) + T006 (heartbeat handler tests) + T007 (integration test skeleton)
Sequential: T008 → T009 → T010 → T011
```

### Within Phase 4

```
Parallel: T017 (heartbeat client tests) + T018 (reconciliation tests)
Sequential: T019 → T020 → T021
```

---

## Implementation Strategy

### MVP (US1 + US2 — the two P1 stories)

1. Phase 1: Setup (T001–T004)
2. Phase 2: Foundational (T005–T011) ← in parallel with Phase 3
3. Phase 3: US1 NPC reconnect (T012–T016) ← in parallel with Phase 2
4. **Validate**: Chaos scenarios 2 & 3 (npc-agent restart, server restart)
5. Phase 4: US2 random-agent heartbeat (T017–T021)
6. **Validate**: Chaos scenario 1 (agent-host restart) — world is fully alive again

### Full delivery

7. Phase 5: US3 catalog observability (T022–T025)
8. Phase 6: US4 health endpoints (T026–T030)
9. Phase 7: Polish (T031–T035)

---

## Notes

- All test tasks use `vitest` (workspace standard)
- `ioredis-mock` package needed for unit tests — add as `devDependency` in `server/agent-host/package.json` alongside `ioredis`
- Constitution hard gate: `pnpm run build` must pass before PR; `pnpm typecheck` does not substitute
- DCO sign-off required on every commit (`git commit -s`)
- Chaos runbook results must be documented in PR description (T035)
