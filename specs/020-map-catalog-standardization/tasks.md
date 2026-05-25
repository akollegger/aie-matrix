# Tasks: Map Catalog Standardization & Moscone West Map

**Input**: Design documents from `specs/020-map-catalog-standardization/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ic-001-maps-http-api.md ✅

**Tests**: Unit test updates are included inline with each code change task. No net-new test files — existing test suites are updated to drop TMJ cases and add the gram-only regression case.

**Organization**: Tasks follow user story priority order. US1 (TMJ removal) is fully parallelizable internally. US2 (Moscone West map) has a mandatory collaborative pause before authoring begins.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase
- **[Story]**: User story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Governance artifact required before any API-breaking change lands (Constitution §I)

- [x] T001 Write `proposals/adr/0010-tmj-format-deprecation.md` — document the decision to fully drop `?format=tmj` and the TMJ server path, citing ADR-0005 and RFC-0009 as predecessors

**Checkpoint**: ADR merged / approved — constitutionally cleared to proceed with API changes

---

## Phase 2: Foundational (Contract & Discovery)

**Purpose**: Update existing contract documentation and identify all TMJ code sites before touching code

- [x] T002 Add `STATUS: Superseded by specs/020-map-catalog-standardization/contracts/ic-001-maps-http-api.md` header to `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`
- [x] T003 [P] Audit `server/colyseus/src/mapTypes.ts` — identify any TMJ-specific exported types and list them as deletion targets (do not delete yet)

**Checkpoint**: Contract history is clean; all deletion targets are known — US1 implementation can begin

---

## Phase 3: User Story 1 — Gram-Only Map Loading (Priority: P1) 🎯 MVP

**Goal**: Server builds catalog from `.map.gram` files only; `?format=tmj` returns 400; all tests pass

**Independent Test**: Start `pnpm dev`, call `GET /maps` — no `tmj` field anywhere in the response; call `GET /maps/freeplay?format=tmj` — receive `400`

### Remove TMJ from `server/world-api`

- [x] T004 [P] [US1] Remove `tmjPath?: string` from `MapIndexEntry` interface, remove `stemFromTmjFilename()` helper, and remove the `.tmj` glob scan from `scanMapPairs()` in `server/world-api/src/map/MapService.ts`
- [x] T005 [P] [US1] Change `MapServiceOps.raw()` signature from `raw(mapId, format: "gram" | "tmj")` to `raw(mapId)` (gram-only) in `server/world-api/src/map/MapService.ts`
- [x] T006 [US1] Remove `tmj` field from `mapHyperlinks()` return type, remove `normalizeFormat()`/`parseMapFormatParam()` TMJ branch, add `400` response for `?format=tmj` requests, and update `handleMapAssetGet()` to call `raw(mapId)` without a format arg in `server/world-api/src/map/MapRoutes.ts` (depends on T005)
- [x] T007 [P] [US1] Check `server/world-api/src/map/map-errors.ts` — if `UnsupportedFormatError` is only triggered by the TMJ format branch, delete it; otherwise retain it

### Remove TMJ from `server/colyseus`

- [x] T008 [P] [US1] Delete `loadTmjMap()` function (lines 234–411), all TMJ-specific types (`TmjMap`, `TmjLayer`, `TmjProperty`, `TmjTilesetRef`, lines ~10–78), and all TMJ helper functions in `server/colyseus/src/mapLoader.ts`
- [x] T009 [P] [US1] Delete any TMJ-specific exported types identified in T003 from `server/colyseus/src/mapTypes.ts`

### Update tests

- [x] T010 [P] [US1] Update `server/world-api/test/MapService.test.ts` — remove all `tmjPath` field assertions from `MapIndexEntry` test cases; verify gram-only entries are still found
- [x] T011 [P] [US1] Update `server/world-api/test/MapService-startup.test.ts` — remove any TMJ startup expectations; confirm gram-only startup succeeds
- [x] T012 [US1] Update `server/world-api/test/map-routes.test.ts` — remove `assertTmjJsonShape()` helper and all `?format=tmj` test cases; add one test asserting `GET /maps/freeplay?format=tmj` returns `400` with error body (depends on T006)
- [x] T013 [P] [US1] Update `server/colyseus/src/mapLoader.test.ts` — replace any `import { loadTmjMap as loadHexMap }` with direct `loadHexMap` import; replace `.tmj` test fixtures with the corresponding `.map.gram` files from `maps/sandbox/`

### Delete legacy map source files

- [x] T014 [P] [US1] Delete `maps/sandbox/freeplay.tmj`, `maps/sandbox/map-with-polygons.tmj`, `maps/sandbox/read-and-collect.tmj`, `maps/sandbox/redbluegreen.tmj` — all have gram counterparts
- [x] T015 [P] [US1] Delete `maps/sandbox/common.items.json`, `maps/sandbox/freeplay.items.json`, `maps/sandbox/read-and-collect.items.json` — legacy sidecar format superseded by inline gram items

### Tombstone converter tool

- [x] T016 [P] [US1] Add `"deprecated": "true"` field to `tools/tmj-to-gram/package.json` and add a deprecation notice (first paragraph) to `tools/tmj-to-gram/README.md`

### Verify US1

- [x] T017 [US1] Run `pnpm typecheck` — zero errors; run `pnpm --filter @aie-matrix/world-api test` and `pnpm --filter @aie-matrix/colyseus test` — all pass (depends on T004–T016)

**Checkpoint**: Gram-only catalog fully functional; all TMJ code paths removed; all tests green

---

## Phase 4: User Story 2 — Moscone West Ground-Floor Map (Priority: P2)

**Goal**: `maps/moscone/moscone-west.map.gram` describes a navigable AIEWF venue with Lobby, Expo Hall, named vendor booths, session rooms, Main Stage, corridors, and walls

**Independent Test**: Parse `moscone-west.map.gram` with `@aie-matrix/map-gram` — no errors; `cells.size >= 200`; ghost can path from Lobby to a vendor booth in ≤ 15 steps

### 🛑 PAUSE: Co-design the map layout

- [ ] T018 [US2] **COLLABORATIVE PAUSE** — Present the official AIEWF conference floor plan to Claude; together, agree on: (1) which areas of Moscone West to model at ground floor, (2) the names and approximate cell counts for each zone, (3) which vendor booths to name, (4) the H3 polygon vertices for each zone based on the real building coordinates. **Do not proceed to T019 until layout is agreed.**

### Author the map

- [ ] T019 [US2] Rename `maps/moscone/moscone-west-ground-floor.map.gram` → `maps/moscone/moscone-west.map.gram`; rewrite file with: header `{ kind: "matrix-map", name: "Moscone West", elevation: 0 }`, all TileType definitions from the co-designed layout (T018), polygon and tile layers, LayerStack, and Rules graph (depends on T018)
- [ ] T020 [P] [US2] Delete `maps/moscone/moscone-west.tmx` — Tiled source file; no server loader reads `.tmx` (can run in parallel with T019)

### Documentation

- [ ] T021 [US2] Create `maps/moscone/README.md` — document: H3 anchor cell and coordinates for Moscone West, area naming taxonomy used across all moscone gram files, venue floor numbering convention, and how to extend with new zones (depends on T019)

**Checkpoint**: Map parses cleanly with ≥ 200 navigable cells; ghost traversal from Lobby to any vendor booth is reachable in ≤ 15 steps

---

## Phase 5: User Story 3 — Moscone West Appears in Map Catalog (Priority: P3)

**Goal**: `GET /maps` returns an entry with `mapId: "moscone-west"` and `name: "Moscone West"`

**Independent Test**: `curl http://localhost:2567/maps | jq '.[] | select(.mapId=="moscone-west")'` — returns entry with correct name

