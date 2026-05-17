# Tasks: Map Management — Publish, Activate, and Archive

**Input**: Design documents from `specs/014-map-management/`  
**Branch**: `015-map-management`  
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[USx]**: User story phase task (maps to spec.md US1–US4)
- No test tasks unless requested — verification uses quickstart.md curl steps

---

## Phase 1: Setup

**Purpose**: Install dependencies, extend shared contracts, add Neo4j constraints

- [ ] T001 Add `@google-cloud/storage`, `busboy`, `ioredis`, `ulid` to `server/world-api/package.json`
- [ ] T002 [P] Add `GCS_BUCKET`, `ADMIN_TOKEN`, `LIVE_SESSION_ID` env var accessors to `shared/root-env/src/index.ts`
- [ ] T003 [P] Add `WORLD_EVENTS_CHANNEL = "aie-matrix:world-events"` constant to `shared/types/src/index.ts` (or create `shared/types/src/channels.ts` if that file does not exist)
- [ ] T004 Add `(:Map)` and `(:LiveSession)` uniqueness constraints to the Neo4j setup block in `server/src/index.ts` alongside the existing `ensureCellH3UniqueConstraint` call

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure that all user stories depend on. Complete before any story phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 [P] Create `GcsService` (`Context.Tag` + `Layer`) in `server/world-api/src/gcs/GcsService.ts` — `upload(objectPath, buffer)` and `download(objectPath)` operations; when `GCS_BUCKET` is unset, use `tmp/gcs/{objectPath}` as a local-file stub so Tier 1 dev works without GCS credentials
- [ ] T006 [P] Create `RedisPublishService` (`Context.Tag` + `Layer`) in `server/world-api/src/redis/RedisPublishService.ts` — `publish(channel, payload)` using `ioredis`; when `REDIS_URL` is unset, return a no-op `Layer` that logs a debug line and returns `Effect.void`
- [ ] T007 [P] Create `checkAdminToken(req)` in `server/world-api/src/admin-auth.ts` — reads `Authorization: Bearer {token}` header, compares to `process.env.ADMIN_TOKEN`; fails with `AdminAuthError` on mismatch; never logs the token value
- [ ] T008 Create `requireNeo4j()` guard function in `server/world-api/src/neo4j-guard.ts` — returns `Effect.fail` with a structured error when `process.env.NEO4J_URI` is absent; route handlers call this first and respond `503 { error: "NEO4J_REQUIRED" }` to preserve the existing `AIE_MATRIX_MAP` file path as the no-DB fallback
- [ ] T009 Extend the CORS `OPTIONS` handler pathname list in `server/src/index.ts` to include `/maps`, `/maps/`, `/maps/*`, `/live`, `/live/`, `/live/*`
- [ ] T010 Add `GcsService` and `RedisPublishService` to `MatrixRuntimeServices`, `Layer.mergeAll(...)`, and `ManagedRuntime` in `server/src/index.ts`

**Checkpoint**: Foundation ready — all user story phases can now proceed.

---

## Phase 3: User Story 1 — Operator Publishes a Map (Priority: P1) 🎯 MVP

**Goal**: `POST /maps` validates a `.map.gram`, uploads to GCS, syncs `(:Cell)` nodes to Neo4j, and marks the map `"published"`. `GET /maps` and `GET /maps/:mapId` return map metadata.

**Independent test**: `curl -X POST http://localhost:8787/maps -H "Authorization: Bearer $ADMIN_TOKEN" -F "mapId=sandbox-freeplay" -F "file=@maps/sandbox/freeplay.map.gram"` returns `{ mapId, gcsPath, status: "published" }`. Neo4j query `MATCH (c:Cell { sourceMapId: "sandbox-freeplay" }) RETURN count(c)` returns non-zero. (See quickstart.md Step 1.)

