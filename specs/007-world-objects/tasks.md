# Tasks: World Objects

**Input**: Design documents from `specs/007-world-objects/`  
**Branch**: `007-world-objects`  
**RFC**: `proposals/rfc/0006-world-objects.md`

**Tests**: Smoke tests documented in `quickstart.md`. Unit test tasks included for the map loader extension (existing test file) and the new `ObjectService`. No TDD requested; verification follows implementation.

**Organization**: Tasks are grouped by implementation slice (A–D from `plan.md`), which map directly to spec user stories. Slice A (authoring/loading) must complete before Slice B (ObjectService) which must complete before Slices C and D (MCP tools). Slices C and D are largely independent once Slice B is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label from spec.md (US1–US6)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Types & Config)

**Purpose**: Define the new shared types and env var config that everything else depends on. No user story is blocked on each other, but all are blocked on these.

- [ ] T001 Add `ObjectDefinition` and `ObjectSidecar` types to `shared/types/src/objects.ts` (new file) per IC-010
- [ ] T002 [P] Add `TileObjectSummary` type and extend `TileInspectResult` with optional `objects?: TileObjectSummary[]` in `shared/types/src/ghostMcp.ts`
- [ ] T003 [P] Add `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult` types to `shared/types/src/ghostMcp.ts` per IC-011
- [ ] T004 [P] Add `inspect`, `take`, `drop`, `inventory` to `GHOST_MCP_TOOLS` constant in `shared/types/src/ghostMcp.ts`
- [ ] T005 Re-export new types from `shared/types/src/index.ts`
- [ ] T006 Add `objectsPath?: string` field to `ServerConfig` interface in `server/src/services/ServerConfigService.ts`
- [ ] T007 Read `AIE_MATRIX_OBJECTS` in `parseServerConfigFromEnv()` in `server/src/services/ServerConfigService.ts` — resolve relative paths from repo root (same pattern as `AIE_MATRIX_RULES`); undefined when unset

**Checkpoint**: Shared types compile; `pnpm typecheck` passes on `shared/types/`

---

## Phase 2: Foundational — Map Loader Extension (Slice A)

**Purpose**: Extend `loadHexMap()` to parse the objects sidecar and `object-placement` layer. This is the data source for all object state — nothing downstream works until this is correct.

**⚠️ CRITICAL**: Slice B (ObjectService) cannot be seeded until this phase is complete.

- [ ] T008 Add `name?: string` to `TmjLayer` interface in `server/colyseus/src/mapLoader.ts`
- [ ] T009 Add `capacity?: number` and `initialObjectRefs: string[]` to `CellRecord` in `server/colyseus/src/mapTypes.ts`
- [ ] T010 Add `objectSidecar: Map<string, ObjectDefinition>` to `LoadedMap` in `server/colyseus/src/mapTypes.ts`
- [ ] T011 Extend `loadHexMap()` signature in `server/colyseus/src/mapLoader.ts` to accept optional `objectsPath?: string` parameter
- [ ] T012 In `loadHexMap()`: load and parse `*.objects.json` sidecar — use `objectsPath` when provided (startup error if file missing); fall back to `<map-dir>/<map-basename>.objects.json` (missing = empty `Map`, no error); malformed JSON throws `MapLoadError`
- [ ] T013 In `loadHexMap()`: read `objects` string property from each parsed tileset tile in `tilesetParser.ts` output (`ParsedTile.properties["objects"]`); split on comma; populate `initialObjectRefs` on each `CellRecord` for every tile instance of that class; warn and skip unknown objectRefs not in sidecar
- [ ] T014 In `loadHexMap()`: scan `tmj.layers` for a layer with `name === "object-placement"`; if found, iterate its `data` array with the same grid-to-H3 logic as the navigable layer; treat each non-empty cell's tile `type` as an objectRef; append to `initialObjectRefs` for that cell (composing with class-level placements)
- [ ] T015 Update `server/src/services/ServerConfigService.ts` to pass `ServerConfig.objectsPath` to `loadHexMap()` at startup in `server/src/index.ts`
- [ ] T016 Add unit test cases to `server/colyseus/src/mapLoader.test.ts`: map with sidecar loads definitions; map without sidecar has empty `objectSidecar`; tile class property populates `initialObjectRefs` on all matching cells; `object-placement` layer populates specific cells; both sources compose on same cell; unknown objectRef logs warning and is skipped; malformed sidecar throws `MapLoadError`

