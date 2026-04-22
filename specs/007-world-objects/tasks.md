# Tasks: World Items

**Input**: Design documents from `specs/007-world-objects/`  
**Branch**: `007-world-objects`  
**RFC**: `proposals/rfc/0006-world-objects.md`

**Tests**: Smoke tests documented in `quickstart.md`. Unit test tasks included for the map loader extension (existing test file) and the new `ItemService`. No TDD requested; verification follows implementation.

**Organization**: Tasks are grouped by implementation slice (A–D from `plan.md`), which map directly to spec user stories. Slice A (authoring/loading) must complete before Slice B (ItemService) which must complete before Slices C and D (MCP tools). Slices C and D are largely independent once Slice B is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label from spec.md (US1–US6)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Types & Config)

**Purpose**: Define the new shared types and env var config that everything else depends on. No user story is blocked on each other, but all are blocked on these.

- [x] T001 Add `ItemDefinition` and `ItemSidecar` types to `shared/types/src/items.ts` (new file) per IC-010
- [x] T002 [P] Add `TileItemSummary` type and extend `TileInspectResult` with optional `items?: TileItemSummary[]` in `shared/types/src/ghostMcp.ts`
- [x] T003 [P] Add `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult` types to `shared/types/src/ghostMcp.ts` per IC-011
- [x] T004 [P] Add `inspect`, `take`, `drop`, `inventory` to `GHOST_MCP_TOOLS` constant in `shared/types/src/ghostMcp.ts`
- [x] T005 Re-export new types from `shared/types/src/index.ts`
- [x] T006 Add `itemsPath?: string` field to `ServerConfig` interface in `server/src/services/ServerConfigService.ts`
- [x] T007 Read `AIE_MATRIX_ITEMS` in `parseServerConfigFromEnv()` in `server/src/services/ServerConfigService.ts` — resolve relative paths from repo root (same pattern as `AIE_MATRIX_RULES`); undefined when unset

**Checkpoint**: Shared types compile; `pnpm typecheck` passes on `shared/types/` ✓

---

## Phase 2: Foundational — Map Loader Extension (Slice A)

**Purpose**: Extend `loadHexMap()` to parse the items sidecar and `item-placement` layer. This is the data source for all object state — nothing downstream works until this is correct.

**⚠️ CRITICAL**: Slice B (ItemService) cannot be seeded until this phase is complete.

- [x] T008 Add `name?: string` to `TmjLayer` interface in `server/colyseus/src/mapLoader.ts`
- [x] T009 Add `capacity?: number` and `initialItemRefs: string[]` to `CellRecord` in `server/colyseus/src/mapTypes.ts`
- [x] T010 Add `itemSidecar: Map<string, ItemDefinition>` to `LoadedMap` in `server/colyseus/src/mapTypes.ts`
- [x] T011 Extend `loadHexMap()` signature in `server/colyseus/src/mapLoader.ts` to accept optional `itemsPath?: string` parameter
- [x] T012 In `loadHexMap()`: load and parse `*.items.json` sidecar — use `itemsPath` when provided (startup error if file missing); fall back to `<map-dir>/<map-basename>.items.json` (missing = empty `Map`, no error); malformed JSON throws `MapLoadError`
- [x] T013 In `loadHexMap()`: read `items` string property from each parsed tileset tile (`ParsedTile.properties["items"]`); split on comma; populate `initialItemRefs` on each `CellRecord` for every tile instance of that class; warn and skip unknown itemRefs not in sidecar
- [x] T014 In `loadHexMap()`: scan `tmj.layers` for a layer with `name === "item-placement"`; if found, iterate its `data` array with the same grid-to-H3 logic as the navigable layer; treat each non-empty cell's tile `type` as an itemRef; append to `initialItemRefs` for that cell (composing with class-level placements)
- [x] T015 Update `server/src/services/ServerConfigService.ts` to pass `ServerConfig.itemsPath` to `loadHexMap()` at startup in `server/src/index.ts`
- [x] T016 Add unit test cases to `server/colyseus/src/mapLoader.test.ts`: map with sidecar loads definitions; map without sidecar has empty `itemSidecar`; tile class property populates `initialItemRefs` on all matching cells; unknown itemRef logs warning and is skipped; malformed sidecar throws `MapLoadError`; explicit `itemsPath` missing throws `MapLoadError`

**Checkpoint**: `pnpm test` passes including new mapLoader cases; `pnpm typecheck` passes ✓

---

## Phase 3: User Story 6 — Object World State & Colyseus Broadcast (Slice B / US6)

