# Tasks: .map.gram Format Migration

**Input**: Design documents from `specs/013-gram-format-migration/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Smoke test and unit test tasks are included per the plan's Verification table. TDD is not mandated but tests are written alongside implementation.

**Organization**: Grouped by user story — foundational shared package first, then consumer wiring (US1), cross-consumer contract verification (US2), and finally Tiled conversion (US3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1, US2, US3)
- Exact file paths in every description

---

## Phase 1: Setup (New Package Scaffold)

**Purpose**: Create the `@aie-matrix/map-gram` workspace package skeleton. Nothing else can start until the package exists and installs cleanly.

- [ ] T001 Create `shared/map-gram/` directory and `shared/map-gram/package.json` (name: `@aie-matrix/map-gram`, type: module, exports: `./dist/index.js`, files: `["dist","src"]`, dependencies: `@relateby/pattern`, `h3-js`, `effect`)
- [ ] T002 Create `shared/map-gram/tsconfig.json` extending `../../tsconfig.base.json` with `rootDir: "src"`, `outDir: "dist"`, `composite: true`
- [ ] T003 Add `shared/map-gram` entry to `pnpm-workspace.yaml` and run `pnpm install` to link the workspace package
- [ ] T004 Create `shared/map-gram/src/` with empty barrel files (`types.ts`, `expand-polygon.ts`, `parse.ts`, `index.ts`) and `shared/map-gram/test/` with a `fixtures/` subdirectory; copy `maps/sandbox/canonical.map.gram` into `fixtures/`
- [ ] T005 Create `shared/map-gram/README.md` documenting: package purpose, install note (`pnpm install` at repo root), smoke-test command (`pnpm --filter @aie-matrix/map-gram test`), ownership (aie-matrix core), and a one-paragraph description of the canonical parse sequence (polygon fill → tile override → items overlay)

---

## Phase 2: Foundational (@aie-matrix/map-gram Core)

**Purpose**: Implement the canonical gram parser. This phase is the prerequisite for **all** user stories. US2 acceptance scenarios are also directly satisfied here.

⚠️ **CRITICAL**: No consumer wiring (US1) or serializer work (US3) can start until T016 passes.

- [ ] T006 Define all exported types in `shared/map-gram/src/types.ts`: `ParsedMap`, `ParsedCell`, `ParsedPortal`, `ParsedRule`, `TileTypeDef`, `ItemTypeDef`, and `MapGramParseError` class with `cause` discriminant (`"missing-layer-stack"` | `"invalid-polygon"` | `"invalid-h3"` | `"gram-syntax"`) and optional `detail: string`
- [ ] T007 Implement `computeCellsFromVertices(vertices: string[]): string[]` in `shared/map-gram/src/expand-polygon.ts` — convert vertex H3 cells to `[lat, lng]` via `cellToLatLng`, sort by angle from centroid to prevent ring self-intersection, close the ring, call `polygonToCellsExperimental([...sorted, sorted[0]], 15, POLYGON_TO_CELLS_FLAGS.containmentOverlapping)`; return `vertices` unchanged if fewer than 3 are given
- [ ] T008 Implement `parseMapGram(gramText: string): Promise<ParsedMap>` skeleton in `shared/map-gram/src/parse.ts`: call `Gram.parse(gramText)`, extract root record (`kind: "matrix-map"`, `name`, `elevation`), extract TileType nodes (label `"TileType"`) into `ParsedMap.tileTypes`, extract ItemType nodes (label `"ItemType"`) into `ParsedMap.itemTypes`; throw `MapGramParseError("gram-syntax")` if `Gram.parse` fails
- [ ] T009 In `shared/map-gram/src/parse.ts`: find all Layer subjects with `kind: "polygon"`; for each `:Polygon:TypeName` element, read its `geometry` array of h3-tagged strings; if vertex count is outside 3–6, log a warning with the polygon's TypeName label and skip it (do not throw — parsing continues); otherwise call `computeCellsFromVertices` and populate `ParsedMap.cells` entries
- [ ] T010 In `shared/map-gram/src/parse.ts`: find all Layer subjects with `kind: "tile"`; for each `:Tile:TypeName` element, read single-element `geometry`, upsert `ParsedMap.cells` (override existing tileType from polygon fill); for each `:Portal` element, read two-element `geometry` and `mode`, push to `ParsedMap.portals`; throw `MapGramParseError("invalid-h3")` for any non-valid H3 index
- [ ] T011 In `shared/map-gram/src/parse.ts`: find all Layer subjects with `kind: "items"`; for each `:Item:TypeName` element, read `geometry` H3 index; if cell already exists append item type, if not create implicit `"open"` cell; push to `ParsedMap.cells`
- [ ] T012 In `shared/map-gram/src/parse.ts`: find the `LayerStack` subject (label `"LayerStack"`); collect its `pattern.elements` as ordered layer IDs; re-apply layers in that order (polygon → tile → items) to `ParsedMap.cells`; throw `MapGramParseError("missing-layer-stack")` if no LayerStack subject is found
- [ ] T013 In `shared/map-gram/src/parse.ts`: find the `Rules` subject (label `"Rules"`); for each `(typeId)-[:GO]->(typeId)` relationship, push `ParsedRule` to `ParsedMap.rules`
- [ ] T014 Export the full public API from `shared/map-gram/src/index.ts`: `parseMapGram`, `MapGramParseError`, and all types from `types.ts`
- [ ] T015 [P] Write `shared/map-gram/test/parse.test.ts` asserting against `fixtures/canonical.map.gram`: (a) name equals `"canonical-example"`, (b) `tileTypes` contains `"floor"` and `"pillar"`, (c) `cells` is non-empty, (d) the Pillar tile at `8f2800000000012` has `tileType: "Pillar"` (tile override beats polygon fill), (e) `portals` has one entry with `fromCell: "8f2800000000195"`, (f) `rules` has two entries
- [ ] T016 Run `pnpm --filter @aie-matrix/map-gram test` and `pnpm --filter @aie-matrix/map-gram typecheck`; fix all failures before proceeding

**Checkpoint**: `pnpm --filter @aie-matrix/map-gram test` passes — all consumer wiring can now begin.

---

## Phase 3: User Story 1 — Zero-Step Publishing (Priority: P1) 🎯 MVP

**Goal**: Colyseus loads a `.map.gram` file directly (no `.tmj`); intermedium renders the layered format.

**Independent Test**: `pnpm --filter @aie-matrix/colyseus test` passes with a test that starts a Colyseus room from `canonical.map.gram` only (no `.tmj` present); `pnpm --filter @aie-matrix/intermedium-client test` passes asserting `parseMapGramToTiles(canonical)` returns the expected tiles.

- [ ] T017 [P] [US1] Add `@aie-matrix/map-gram` as a dependency in `server/colyseus/package.json` and create `server/colyseus/src/mapLoader.gram.ts`: export `loadGramMap(mapGramText: string): Promise<LoadedMap>` — call `parseMapGram`, iterate `parsedMap.cells`, build `CellRecord` objects with `col: 0, row: 0`, `tileClass` from `parsedCell.tileType`, `capacity` from `parsedMap.tileTypes`, `initialItemRefs` from `parsedCell.items`; compute `neighbors` using existing `assignCompassToNeighbors` from `hexCompass.ts`; set `anchorH3` to `[...parsedMap.cells.keys()].sort()[0]`; add `portals: parsedMap.portals` to the returned `LoadedMap` — update `server/colyseus/src/mapTypes.ts` to add `portals?: ParsedPortal[]` (optional, preserving interface stability for existing callers)
- [ ] T018 [US1] Replace `server/colyseus/src/mapLoader.ts`: remove all `.tmj` reading logic entirely; read only `.map.gram` files — read the file text and delegate to `loadGramMap` from `mapLoader.gram.ts`; export `loadHexMap` with the same signature; if existing tests pass `.tmj` fixture paths, migrate those fixtures to `.map.gram` before this task is marked complete
- [ ] T019 [US1] Add a Colyseus integration test (or update the existing fixture test) in `server/colyseus/test/` that loads `canonical.map.gram` via `loadHexMap` and asserts: (a) `loadedMap.cells.size > 0`, (b) at least one cell has `tileClass: "Floor"`, (c) `loadedMap.portals` is a non-empty array with `fromCell: "8f2800000000195"` in the first entry (FR-004 / IC-002)
- [ ] T020 [P] [US1] Add `@aie-matrix/map-gram` as a dependency in `clients/intermedium/package.json` and rewrite `clients/intermedium/src/services/gramParser.ts`: call `parseMapGram(gramText)` from the shared package, map each `ParsedCell` to `WorldTile` (lowercase-first tileType, frozen items array, `gridDisk`-based neighbors); keep the existing `parseMapGramToTiles` function signature unchanged
- [ ] T021 [US1] Update `clients/intermedium/src/services/gramParser.test.ts` (or create it if absent) to assert `parseMapGramToTiles` called with `canonical.map.gram` returns a `Map` with at least one entry; assert the Pillar cell has `tileType: "pillar"` (lowercase)
- [ ] T022 [US1] Run `pnpm --filter @aie-matrix/colyseus test` and `pnpm --filter @aie-matrix/intermedium-client test`; fix all failures

**Checkpoint**: Both consumers load `canonical.map.gram` and their tests pass. US1 is independently deliverable.

---

## Phase 4: User Story 2 — Shared Parser Contract (Priority: P2)

**Goal**: Verify both consumers produce identical cell topology from the same input, confirming the shared contract.

**Independent Test**: A cross-consumer comparison test in `shared/map-gram/test/` runs both adaptation functions against `canonical.map.gram` and asserts identical `(h3Index, tileType, items[])` tuples.

- [ ] T023 [P] [US2] Write `shared/map-gram/test/cross-consumer.test.ts`: import `parseMapGram`, run it once against `canonical.map.gram`; apply the Colyseus adapter logic (tileClass, no tileType lowercasing) and the intermedium adapter logic (lowercase-first tileType) to the same `ParsedMap`; assert cell count is identical in both results and every h3Index present in one is present in the other
- [ ] T024 [P] [US2] Write a polygon-fill test in `shared/map-gram/test/parse.test.ts` (new `describe` block): given the `ground` polygon layer in `canonical.map.gram` with 4 vertex cells, assert that `parsedMap.cells.size` is greater than 4 (interior cells were computed, not just the 4 vertices)
- [ ] T025 [US2] Write a tile-override test: create an inline gram string with a `polygon:Floor` and a `tile:Pillar` at one of the polygon's fill cells; assert that cell's `tileType` is `"Pillar"` in `ParsedMap.cells` after parsing
- [ ] T026 [US2] Run `pnpm --filter @aie-matrix/map-gram test`; all three new assertions must pass

**Checkpoint**: US2 cross-consumer contract verified. Acceptance scenarios 1–3 from spec demonstrated by tests.

---

## Phase 5: User Story 3 — Tiled-to-gram Conversion (Priority: P3)

**Goal**: `tmj-to-gram` emits the layered format; old map files are regenerated from their `.tmj` sources.

**Independent Test**: `pnpm --filter @aie-matrix/tmj-to-gram test` passes; `pnpm gram-lint maps/sandbox/freeplay.map.gram` exits 0; `parseMapGram` loads the regenerated file without errors.

- [ ] T027 [US3] In `tools/tmj-to-gram/src/serialize-gram.ts`: replace the flat cell-node emission loop with a function that groups `TileAreaPolygon` objects into polygon Layer walks — emit `[layerId:Layer {kind: "polygon", name: "..."} | (:Polygon:TypeName { geometry: [h3\`v0\`, h3\`v1\`, ...] })]` for each tile-area polygon, using vertex H3 cells as the geometry array
- [ ] T028 [US3] In `tools/tmj-to-gram/src/serialize-gram.ts`: emit a tile Layer walk for remaining `CellEmission` objects (those not implied by a polygon) — `[layerId:Layer {kind: "tile"} | (:Tile:TypeName { geometry: [h3\`...\`] }), ...]`; omit the layer entirely if all cells are covered by polygons
- [ ] T029 [US3] In `tools/tmj-to-gram/src/serialize-gram.ts`: emit an items Layer walk for `ItemInstanceEmission` objects — `[layerId:Layer {kind: "items"} | (:Item:TypeName { geometry: [h3\`...\`] }), ...]`; omit the layer if no items are placed
- [ ] T030 [US3] In `tools/tmj-to-gram/src/serialize-gram.ts`: emit the `LayerStack` walk listing all emitted layer IDs in order (polygon layer, tile layer if present, items layer if present) — `[layers:LayerStack | layerId1, layerId2, ...]`
- [ ] T031 [US3] In `tools/tmj-to-gram/src/serialize-gram.ts`: retain Rules walk emission; update it to use TileType node identities (not labels) as rule subjects, matching the new format observed in `canonical.map.gram`; remove any remaining old flat cell-node emission code
- [ ] T032 [US3] Update `tools/tmj-to-gram/test/` to assert converted output: (a) contains a `LayerStack` subject, (b) passes `Gram.validate()`, (c) passes `parseMapGram()` without error, (d) produces non-empty `cells` equal to what the current `.tmj` Colyseus loader would produce for the same fixture
- [ ] T033 [US3] Inventory all old-format `.map.gram` files in `maps/sandbox/` (those using `cell-<h3>` flat nodes) and verify each has a `.tmj` source present; for any file whose `.tmj` source is absent, either recreate it in the map editor or explicitly remove it — do NOT leave the file in old format as a TODO; then regenerate `maps/sandbox/freeplay.map.gram` from its `.tmj` source using the updated `tmj-to-gram` tool and commit the result
- [ ] T034 [US3] Locate and regenerate all remaining old-format `.map.gram` files in `maps/sandbox/` (those using `cell-<h3>` flat nodes) by running the updated `tmj-to-gram` tool against their `.tmj` sources; if a `.tmj` source is absent, note the missing source in a TODO comment in that file for follow-up
- [ ] T035 [US3] Run `pnpm --filter @aie-matrix/tmj-to-gram test` and `pnpm gram-lint maps/sandbox/*.map.gram`; fix all failures

**Checkpoint**: All maps in `maps/sandbox/` are in the layered format and pass `gram-lint`. US3 independently verifiable.

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Tighten world-api validation, update documentation, final integration check.

- [ ] T036 Update `server/world-api/src/map/MapService.ts`: after `Gram.validate()`, walk the parsed AST to assert a `LayerStack` subject exists; if absent, return a `Data.TaggedError` (e.g., `MapFormatError`) that maps to HTTP 422 in `errorToResponse()`; add the new error variant to `server/src/errors.ts` if needed
- [ ] T037 [P] Update `specs/010-tmj-to-gram/spec.md`: note that `serialize-gram.ts` now emits the layered format (Layer walks + LayerStack + Rules); mark the flat-cell format contract as superseded
- [ ] T038 [P] Update `specs/011-intermedium-client/spec.md`: replace references to the old regex-based parser in FR-006 (or equivalent) with a reference to `@aie-matrix/map-gram`
- [ ] T039 [P] Update `proposals/rfc/0009-map-format-pipeline.md`: revise the conversion algorithm section to describe the new layered output format (Layer walks, LayerStack, Rules); reference `canonical.map.gram` as the authoritative example
- [ ] T040 [P] Update `docs/architecture.md`: remove any statement that Colyseus reads `.tmj` at runtime; note that `.map.gram` (layered format) is the sole runtime format; note `@aie-matrix/map-gram` as the shared parser package
- [ ] T041 Run `pnpm test && pnpm typecheck && pnpm run lint` from repo root; fix all failures
- [ ] T042 Follow the end-to-end smoke test in `specs/013-gram-format-migration/quickstart.md`: create a small test map in the editor, export it, run `gram-lint`, start Colyseus, confirm the room appears
- [ ] T043 [P] Add a `<!-- implements specs/013-gram-format-migration -->` reference comment to `proposals/adr/0005-h3-native-map-format.md` and `proposals/rfc/0009-map-format-pipeline.md` to close the proposal-linkage traceability loop

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 completion — blocks Phase 3, 4
- **Phase 3 (US1)**: Depends on Phase 2 (T016 passing) — T017 and T020 are parallel within Phase 3
- **Phase 4 (US2)**: Depends on Phase 3 (consumers wired) — T023, T024 are parallel within Phase 4
- **Phase 5 (US3)**: Depends on Phase 2 only (uses shared package for verification, not consumers) — can start alongside Phase 3 if capacity allows
- **Final Phase**: Depends on Phase 3, 4, and 5 completion

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2). T017 [Colyseus adapter] and T020 [intermedium parser] are parallel.
- **US2 (P2)**: Depends on US1 completion (needs both consumers wired to compare outputs).
- **US3 (P3)**: Depends on Foundational only — can run in parallel with US1 and US2 if staffed.

### Parallel Opportunities

```bash
# Phase 1 — after T001:
T002  # tsconfig
T004  # src/ skeleton + fixtures

# Phase 2 — parallel implementation:
T007  # expand-polygon.ts
T015  # parse.test.ts (write tests before full implementation)

# Phase 3 — after T016:
T017  # Colyseus adapter
T020  # intermedium adapter

# Phase 4 — after T022:
T023  # cross-consumer test
T024  # polygon-fill test

# Phase 5 — after T016:
T027  # tmj-to-gram polygon Layer
T032  # update tmj-to-gram tests

# Final — after T041:
T037  # specs/010 doc update
T038  # specs/011 doc update
T039  # RFC-0009 update
T040  # architecture.md update
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational ← **critical gate**
3. Complete Phase 3: US1 (T017–T022)
4. **Validate**: `pnpm --filter @aie-matrix/colyseus test` + `pnpm --filter @aie-matrix/intermedium-client test` both pass
5. Demo: start dev server, open intermedium, confirm polygon-filled map renders

### Full Incremental Delivery

1. Setup + Foundational → shared package ready
2. US1 → gameplay works with editor-produced maps (MVP deliverable)
3. US2 → cross-consumer contract proven via tests
4. US3 → Tiled pipeline produces layered format, old maps regenerated
5. Polish → docs consistent, all tests green

---

## Notes

- `[P]` tasks touch independent files and have no dependency on concurrent tasks at the same phase
- `[USN]` label enables tracing each task to its acceptance scenarios in spec.md
- Each checkpoint is a genuine independent deliverable — stop and validate before advancing
- `shared/map-gram/test/fixtures/` should contain a copy (not symlink) of `canonical.map.gram` to keep the test package self-contained
- When running `tmj-to-gram` to regenerate maps, use the final updated tool (after T031) not an intermediate state