**Checkpoint**: `pnpm test` passes including new mapLoader cases; `pnpm typecheck` passes

---

## Phase 3: User Story 6 — Object World State & Colyseus Broadcast (Slice B / US6)

**Goal**: `ObjectService` seeded from `LoadedMap`; Colyseus schema updated; capacity accounting updated. The server starts with objects in place and broadcasts their positions.

**Independent Test**: Start server with sandbox map + sidecar. Confirm startup succeeds. Confirm `go` to a tile occupied by a `capacityCost: 1` statue on a `capacity: 1` tile is blocked.

- [ ] T017 [US6] Add `tileObjectRefs: MapSchema<string>` and `ghostObjectRefs: MapSchema<string>` to `WorldSpectatorState` in `server/colyseus/src/room-schema.ts` per IC-012; initialize both in constructor
- [ ] T018 [US6] Add `setTileObjects(h3Index: string, objectRefs: string[]): void` and `setGhostInventory(ghostId: string, objectRefs: string[]): void` to `ColyseusWorldBridge` interface and `MatrixRoomBridge` implementation in `server/world-api/src/colyseus-bridge.ts`; empty array → delete key from MapSchema
- [ ] T019 [US6] Create `server/world-api/src/ObjectService.ts`: Effect `Context.Tag`; constructor accepts `LoadedMap`; seeds `tileObjects: Map<string, string[]>` and `ghostInventory: Map<string, string[]>` from `initialObjectRefs`; exposes `getObjectsOnTile(h3Index)`, `getGhostInventory(ghostId)`, `inspectObject(h3Index, objectRef)`, `takeObject(ghostId, h3Index, objectRef)`, `dropObject(ghostId, h3Index, objectRef, capacity)` — all synchronous
- [ ] T020 [US6] Add new `WorldApiObjectError` tagged error classes to `server/world-api/src/world-api-errors.ts`: `WorldApiObjectNotHere`, `WorldApiObjectNotFound`, `WorldApiObjectNotCarriable`, `WorldApiObjectNotCarrying`, `WorldApiTileFull`; add all to `WorldApiError` union
- [ ] T021 [US6] Cover all new `WorldApiObjectError` variants in `server/src/errors.ts:errorToResponse()` using `Match.exhaustive`
- [ ] T022 [US6] Add `computeTileObjectCost(h3Index: string, objectService: ObjectServiceImpl): number` helper to `server/world-api/src/movement.ts`; call it inside `evaluateGo()` when checking tile capacity so object costs reduce available capacity
- [ ] T023 [US6] Wire `ObjectService` Layer in `server/src/index.ts`: construct with `LoadedMap` from `WorldBridgeService`; add to `ManagedRuntime`; add to `ToolServices` union in `server/world-api/src/mcp-server.ts`
- [ ] T024 [US6] After seeding `ObjectService`, call `bridge.setTileObjects()` for every cell with non-empty `initialObjectRefs` so Colyseus has initial state on startup
- [ ] T025 [US6] Add unit tests for `ObjectService` in `server/world-api/src/ObjectService.test.ts`: seed from LoadedMap; `takeObject` moves ref from tile to ghost; `dropObject` moves ref from ghost to tile; `dropObject` respects capacity; double-take returns error; take non-carriable returns error

**Checkpoint**: `pnpm typecheck` passes (Effect R channel satisfied); `pnpm dev` starts; `go` to full tile is blocked; Smoke Test 4 in `quickstart.md` passes

---

## Phase 4: User Story 2 — `inspect` Tool (Slice C / US2)

**Goal**: Ghost on same tile as an object can inspect it and receive its description. Attempting inspect from adjacent tile returns `NOT_HERE`.

**Independent Test**: Smoke Test 3 from `quickstart.md` — inspect succeeds on current tile; `NOT_HERE` returned from adjacent tile.