**Goal**: `ItemService` seeded from `LoadedMap`; Colyseus schema updated; capacity accounting updated. The server starts with items in place and broadcasts their positions.

**Independent Test**: Start server with sandbox map + sidecar. Confirm startup succeeds. Confirm `go` to a tile occupied by a `capacityCost: 1` statue on a `capacity: 1` tile is blocked.

- [x] T017 [US6] Add `tileItemRefs: MapSchema<string>` and `ghostItemRefs: MapSchema<string>` to `WorldSpectatorState` in `server/colyseus/src/room-schema.ts` per IC-012; initialize both in constructor
- [x] T018 [US6] Add `setTileItems(h3Index: string, itemRefs: string[]): void` and `setGhostInventory(ghostId: string, itemRefs: string[]): void` to `ColyseusWorldBridge` interface and `MatrixRoomBridge` implementation in `server/world-api/src/colyseus-bridge.ts`; empty array → delete key from MapSchema
- [x] T019 [US6] Create `server/world-api/src/ItemService.ts`: Effect `Context.Tag`; constructor accepts `LoadedMap`; seeds `tileItems: Map<string, string[]>` and `ghostInventory: Map<string, string[]>` from `initialItemRefs`; exposes `getItemsOnTile(h3Index)`, `getGhostInventory(ghostId)`, `inspectItem(h3Index, itemRef)`, `takeItem(ghostId, h3Index, itemRef)`, `dropItem(ghostId, h3Index, itemRef, capacity)`
- [x] T020 [US6] Add new `WorldApiItemError` tagged error classes to `server/world-api/src/world-api-errors.ts`: `WorldApiItemNotHere`, `WorldApiItemNotFound`, `WorldApiItemNotCarriable`, `WorldApiItemNotCarrying`, `WorldApiTileFull`; add all to `WorldApiError` union
- [x] T021 [US6] Cover all new `WorldApiItemError` variants in `server/src/errors.ts:errorToResponse()` using `Match.exhaustive`
- [x] T022 [US6] Add `computeTileItemCost(h3Index: string, itemService: ItemServiceOps): number` helper to `server/world-api/src/movement.ts`; call it inside `evaluateGo()` when checking tile capacity so item costs reduce available capacity
- [x] T023 [US6] Wire `ItemService` Layer in `server/src/index.ts`: construct with `LoadedMap`; add to `ManagedRuntime`; add to `ToolServices` union in `server/world-api/src/mcp-server.ts`
- [x] T024 [US6] After seeding `ItemService`, call `bridge.setTileItems()` for every cell with non-empty `initialItemRefs` so Colyseus has initial state on startup
- [x] T025 [US6] Add unit tests for `ItemService` in `server/world-api/src/ItemService.test.ts`: seed from LoadedMap; `takeItem` moves ref from tile to ghost; `dropItem` moves ref from ghost to tile; `dropItem` respects capacity; double-take returns error; take non-carriable returns error

**Checkpoint**: `pnpm typecheck` passes (Effect R channel satisfied); `pnpm dev` starts; `go` to full tile is blocked; Smoke Test 4 in `quickstart.md` passes ✓

---

## Phase 4: User Story 2 — `inspect` Tool (Slice C / US2)

**Goal**: Ghost on same tile as an item can inspect it and receive its description. Attempting inspect from adjacent tile returns `NOT_HERE`.

**Independent Test**: Smoke Test 3 from `quickstart.md` — inspect succeeds on current tile; `NOT_HERE` returned from adjacent tile.

- [ ] T026 [US2] Add `inspectEffect()` function to `server/world-api/src/mcp-server.ts`: calls `ItemService.inspectObject()`; returns `InspectResult`; maps `WorldApiItemNotHere` → `NOT_HERE`, `WorldApiItemNotFound` → `NOT_FOUND`
- [ ] T027 [US2] Register `inspect` tool in `buildGhostMcpServer()` in `server/world-api/src/mcp-server.ts` with `inputSchema: { itemRef: z.string() }` and description per IC-011
- [ ] T028 [US2] Implement `inspectObject()` in `ItemService`: verify itemRef exists in sidecar (else `NOT_FOUND`); verify itemRef present in `tileObjects[h3Index]` (else `NOT_HERE`); return name + optional description

**Checkpoint**: Smoke Test 3 in `quickstart.md` passes

---

## Phase 5: User Story 3 — `take`, `drop`, `inventory` Tools (Slice C / US3 + US4)

**Goal**: Ghost can pick up a carriable object, carry it, and drop it on another tile. Inventory reflects state at each step.

