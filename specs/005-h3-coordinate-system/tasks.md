# Tasks: H3 Geospatial Coordinate System

**Input**: Design documents from `specs/005-h3-coordinate-system/`  
**Branch**: `005-h3-coordinate-system`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: TCK contract tests are updated in US1 (they verify the H3 index format across all tools).  
**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to ([US1]–[US4])

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the H3 library in every package that will use it. These tasks are independent and can run in parallel.

- [ ] T001 [P] Add `h3-js` dependency to `server/colyseus/package.json`
- [ ] T002 [P] Add `h3-js` dependency to `server/world-api/package.json`
- [ ] T003 Run `pnpm install` at repo root to install new dependencies across the workspace
- [ ] T004 Link RFC-0004 in `docs/architecture.md` under the coordinate system section (one-line reference; full update in polish phase)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core type changes and map loading changes that ALL user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: Phases 3–6 are blocked until this phase is complete.

- [ ] T005 Update `CellId` type and `CellRecord` interface in `server/colyseus/src/mapTypes.ts`: change `CellId` from template-literal to plain `string`; add `h3Index: string` field to `CellRecord`; update `neighbors` values from `CellId` to `string`; add `anchorH3: string` field to `LoadedMap` and change its `cells` map key type to `string`
- [ ] T006 [P] Add bearing-to-compass utility function `assignCompassToNeighbors(cell: string): Partial<Record<Compass, string>>` to `server/colyseus/src/hexCompass.ts`: imports `cellToLatLng` and `gridDisk` from `h3-js`; computes bearing from cell centroid to each neighbor centroid using `atan2`; quantizes to nearest 60°-sector compass label; retain existing `neighborOddq` and `oddqOffsetToAxial` functions (do not remove)
- [ ] T007 Update `server/colyseus/src/mapLoader.ts` to: (1) parse `h3_anchor` and `h3_resolution` from `tmj.properties` and throw a descriptive `MapLoadError` if `h3_anchor` is absent, not a valid H3 cell, or not at resolution 15; (2) call `localIjToCell(anchorH3, { i: col, j: row })` from `h3-js` for each cell to derive its `h3Index`; (3) use `assignCompassToNeighbors` from `hexCompass.ts` instead of `neighborOddq` to populate `cell.neighbors`; (4) key the returned `cells` map by `h3Index` and populate `anchorH3` on `LoadedMap`
- [ ] T008 Add `h3_anchor` and `h3_resolution` custom map-level properties to `maps/sandbox/freeplay.tmj`: generate an anchor H3 index from a representative lat/lng (use `h3.latLngToCell(37.7894, -122.3995, 15)` as the synthetic anchor for the sandbox map — update to venue coordinates before the conference)

**Checkpoint**: Run `pnpm dev` — server must load `freeplay.tmj` without error and log the anchor H3 index and cell count.

---

## Phase 3: User Story 1 — Ghost Navigates via H3 Coordinates (Priority: P1) 🎯 MVP

**Goal**: Every ghost navigation operation (position lookup, compass movement, `exits` listing) uses H3 res-15 index strings instead of `"col,row"` strings. Existing ghost CLI commands (`go`, `exits`, `whereami`) continue to work with no interface changes; only the position format in responses changes.

**Independent Test**: Load the server, connect a ghost via CLI, run `whereami` (should return an H3 index string), run `exits` (neighbor values should be H3 index strings), run `go { toward: "n" }` several times — no errors, positions advance to valid H3 neighbors. Run `pnpm test:tck` — all TCK scenarios pass.

### Implementation for User Story 1