- [ ] T026 [US2] Add `inspectEffect()` function to `server/world-api/src/mcp-server.ts`: calls `ObjectService.inspectObject()`; returns `InspectResult`; maps `WorldApiObjectNotHere` → `NOT_HERE`, `WorldApiObjectNotFound` → `NOT_FOUND`
- [ ] T027 [US2] Register `inspect` tool in `buildGhostMcpServer()` in `server/world-api/src/mcp-server.ts` with `inputSchema: { objectRef: z.string() }` and description per IC-011
- [ ] T028 [US2] Implement `inspectObject()` in `ObjectService`: verify objectRef exists in sidecar (else `NOT_FOUND`); verify objectRef present in `tileObjects[h3Index]` (else `NOT_HERE`); return name + optional description

**Checkpoint**: Smoke Test 3 in `quickstart.md` passes

---

## Phase 5: User Story 3 — `take`, `drop`, `inventory` Tools (Slice C / US3 + US4)

**Goal**: Ghost can pick up a carriable object, carry it, and drop it on another tile. Inventory reflects state at each step.

**Independent Test**: Smoke Test 2 from `quickstart.md` — full `look → take → inventory → move → drop → look` round-trip.

- [ ] T029 [US3] Implement `takeObject()` in `ObjectService`: verify objectRef in sidecar (`NOT_FOUND`); verify on tile (`NOT_HERE`); verify carriable (`NOT_CARRIABLE`); verify ruleset permits (stub — pass when no `PICK_UP` rule loaded, `RULESET_DENY` otherwise); move first matching ref from `tileObjects` to `ghostInventory`; call `bridge.setTileObjects()` and `bridge.setGhostInventory()`
- [ ] T030 [US3] Implement `dropObject()` in `ObjectService`: verify ghost carrying ref (`NOT_CARRYING`); verify ruleset permits (stub — `RULESET_DENY` when `PUT_DOWN` rule loaded and denies); verify tile capacity not exceeded (`TILE_FULL`); move ref from `ghostInventory` to `tileObjects`; call `bridge.setTileObjects()` and `bridge.setGhostInventory()`
- [ ] T031 [US3] Add `takeEffect()` to `server/world-api/src/mcp-server.ts`: calls `ObjectService.takeObject(ghostId, h3Index, objectRef)`; returns `TakeResult`
- [ ] T032 [US3] Register `take` tool in `buildGhostMcpServer()` with `inputSchema: { objectRef: z.string() }` and description per IC-011
- [ ] T033 [US3] Add `dropEffect()` to `server/world-api/src/mcp-server.ts`: calls `ObjectService.dropObject(ghostId, h3Index, objectRef)`; returns `DropResult`
- [ ] T034 [US3] Register `drop` tool in `buildGhostMcpServer()` with `inputSchema: { objectRef: z.string() }` and description per IC-011
- [ ] T035 [US4] Add `inventoryEffect()` to `server/world-api/src/mcp-server.ts`: calls `ObjectService.getGhostInventory(ghostId)`; enriches each objectRef with `name` from sidecar; returns `InventoryResult` — never fails
- [ ] T036 [US4] Register `inventory` tool in `buildGhostMcpServer()` (no inputSchema) with description per IC-011

**Checkpoint**: Smoke Test 2 in `quickstart.md` passes (take → inventory → drop → look round-trip)

---

## Phase 6: User Story 1 — Extended `look` Response (Slice D / US1)

**Goal**: `look` returns visible objects with compass `at` values. Ghost agents can discover objects by direction without any additional queries.

**Independent Test**: Smoke Test 1 from `quickstart.md` — `look` response includes objects array with correct `at` values.