**Independent Test**: Smoke Test 2 from `quickstart.md` — full `look → take → inventory → move → drop → look` round-trip.

- [ ] T029 [US3] Implement `takeObject()` in `ItemService`: verify itemRef in sidecar (`NOT_FOUND`); verify on tile (`NOT_HERE`); verify carriable (`NOT_CARRIABLE`); verify ruleset permits (stub — pass when no `PICK_UP` rule loaded, `RULESET_DENY` otherwise); move first matching ref from `tileObjects` to `ghostInventory`; call `bridge.setTileObjects()` and `bridge.setGhostInventory()`
- [ ] T030 [US3] Implement `dropObject()` in `ItemService`: verify ghost carrying ref (`NOT_CARRYING`); verify ruleset permits (stub — `RULESET_DENY` when `PUT_DOWN` rule loaded and denies); verify tile capacity not exceeded (`TILE_FULL`); move ref from `ghostInventory` to `tileObjects`; call `bridge.setTileObjects()` and `bridge.setGhostInventory()`
- [ ] T031 [US3] Add `takeEffect()` to `server/world-api/src/mcp-server.ts`: calls `ItemService.takeObject(ghostId, h3Index, itemRef)`; returns `TakeResult`
- [ ] T032 [US3] Register `take` tool in `buildGhostMcpServer()` with `inputSchema: { itemRef: z.string() }` and description per IC-011
- [ ] T033 [US3] Add `dropEffect()` to `server/world-api/src/mcp-server.ts`: calls `ItemService.dropObject(ghostId, h3Index, itemRef)`; returns `DropResult`
- [ ] T034 [US3] Register `drop` tool in `buildGhostMcpServer()` with `inputSchema: { itemRef: z.string() }` and description per IC-011
- [ ] T035 [US4] Add `inventoryEffect()` to `server/world-api/src/mcp-server.ts`: calls `ItemService.getGhostInventory(ghostId)`; enriches each itemRef with `name` from sidecar; returns `InventoryResult` — never fails
- [ ] T036 [US4] Register `inventory` tool in `buildGhostMcpServer()` (no inputSchema) with description per IC-011

**Checkpoint**: Smoke Test 2 in `quickstart.md` passes (take → inventory → drop → look round-trip)

---

## Phase 6: User Story 1 — Extended `look` Response (Slice D / US1)

**Goal**: `look` returns visible objects with compass `at` values. Ghost agents can discover objects by direction without any additional queries.

**Independent Test**: Smoke Test 1 from `quickstart.md` — `look` response includes objects array with correct `at` values.

- [ ] T037 [US1] Extend `lookEffect()` in `server/world-api/src/mcp-server.ts` for `look { at: "here" }`: call `ItemService.getObjectsOnTile(hereId)` for the current tile and each adjacent tile; build `TileItemSummary[]` with `at: "here"` for current tile objects, `at: <compass>` for adjacent; set `objects` field on `TileInspectResult` only when array is non-empty (omit field entirely when empty for backward compat)
- [ ] T038 [US1] Extend `lookEffect()` for `look { at: "around" }`: each `TileInspectResult` in the `neighbors` array gains its own `objects` array containing only that tile's objects (all with `at: "here"` relative to that tile — agents already know the compass direction from the response structure)
- [ ] T039 [US1] Extend `lookEffect()` for `look { at: <compass> }`: single-tile result gains `objects` array for that tile's objects (all `at: "here"`)
- [x] T040 [US1] Create `maps/sandbox/freeplay.items.json` with `sign-welcome` (Sign), `key-brass` (Key), `statue` (Obstacle, cost 1), `badge-sponsor` (Badge) — file exists at `maps/sandbox/freeplay.items.json`
- [ ] T041 [US1] Add `items: "sign-welcome"` property to a tile class in `maps/sandbox/color-set.tsx`; add `items: "key-brass"` to another; add `items: "statue"` to a `capacity: 1` tile class

**Checkpoint**: Smoke Test 1 in `quickstart.md` passes; items visible in `look` response

---

## Phase 7: User Story 5 — Capacity Blocking (US5)

**Goal**: Objects with `capacityCost > 0` correctly reduce available tile capacity for both `go` and `drop`.

**Independent Test**: Smoke Test 4 from `quickstart.md` — ghost blocked from entering a full tile; `drop` fails on full tile.

*Note: Capacity accounting in `movement.ts` and `dropObject()` is implemented in T022 (Phase 3) and T030 (Phase 5). This phase verifies it end-to-end and adds the sandbox demonstration.*