- [ ] T011 Add `MapPublishError`, `MapAlreadyActiveError`, `MultipartParseError`, and `AdminAuthError` tagged error types to `server/world-api/src/map/map-errors.ts`
- [ ] T012 [P] Create `MapManagementService` (`Context.Tag` + `Layer`) in `server/world-api/src/map/MapManagementService.ts` — implement `publish(mapId, bytes)`: parse and validate gram bytes (reuse existing `@relateby/pattern` `Gram.parse`; check `kind: "matrix-map"`, LayerStack presence, all navigable cells have `h3Index`); upload to `GcsService`; MERGE `(:Cell)` nodes with `sourceMapId`; upsert `(:Map)` node. Implement `list(status?)` and `get(mapId)` as Neo4j reads.
- [ ] T013 [P] Create `parseMultipart(req)` helper using `busboy` in `server/world-api/src/map/multipart.ts` — returns `Effect<{ mapId: string; fileBytes: Buffer }, MultipartParseError>`; validates that both `mapId` and `file` fields are present
- [ ] T014 [US1] Implement `tryHandleMapManagement(req, res, url, corsHeaders)` route handler in `server/world-api/src/map/MapManagementRoutes.ts` — handles `POST /maps` (calls `checkAdminToken`, `parseMultipart`, `MapManagementService.publish`), `GET /maps` (with optional `?status=` filter), `GET /maps/:mapId`; follows the existing `Effect.Effect<boolean, ..., MapManagementService>` handler signature pattern
- [ ] T015 [US1] Add `MapPublishError`, `MultipartParseError`, and `AdminAuthError` HTTP response mappings to `server/src/errors.ts` `errorToResponse()` using `Match.exhaustive`
- [ ] T016 [US1] Export `MapManagementService`, `makeMapManagementLayer`, and `tryHandleMapManagement` from `server/world-api/src/index.ts`
- [ ] T017 [US1] Register `tryHandleMapManagement` in `server/src/index.ts` request handler (POST and GET method blocks); add `makeMapManagementLayer` to `Layer.mergeAll`; add `MapManagementService` to `MatrixRuntimeServices` type
- [ ] T018 [US1] Verify Story 1 end-to-end using quickstart.md Step 1 curl commands; confirm Neo4j cell count and `GET /maps` response

**Checkpoint**: `POST /maps` + `GET /maps` fully functional. Re-publish idempotency verified. Archived-map re-publish reverts status.

---

## Phase 4: User Story 2 — Operator Starts a Live Session (Priority: P2)

**Goal**: `POST /live` creates a session bound to a published map, notifies services via Redis. `GET /live` and `GET /live/:id` expose session state. Server processes bind to their session at startup via `LIVE_SESSION_ID`.

**Independent test**: `curl -X POST http://localhost:8787/live -d '{"name":"Dev","maps":[{"mapId":"sandbox-freeplay","role":"primary"}]}'` returns a session object with `status: "active"`. `GET /live?status=active` returns it. (See quickstart.md Step 2.)

- [ ] T019 Create `live-errors.ts` in `server/world-api/src/live/live-errors.ts` — `LiveSessionNotFoundError`, `LiveSessionMapNotPublishedError`, `LiveSessionAlreadyEndedError` tagged error types
- [ ] T020 Create `LiveSessionService` (`Context.Tag` + `Layer`) in `server/world-api/src/live/LiveSessionService.ts` — implement `start(name, maps)`: resolve `mapId` values to `(:Map { status: "published" })`; create `(:LiveSession)` with ULID; create `[:USES { role }]` edges; publish `world.session-started` via `RedisPublishService`. Implement `list(status?)` and `get(id)` as Neo4j reads.
- [ ] T021 Implement `tryHandleLiveSession(req, res, url, corsHeaders)` route handler in `server/world-api/src/live/LiveSessionRoutes.ts` — handles `POST /live` (admin-only), `GET /live` (public), `GET /live/:id` (public)
- [ ] T022 [US2] Add `LiveSession*Error` HTTP response mappings to `server/src/errors.ts`
- [ ] T023 [US2] Export `LiveSessionService`, `makeLiveSessionLayer`, and `tryHandleLiveSession` from `server/world-api/src/index.ts`
- [ ] T024 [US2] Register `tryHandleLiveSession` routes and `makeLiveSessionLayer` in `server/src/index.ts`; add `LiveSessionService` to `MatrixRuntimeServices`
- [ ] T025 [US2] Implement session-binding startup logic in `server/src/index.ts`: if `AIE_MATRIX_MAP` is set → existing path; elif `LIVE_SESSION_ID` is set → `GET /live/:id` then load primary map from GCS; else → `GET /live?status=active`, assert exactly one session, fail loudly otherwise
- [ ] T026 [US2] Implement `/health` endpoint in `server/src/index.ts` — returns `503 { status: "starting" | "binding" }` before session bound; `200 { status: "ok", sessionId }` after; follow the `spectatorMetaReady` flag pattern already present at line ~153
- [ ] T027 [US2] Verify Story 2 end-to-end using quickstart.md Step 2 curl commands; confirm `GET /live?status=active` and `/health` 200 after binding