- [ ] T037 [US1] Extend `lookEffect()` in `server/world-api/src/mcp-server.ts` for `look { at: "here" }`: call `ObjectService.getObjectsOnTile(hereId)` for the current tile and each adjacent tile; build `TileObjectSummary[]` with `at: "here"` for current tile objects, `at: <compass>` for adjacent; set `objects` field on `TileInspectResult` only when array is non-empty (omit field entirely when empty for backward compat)
- [ ] T038 [US1] Extend `lookEffect()` for `look { at: "around" }`: each `TileInspectResult` in the `neighbors` array gains its own `objects` array containing only that tile's objects (all with `at: "here"` relative to that tile — agents already know the compass direction from the response structure)
- [ ] T039 [US1] Extend `lookEffect()` for `look { at: <compass> }`: single-tile result gains `objects` array for that tile's objects (all `at: "here"`)
- [ ] T040 [US1] Create `maps/sandbox/freeplay.objects.json` with `sign-welcome` (Sign, non-carriable, cost 0), `key-brass` (Key:Brass, carriable, cost 0), `statue` (Obstacle, non-carriable, cost 1) per `quickstart.md` authoring section
- [ ] T041 [US1] Add `objects: "sign-welcome"` property to a tile class in `maps/sandbox/color-set.tsx`; add `objects: "key-brass"` to another; add `objects: "statue"` to a `capacity: 1` tile class

**Checkpoint**: Smoke Test 1 in `quickstart.md` passes; objects visible in `look` response

---

## Phase 7: User Story 5 — Capacity Blocking (US5)

**Goal**: Objects with `capacityCost > 0` correctly reduce available tile capacity for both `go` and `drop`.

**Independent Test**: Smoke Test 4 from `quickstart.md` — ghost blocked from entering a full tile; `drop` fails on full tile.

*Note: Capacity accounting in `movement.ts` and `dropObject()` is implemented in T022 (Phase 3) and T030 (Phase 5). This phase verifies it end-to-end and adds the sandbox demonstration.*

- [ ] T042 [US5] Verify `evaluateGo()` in `server/world-api/src/movement.ts` correctly sums `capacityCost` from `computeTileObjectCost()` when deciding whether a ghost can enter; add or update unit test for ghost-blocked-by-object-on-tile scenario in `server/world-api/src/movement_go_rules.test.ts`
- [ ] T043 [US5] Confirm Smoke Test 4 (`quickstart.md`) passes: one ghost + statue on `capacity: 1` tile blocks second ghost; `drop` of a cost-1 object on full tile returns `TILE_FULL`

**Checkpoint**: Capacity enforcement correct for both `go` and `drop`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, RFC sync, typecheck gate, final verification.

- [ ] T044 [P] Update `proposals/rfc/0006-world-objects.md` status from `draft` to `under review`; add note in Open Questions that Neo4j persistence is deferred to a follow-on RFC; note `AIE_MATRIX_OBJECTS` env var added
- [ ] T045 [P] Update `docs/architecture.md`: add object state (in-memory `ObjectService`, `tileObjects`/`ghostInventory` maps) to the world model section; note `AIE_MATRIX_OBJECTS` in the env var table
- [ ] T046 [P] Update `server/world-api/README.md`: add `inspect`, `take`, `drop`, `inventory` to the MCP tool inventory; note `AIE_MATRIX_OBJECTS` env var
- [ ] T047 [P] Update `maps/sandbox/README.md` (or create if absent): document `*.objects.json` sidecar format, `objects` tileset property convention, `object-placement` layer convention, and `AIE_MATRIX_OBJECTS` env var
- [ ] T048 [P] Update `shared/types/` package README: document new exports (`ObjectDefinition`, `ObjectSidecar`, `TileObjectSummary`, `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult`)
- [ ] T049 Run `pnpm typecheck` across all packages — confirm zero errors (compile gate: Effect R channel satisfied, `Match.exhaustive` covers all new error tags)
- [ ] T050 Run all four smoke tests from `quickstart.md` against a live dev server; confirm each passes
- [ ] T051 Verify `proposals/rfc/0006-world-objects.md` remains in sync with the implemented behavior; note any divergences for discussion (do not resolve without approval)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately; T002/T003/T004 can run in parallel
- **Phase 2 (Map Loader)**: Depends on Phase 1 (needs `ObjectDefinition` type from T001) — **blocks all phases**
- **Phase 3 (ObjectService)**: Depends on Phase 2 — blocks Phases 4–7
- **Phase 4 (`inspect`)**: Depends on Phase 3 — independent of Phase 5
- **Phase 5 (`take`/`drop`/`inventory`)**: Depends on Phase 3 — independent of Phase 4
- **Phase 6 (`look` extension)**: Depends on Phase 3 — independent of Phases 4/5
- **Phase 7 (capacity)**: Depends on Phase 3; T022 (capacity helper) done in Phase 3, T030 (drop capacity check) in Phase 5 — verification only in Phase 7
- **Phase 8 (Polish)**: Depends on all phases complete; T044–T048 can run in parallel