- [ ] T042 [US5] Verify `evaluateGo()` in `server/world-api/src/movement.ts` correctly sums `capacityCost` from `computeTileItemCost()` when deciding whether a ghost can enter; add or update unit test for ghost-blocked-by-object-on-tile scenario in `server/world-api/src/movement_go_rules.test.ts`
- [ ] T043 [US5] Confirm Smoke Test 4 (`quickstart.md`) passes: one ghost + statue on `capacity: 1` tile blocks second ghost; `drop` of a cost-1 object on full tile returns `TILE_FULL`

**Checkpoint**: Capacity enforcement correct for both `go` and `drop`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, RFC sync, typecheck gate, final verification.

- [ ] T044 [P] Update `proposals/rfc/0006-world-objects.md` status from `draft` to `under review`; add note in Open Questions that Neo4j persistence is deferred to a follow-on RFC; note `AIE_MATRIX_ITEMS` env var added
- [ ] T045 [P] Update `docs/architecture.md`: add object state (in-memory `ItemService`, `tileObjects`/`ghostInventory` maps) to the world model section; note `AIE_MATRIX_ITEMS` in the env var table
- [ ] T046 [P] Update `server/world-api/README.md`: add `inspect`, `take`, `drop`, `inventory` to the MCP tool inventory; note `AIE_MATRIX_ITEMS` env var
- [ ] T047 [P] Update `maps/sandbox/README.md` (or create if absent): document `*.items.json` sidecar format, `objects` tileset property convention, `item-placement` layer convention, and `AIE_MATRIX_ITEMS` env var
- [ ] T048 [P] Update `shared/types/` package README: document new exports (`ItemDefinition`, `ItemSidecar`, `TileItemSummary`, `InspectResult`, `TakeResult`, `DropResult`, `InventoryResult`)
- [ ] T049 Run `pnpm typecheck` across all packages — confirm zero errors (compile gate: Effect R channel satisfied, `Match.exhaustive` covers all new error tags)
- [ ] T050 Run all four smoke tests from `quickstart.md` against a live dev server; confirm each passes
- [ ] T051 Verify `proposals/rfc/0006-world-objects.md` remains in sync with the implemented behavior; note any divergences for discussion (do not resolve without approval)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately; T002/T003/T004 can run in parallel
- **Phase 2 (Map Loader)**: Depends on Phase 1 (needs `ItemDefinition` type from T001) — **blocks all phases**
- **Phase 3 (ItemService)**: Depends on Phase 2 — blocks Phases 4–7
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
- Service (`ItemService`) before tool handlers
- Tool handlers before smoke test verification

### Parallel Opportunities

Within Phase 1: T002, T003, T004 (all in `ghostMcp.ts` — coordinate on same file, or split into sequential)  
Within Phase 5: T029+T031+T032 (take) and T035+T036 (inventory) can proceed in parallel with T030+T033+T034 (drop) if two contributors  
Within Phase 8: T044, T045, T046, T047, T048 all touch different files — fully parallel

---

## Parallel Example: Phase 3 (ItemService)

```
# These can proceed in parallel once Phase 2 is complete:
Task T017: room-schema.ts (Colyseus schema)
Task T018: colyseus-bridge.ts (bridge methods)
Task T019: ItemService.ts (new file)
Task T020: world-api-errors.ts (error types)

# Then sequentially:
Task T021: errors.ts (Match.exhaustive — needs T020)
Task T022: movement.ts (capacity helper — needs T019)
Task T023: index.ts wiring (needs T019, T020, T021)
Task T024: initial broadcast (needs T023)
Task T025: ItemService.test.ts (needs T019)
```

---

## Implementation Strategy

### MVP First (US1 Discovery — most visible value)

1. Complete Phase 1 (Setup types)
2. Complete Phase 2 (Map loader — loads objects)
3. Complete Phase 3 (ItemService — items in world state)
4. Complete Phase 6 (extended `look` — agents see items)
5. **STOP and VALIDATE**: `look` returns objects; Smoke Test 1 passes
6. Demo: ghost walking the map sees signs and keys in `look` output

### Incremental Delivery

1. Setup + Map Loader → objects loaded at startup
2. ItemService + `look` → items visible to agents (US1 MVP)
3. `inspect` → objects readable (US2)
4. `take` / `drop` / `inventory` → objects carriable (US3 + US4)
5. Capacity enforcement verification (US5)
6. Polish + RFC sync

### Parallel Team Strategy

Once Phase 3 (ItemService) is complete:
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
- Smoke tests in `quickstart.md` reference `freeplay.items.json`; T040/T041 must be done before running them