**Checkpoint**: `POST /live` + `GET /live` functional. Startup binding logic works for all three cases. `/health` returns 200 after session bound.

---

## Phase 5: User Story 3 — Operator Switches Map on Running Session (Priority: P3)

**Goal**: `PATCH /live/:id/maps` swaps the primary map, computes `removedCells`/`addedCells` from Neo4j (no GCS download), broadcasts `world.map-changed`, and triggers ghost evacuation in world-api.

**Independent test**: Publish two maps, start a session with map A, PATCH to map B, verify `world.map-changed` broadcast payload contains correct `removedCells`/`addedCells`, and a `go` to a removed cell returns `CELL_NOT_IN_MAP`. (See quickstart.md Step 3.)

- [ ] T028 Extend `LiveSessionService` in `server/world-api/src/live/LiveSessionService.ts` with `switchMaps(id, maps)`: query old and new cell sets from Neo4j by `sourceMapId`; compute `removedCells` / `addedCells` as set difference; update `[:USES]` edges; publish `world.map-changed` via `RedisPublishService`
- [ ] T029 Add `PATCH /live/:id/maps` handler (admin-only) to `server/world-api/src/live/LiveSessionRoutes.ts`
- [ ] T030 [US3] Implement ghost evacuation in `server/world-api/src/live/evacuation.ts` — for each ghost on a `removedCell`: if primary map declares `respawnCell`, teleport (update Neo4j position + fire Colyseus bridge `setGhostCell`); otherwise set ghost limbo state; `go` and `whereami` on limbo ghosts return `GHOST_IN_LIMBO`
- [ ] T031 [US3] Add `GHOST_IN_LIMBO` error type and HTTP mapping — add to `world-api-errors.ts` and `server/src/errors.ts`
- [ ] T032 [US3] Trigger evacuation synchronously within `LiveSessionService.switchMaps` after edge update (world-api calls its own internal rebuild directly rather than consuming its own Redis event; the Redis event is for notifying Colyseus and ghost-house)
- [ ] T033 [US3] Rebuild in-memory movement graph and cell index in world-api after map switch — extend `movement.ts` or `MapService` with a `reloadActiveMap(mapId)` function called from `switchMaps`
- [ ] T034 [US3] Add speaker-room claim release on removed polygons — call RFC-0012 speaker room cleanup with `removedCells` set after evacuation
- [ ] T035 [US3] Verify Story 3 end-to-end using quickstart.md Step 3 curl commands; confirm `removedCells` in broadcast, `CELL_NOT_IN_MAP` on stale cell, ghost limbo state

**Checkpoint**: `PATCH /live/:id/maps` functional. Movement graph rebuilt synchronously. Ghost evacuation and limbo state working.

---

## Phase 6: User Story 4 — Archive Map and End Session (Priority: P4)

**Goal**: `DELETE /maps/:mapId` archives a map (rejects with 409 if in active session). `DELETE /live/:id` ends a session and broadcasts `world.session-ended`.

**Independent test**: Start a session, try to archive its primary map → `409`. End the session → `204`. Archive the map → `204`. `GET /maps?status=published` no longer includes it. (See quickstart.md Step 4.)

- [ ] T036 Extend `MapManagementService` in `server/world-api/src/map/MapManagementService.ts` with `archive(mapId)`: Cypher checks for active `[:USES]` references before setting `status = "archived"`; returns `MapAlreadyActiveError` if in use
- [ ] T037 Add `DELETE /maps/:mapId` handler (admin-only) to `server/world-api/src/map/MapManagementRoutes.ts`
- [ ] T038 [US4] Extend `LiveSessionService` in `server/world-api/src/live/LiveSessionService.ts` with `end(id)`: set `status = "ended"`, `endedAt = now()`; publish `world.session-ended` via `RedisPublishService`
- [ ] T039 [US4] Add `DELETE /live/:id` handler (admin-only) to `server/world-api/src/live/LiveSessionRoutes.ts`
- [ ] T040 [US4] Verify Story 4 end-to-end using quickstart.md Step 4 curl commands; confirm `409` on active-map archive, `204` on end session, `204` on archive after session ended