### User Story Dependencies

- **US6 (Authoring/Loading)**: Phase 2 + Phase 3 — foundation for everything
- **US1 (Discovery)**: Phase 6 — depends on Phase 3; independent of US2/US3/US4
- **US2 (Inspect)**: Phase 4 — depends on Phase 3; independent of US3/US4
- **US3 (Take/Drop)**: Phase 5 — depends on Phase 3; independent of US2/US4
- **US4 (Inventory)**: Phase 5 (T035–T036) — depends on Phase 3; done alongside US3
- **US5 (Capacity)**: Phase 7 — verification of T022 (Phase 3) + T030 (Phase 5)

### Within Each Phase

- Types before service consumers
- Service (`ObjectService`) before tool handlers
- Tool handlers before smoke test verification

### Parallel Opportunities

Within Phase 1: T002, T003, T004 (all in `ghostMcp.ts` — coordinate on same file, or split into sequential)  
Within Phase 5: T029+T031+T032 (take) and T035+T036 (inventory) can proceed in parallel with T030+T033+T034 (drop) if two contributors  
Within Phase 8: T044, T045, T046, T047, T048 all touch different files — fully parallel

---

## Parallel Example: Phase 3 (ObjectService)

```
# These can proceed in parallel once Phase 2 is complete:
Task T017: room-schema.ts (Colyseus schema)
Task T018: colyseus-bridge.ts (bridge methods)
Task T019: ObjectService.ts (new file)
Task T020: world-api-errors.ts (error types)

# Then sequentially:
Task T021: errors.ts (Match.exhaustive — needs T020)
Task T022: movement.ts (capacity helper — needs T019)
Task T023: index.ts wiring (needs T019, T020, T021)
Task T024: initial broadcast (needs T023)
Task T025: ObjectService.test.ts (needs T019)
```

---

## Implementation Strategy

### MVP First (US1 Discovery — most visible value)

1. Complete Phase 1 (Setup types)
2. Complete Phase 2 (Map loader — loads objects)
3. Complete Phase 3 (ObjectService — objects in world state)
4. Complete Phase 6 (extended `look` — agents see objects)
5. **STOP and VALIDATE**: `look` returns objects; Smoke Test 1 passes
6. Demo: ghost walking the map sees signs and keys in `look` output

### Incremental Delivery

1. Setup + Map Loader → objects loaded at startup
2. ObjectService + `look` → objects visible to agents (US1 MVP)
3. `inspect` → objects readable (US2)
4. `take` / `drop` / `inventory` → objects carriable (US3 + US4)
5. Capacity enforcement verification (US5)
6. Polish + RFC sync

### Parallel Team Strategy

Once Phase 3 (ObjectService) is complete:
- **Developer A**: Phase 4 (`inspect` tool)
- **Developer B**: Phase 5 (`take`/`drop`/`inventory` tools)
- **Developer C**: Phase 6 (extended `look`)

---

## Notes

- `[P]` tasks touch different files and have no dependency on incomplete tasks in their phase
- All MCP tool tasks follow the established Effect `Context.Tag` / `Layer` pattern — read `docs/guides/effect-ts.md` before starting Phase 4+
- `pnpm typecheck` is the primary correctness gate: an unsatisfied Effect `R` channel or missing `Match.exhaustive` branch surfaces here before any test
- DCO sign-off required on all commits: `git commit -s`
- Any divergence from `proposals/rfc/0006-world-objects.md` discovered during implementation must be flagged for discussion — do not silently resolve
- Smoke tests in `quickstart.md` reference `freeplay.objects.json`; T040/T041 must be done before running them