- [ ] T009 [P] Rename `tileId` field to `h3Index` in `GhostRecord` interface in `server/registry/src/store.ts`; update all reads and writes of `GhostRecord.tileId` to use `h3Index` throughout `server/registry/src/`
- [ ] T010 [P] Update `server/colyseus/src/MatrixRoom.ts`: `ghostCellByGhostId` and `state.ghostTiles` values are now H3 index strings; `setGhostCell`, `getGhostCell`, and `listOccupantsOnCell` work with H3 strings (no logic change — just string format change); update `state.tileCoords` keys to h3Index (retain population from `CellRecord.col`/`row` for Phaser backward compat)
- [ ] T011 Update `server/colyseus/src/room-schema.ts` code comments to document that `ghostTiles` values are now H3 index strings and `tileCoords`/`tileClasses` keys are now H3 index strings; no schema field renames (per IC-008 Phaser compat decision)
- [ ] T012 Update `server/world-api/src/mcp-server.ts` `whereami` tool handler: return `h3Index` field (the ghost's current H3 index); retain `col` and `row` as supplemental fields read from `CellRecord`
- [ ] T013 Update `server/world-api/src/mcp-server.ts` `exits` tool handler and `look` tool handler: cell lookups must use `h3Index` as the key into the `LoadedMap.cells` map (was `"col,row"` string)
- [ ] T014 Update `server/world-api/src/movement.ts` `evaluateGo` function: `fromCell` lookup and neighbor resolution use `h3Index` string keys; success result `tileId` field becomes the neighbor's H3 index string; `GoSuccess.tileId` field rename to `h3Index` (or keep as `tileId` for backward compat — keep as `tileId` to minimize ghost agent changes)
- [ ] T015 Update ghost TCK contract tests in `ghosts/tck/` to expect H3 index string format in: (a) position values returned by `whereami`; (b) neighbor values returned by `exits`; (c) new position in `go` success response — update all scenario fixtures that contain `"col,row"` formatted strings

**Checkpoint**: `pnpm test:tck` passes. Ghost CLI `whereami` returns H3 index. Ghost CLI `go` cycles work end-to-end.

---

## Phase 4: User Story 2 — Map Author Anchors a Tiled Map (Priority: P2)

**Goal**: The map loading pipeline validates `h3_anchor` at load time with a clear error message when the property is missing or invalid. Map authors have a documented workflow for setting the anchor.

**Independent Test**: Remove `h3_anchor` from `freeplay.tmj`, start the server — it must fail with a descriptive error naming the missing property. Re-add a bad value (non-H3 string) — server must fail with a validation error. Re-add the valid anchor — server loads successfully.

### Implementation for User Story 2

- [ ] T016 Verify the `MapLoadError` thrown in `server/colyseus/src/mapLoader.ts` (added in T007) includes: (a) the map file name; (b) the specific validation that failed (missing, invalid H3 string, wrong resolution); (c) guidance on how to fix it — add a validation test for each failure mode using the existing unit test suite
- [ ] T017 Create `maps/sandbox/README.md` documenting: how to add `h3_anchor` to a `.tmj` file in Tiled, how to generate an H3 index from a lat/lng using the one-liner from `quickstart.md`, and what `h3_resolution` means

**Checkpoint**: Server rejects maps without a valid anchor with actionable error messages. `maps/sandbox/README.md` explains the anchor property.

---

## Phase 5: User Story 3 — Spectator Overlay Client (Priority: P3)

**Goal**: A browser-based client connects to Colyseus, receives ghost H3 positions, converts them to lat/lng, and renders ghost markers on a real-world map that update in real time as ghosts move.

**Independent Test**: Start the server with ghosts moving. Open the overlay client in a browser — ghost markers appear on the map at geographically plausible positions. Move a ghost via CLI — the marker updates within 2 seconds. Inspect the marker lat/lng matches `h3.cellToLatLng(ghostH3Index)`.

### Implementation for User Story 3

- [ ] T018 Scaffold `client/map-overlay/` package: create `package.json` (name: `@aie-matrix/client-map-overlay`, `"type": "module"`), `tsconfig.json` (browser target), `index.html`, `src/main.ts`, `src/overlay.ts`, `src/map.ts`; add to pnpm workspace in root `pnpm-workspace.yaml`
- [ ] T019 [P] Add `h3-js` and `colyseus.js` dependencies to `client/map-overlay/package.json`; add MapLibre GL JS (use `maplibre-gl`) as the map renderer (per research decision 7 — MapLibre is the default; can be swapped later)
- [ ] T020 Implement Colyseus connection and `ghostTiles` patch subscription in `client/map-overlay/src/main.ts`: connect to the MatrixRoom, listen for `ghostTiles` changes, call `overlay.updateGhost(ghostId, h3Index)` on each patch
- [ ] T021 Implement ghost marker rendering in `client/map-overlay/src/overlay.ts`: `updateGhost(ghostId, h3Index)` calls `cellToLatLng(h3Index)` from `h3-js` to get lat/lng; adds or moves a MapLibre marker for the ghost; handles ghost departure (removes marker when ghost disconnects)
- [ ] T022 Initialize MapLibre GL JS map in `client/map-overlay/src/map.ts`: center on the venue lat/lng derived from the map anchor; zoom level appropriate for a conference floor (~18); use a free tile source (OpenStreetMap via MapLibre's default style or a public style)
- [ ] T023 Update `specs/005-h3-coordinate-system/quickstart.md` Step 5 with the actual `pnpm --filter @aie-matrix/client-map-overlay dev` command and browser URL once the package is scaffolded

**Checkpoint**: `pnpm --filter @aie-matrix/client-map-overlay dev` starts without error. Opening the browser shows the map centered on the venue. Ghost markers appear and move in real time.

---

## Phase 6: User Story 4 — Ghost Non-Adjacent Traversal (Priority: P4)

**Goal**: The ghost MCP interface exposes named non-adjacent exits (elevators, portals) via the `exits` tool and allows traversal via a new `traverse` tool. Pentagon cells expose global portal exits.

**Independent Test**: Add a synthetic `ELEVATOR` relationship between two cells in the Neo4j test fixture. Connect a ghost, navigate to the source cell, run `exits` — the elevator exit appears. Run `traverse { via: "elevator-b" }` — ghost position changes to destination cell. Run `traverse { via: "fake" }` — returns `NO_EXIT` error, ghost stays put.

### Implementation for User Story 4

- [ ] T024 Add `evaluateTraverse(map, fromCell, via, neo4jService): TraverseSuccess | TraverseFailure` function to `server/world-api/src/movement.ts`: queries Neo4j for `PORTAL`/`ELEVATOR` relationships from `fromCell.h3Index` with `name = via`; returns success with destination H3 index or typed failure with `NO_EXIT` code
- [ ] T025 Register `traverse` MCP tool in `server/world-api/src/mcp-server.ts` per IC-007: input schema `{ via: z.string() }`; calls `traverseEffect(via, extra)` which resolves ghost position, calls `evaluateTraverse`, updates ghost cell on success
- [ ] T026 Update `exits` tool handler in `server/world-api/src/mcp-server.ts` to query Neo4j for non-adjacent relationships (`PORTAL`, `ELEVATOR`) from the current cell and append them to the exits response per IC-006; format as `[elevator] name → h3Index (tileClass)` and `[portal] name → h3Index (tileClass)`
- [ ] T027 Add pentagon portal seeding to server startup in `server/world-api/src/` (or `server/colyseus/src/` initialization): call `h3.getPentagons(15)` to get 12 H3 indices; upsert `(:Cell {h3Index})` nodes for each; create fully-connected `PORTAL` relationships between all 12 with `name: "pentagon-N"` where N is 1–12
- [ ] T028 Add TCK scenarios to `ghosts/tck/` for: (a) `exits` including a named non-adjacent exit when one exists; (b) `traverse` success; (c) `traverse` failure with `NO_EXIT` code — use synthetic test map with an `ELEVATOR` relationship

**Checkpoint**: `pnpm test:tck` includes and passes traversal scenarios. `exits` shows named exits when a non-adjacent relationship exists on the current cell.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates, verification, and cleanup across all user stories.

- [ ] T029 [P] Update `docs/architecture.md`: describe H3 res-15 as the canonical cell coordinate system, reference RFC-0004, document `CellRecord.h3Index` as the node identity property in Neo4j
- [ ] T030 [P] Update RFC-0004 status from `draft` to `accepted` in `proposals/rfc/0004-h3-geospatial-coordinate-system.md`
- [ ] T031 [P] Document the ghost MCP `traverse` tool and updated `exits` response format in the ghost MCP interface docs (wherever `go` is currently documented — check `docs/` or `server/world-api/README.md`)
- [ ] T032 Run the full `quickstart.md` smoke test sequence end-to-end: anchor a map, start server, verify `whereami` H3 format, run `go` sequence, run `pnpm test:tck`, open overlay client
- [ ] T033 Run `pnpm typecheck` across the workspace and resolve any TypeScript errors introduced by the `CellId` and `CellRecord` changes
- [ ] T034 Run `pnpm run lint` and fix any linting issues in modified files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001, T002 run in parallel; T003 after both; T004 in parallel with T003
- **Foundational (Phase 2)**: Depends on Phase 1 completion. T005–T008 can run in parallel after T003
- **User Stories (Phase 3–6)**: All depend on Phase 2 completion
  - US1 (Phase 3) has no dependencies on US2–US4 but US3 and US4 depend on US1 being complete
  - US2 (Phase 4) can be worked in parallel with US1 (different files: mapLoader error messages, map README)
  - US3 (Phase 5) depends on US1 (ghostTiles must emit H3 indices)
  - US4 (Phase 6) depends on US1 (MCP server must use h3Index cell lookup)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on other user stories.
- **US2 (P2)**: Starts after Phase 2. Independent of US1 (different files).
- **US3 (P3)**: Starts after US1 is complete (`ghostTiles` must emit H3 indices for overlay to work).
- **US4 (P4)**: Starts after US1 is complete (`exits` and cell lookup must use h3Index).

### Within Each User Story

- Phase 2 (Foundation) must complete before any phase 3+ task
- Within US1: T009–T011 [P] can run together; T012–T014 after cell lookup is updated (T013); T015 after all tools are updated
- Within US3: T018 scaffold first; T019 [P] in parallel with T018; T020–T022 after T018+T019

### Parallel Opportunities

- T001 and T002: Run in parallel (different packages)
- T005 and T006 and T008: Run in parallel (different files in Foundation phase)
- T009, T010, T011: Run in parallel (different files in US1)
- T018 and T019: Run in parallel (scaffold structure + package deps)
- T029, T030, T031: Run in parallel (different doc files in Polish phase)

---

## Parallel Example: Phase 2 (Foundation)

```
Parallel batch (after T003 install completes):
  Task T005: Update CellId/CellRecord types in server/colyseus/src/mapTypes.ts
  Task T006: Add bearing-compass utility in server/colyseus/src/hexCompass.ts
  Task T008: Add h3_anchor to maps/sandbox/freeplay.tmj

Sequential (depends on T005 + T006):
  Task T007: Update mapLoader.ts with anchor parsing + localIjToCell + bearing-compass
```

## Parallel Example: User Story 1 (Phase 3)

```
Parallel batch (after Phase 2 completes):
  Task T009: Rename tileId→h3Index in server/registry/src/store.ts
  Task T010: Update MatrixRoom.ts ghost position strings
  Task T011: Update room-schema.ts comments

Sequential (depends on T009–T011):
  Task T012: Update whereami in server/world-api/src/mcp-server.ts
  Task T013: Update exits + look in server/world-api/src/mcp-server.ts
  Task T014: Update evaluateGo in server/world-api/src/movement.ts
  Task T015: Update ghosts/tck contract test fixtures
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Foundation (T005–T008) — **blocks everything**
3. Complete Phase 3: US1 (T009–T015)
4. **STOP and VALIDATE**: `pnpm test:tck` passes; ghost CLI navigation works end-to-end with H3 indices
5. Demo: Ghost navigating H3-indexed world via CLI

### Incremental Delivery

1. Setup + Foundation → `pnpm dev` loads H3-indexed map
2. US1 → `pnpm test:tck` green; ghost navigation works (MVP)
3. US2 → Map loading rejects bad/missing anchors; authoring docs exist
4. US3 → Browser overlay shows live ghost positions on real-world map
5. US4 → `traverse` tool available; pentagon portals seeded

### Parallel Team Strategy

After Foundation (Phase 2) is complete:
- **Developer A**: US1 (T009–T015) — ghost navigation core
- **Developer B**: US2 (T016–T017) — map authoring validation and docs
- Reconvene after US1 completes
- **Developer A**: US3 (T018–T023) — overlay client
- **Developer B**: US4 (T024–T028) — traversal + pentagon portals

---

## Notes

- All `"col,row"` string literals in server code are targets — grep for the pattern `\d+,\d+` as a sanity check after US1
- The Phaser client (`client/phaser`) does NOT require code changes for US1–US4 because `tileCoords` is retained and populated from `CellRecord.col`/`row` (per IC-008); verify after T010 that the Phaser client still renders correctly
- Pentagon portal seeding (T027) should be idempotent — use Neo4j `MERGE` not `CREATE` to avoid duplicates on server restart
- The `localIjToCell` API may throw at the far corner of very large maps; add a try/catch in `mapLoader.ts` that includes the (col, row) coordinates in the error message to aid debugging