**Checkpoint**: Full lifecycle complete — publish → activate → switch → archive/end all functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T041 [P] Update `docs/architecture.md` — add `GCS_BUCKET`, `ADMIN_TOKEN`, `LIVE_SESSION_ID` to the "Selected environment variables" table; update the "Map formats" section to describe the GCS/Neo4j runtime path for Tier 2/3
- [ ] T042 [P] Update `proposals/rfc/0013-map-management.md` status from `draft` to `accepted`
- [ ] T043 [P] Update `server/world-api/README.md` — document `/maps/` and `/live/` endpoints, `ADMIN_TOKEN` and `LIVE_SESSION_ID` env vars, and the local Neo4j requirement for map management
- [ ] T044 Run the full quickstart.md verification sequence end-to-end and confirm all five steps pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately; T002 and T003 are parallel
- **Foundational (Phase 2)**: Requires Phase 1 complete; T005, T006, T007 are parallel with each other
- **US1 (Phase 3)**: Requires Phase 2 complete; T012 and T013 are parallel with each other
- **US2 (Phase 4)**: Requires Phase 2 complete; can start in parallel with US1 — but E2E test requires a published map (US1 checkpoint)
- **US3 (Phase 5)**: Requires US1 + US2 complete (needs a running session with a published map to test)
- **US4 (Phase 6)**: Requires US1 complete for map archive; US2 complete for session end; can partially parallel with US3
- **Polish (Phase 7)**: Requires all desired stories complete; T041, T042, T043 are parallel with each other

### Story Dependencies (runtime)

- **US1**: Independent — only needs Neo4j and GCS stub
- **US2**: Implementation independent; E2E test depends on US1 (needs a published map to activate)
- **US3**: Depends on US1 + US2 — cannot test without a running session on a published map
- **US4**: Archive path depends on US1; end-session path depends on US2

### Parallel Opportunities

```bash
# Phase 1: T002 and T003 can run in parallel (different packages)
T002: shared/root-env/src/index.ts
T003: shared/types/src/

# Phase 2: Three parallel tracks
T005: server/world-api/src/gcs/GcsService.ts
T006: server/world-api/src/redis/RedisPublishService.ts
T007: server/world-api/src/admin-auth.ts

# Phase 3: Two parallel tracks before route handler
T012: MapManagementService.ts
T013: multipart.ts

# Phase 7: All polish tasks in parallel
T041: docs/architecture.md
T042: proposals/rfc/0013-map-management.md
T043: server/world-api/README.md
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundational (T005–T010)
3. Complete Phase 3: US1 — Publish Map (T011–T018)
4. **STOP and VALIDATE**: `POST /maps` + `GET /maps` working with Neo4j cell sync
5. Ship as usable publish endpoint

### Incremental Delivery

1. Phase 1 + 2 → Foundation ✓
2. Phase 3 → Publish endpoint (US1 MVP) ✓
3. Phase 4 → Session start + health + startup binding (US2) ✓
4. Phase 5 → Live map switch + ghost evacuation (US3) ✓
5. Phase 6 → Archive + end session (US4) ✓
6. Phase 7 → Docs + RFC acceptance ✓

---

## Notes

- `[P]` tasks operate on different files and have no dependency on other in-progress tasks in the same phase
- Each story phase ends with a verification task (`T018`, `T027`, `T035`, `T040`) referencing the quickstart.md curl steps
- US3 ghost evacuation (T030, T031, T032) is the highest-risk block — world-api triggers evacuation synchronously rather than consuming its own Redis event, which simplifies Tier 1 dev (no self-subscription needed)
- Speaker room integration (T034) requires RFC-0012 to be implemented; if not yet merged, stub with a `// TODO RFC-0012` comment and a no-op
- Tier 2/3 deployment (Dockerfiles, docker-compose, Helm) is out of scope — deferred to ADR-0007 follow-on