- [ ] T022 [US3] Smoke-test the catalog after T019 lands: start `pnpm dev`, verify `GET /maps` includes `moscone-west` entry with `name: "Moscone West"` and a `gram` download link; verify `GET /maps/moscone-west` responds `200` (depends on T019, T004–T006)

**Checkpoint**: All three user stories independently verifiable

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Update `docs/architecture.md` — resolve any open question about TMJ support to "gram-only as of spec-020"; add reference to ADR-0009
- [ ] T024 [P] Update `specs/013-gram-format-migration/` — add `STATUS: TMJ bridge fully closed by spec-020` note to the spec or a top-level `CLOSED.md`
- [ ] T025 Run the full verification checklist from `specs/020-map-catalog-standardization/quickstart.md` end-to-end and confirm all steps pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: No code dependencies; can overlap with Phase 1
- **Phase 3 (US1)**: T004–T007 can start as soon as T001 (ADR) is drafted; T012 depends on T006; T017 closes the phase
- **Phase 4 (US2)**: Entirely independent of Phase 3; T018 (co-design) must precede T019; T019 must precede T021
- **Phase 5 (US3)**: Depends on T019 (map exists) and T004–T006 (catalog is gram-only)
- **Phase 6 (Polish)**: Depends on all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Depends only on ADR (T001) — no cross-story deps
- **US2 (P2)**: Fully independent of US1 — can proceed in parallel once T018 is complete
- **US3 (P3)**: Depends on US2 map file (T019) and US1 catalog changes (T004–T006)

### Parallel Opportunities

Within US1 (after T001 is drafted):
```
T004, T005, T007, T008, T009, T010, T011, T013, T014, T015, T016
  → all touch different files → can run in parallel
T006 → depends on T005
T012 → depends on T006
T017 → depends on T004–T016 (final verification gate)
```

Within US2:
```
T020 (delete .tmx) → can run in parallel with T019 (rewrite map)
T021 (README) → depends on T019
```

---

## Parallel Example: User Story 1

```bash
# All these can run simultaneously:
Task: "T004 Remove tmjPath and .tmj glob from MapService.ts"
Task: "T005 Simplify raw() signature in MapService.ts"
Task: "T008 Delete loadTmjMap() from mapLoader.ts"
Task: "T009 Delete TMJ types from mapTypes.ts"
Task: "T010 Update MapService.test.ts"
Task: "T011 Update MapService-startup.test.ts"
Task: "T013 Update mapLoader.test.ts"
Task: "T014 Delete .tmj files"
Task: "T015 Delete .items.json files"
Task: "T016 Tombstone tmj-to-gram"

# Then:
Task: "T006 Update MapRoutes.ts" (after T005)
Task: "T012 Update map-routes.test.ts" (after T006)

# Finally:
Task: "T017 Run typecheck + tests" (after all above)
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Write ADR-0009
2. Complete Phase 2: Update IC-002, audit mapTypes.ts
3. Complete Phase 3 (US1): Remove all TMJ from code + files + tests
4. **STOP and VALIDATE**: `pnpm typecheck && pnpm test` passes; `?format=tmj` returns 400
5. This is a shippable PR on its own

### Incremental Delivery

1. **PR 1**: Setup + Foundational + US1 → gram-only server, zero TMJ code
2. **PR 2**: US2 + US3 → Moscone West map in catalog (after co-design session)
3. **PR 3**: Polish → docs, architecture, spec closure

---

## Notes

- T018 is a mandatory collaborative pause — do not skip or auto-generate the Moscone West map before the co-design session with the actual AIEWF floor plan
- [P] tasks within Phase 3 can all be issued in a single parallel Agent invocation
- DCO sign-off required on all commits: `git commit -s`
- Commit after T017 passes; commit after T022 passes; final commit after T025
