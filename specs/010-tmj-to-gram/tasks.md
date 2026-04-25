# Tasks: Map Format Pipeline

**Input**: Design documents from `/specs/010-tmj-to-gram/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 0: Proposal Sync (Prerequisite — do before any code)

**Purpose**: Resolved RFC-0009 open questions are captured in `research.md` but must be written back to the RFC before implementation begins (constitution Principle I: Proposal-First Delivery).

*Answers already decided in `research.md`*: OQ-1 (committed artifact + CI equality), OQ-2 (`text/plain; charset=utf-8`), OQ-9 (`h3.polygonToCells` geographic projection). This task is a write-back, not a new decision.

- [ ] T000 Update `proposals/rfc/0009-map-format-pipeline.md` to mark OQ-1, OQ-2, and OQ-9 as resolved with the decisions from `research.md`; this closes the Proposal-First gate before Phase 1 begins

**Checkpoint**: RFC-0009 open questions OQ-1, OQ-2, OQ-9 are marked resolved. Implementation may begin.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the `@aie-matrix/tmj-to-gram` package and wire it into the workspace.

- [ ] T001 Create `tools/tmj-to-gram/` directory and `package.json` for `@aie-matrix/tmj-to-gram` (ESM, `"type": "module"`, Node 24, vitest)
- [ ] T002 Create `tools/tmj-to-gram/tsconfig.json` extending the workspace base config
- [ ] T003 Add `tools/tmj-to-gram` to `pnpm-workspace.yaml` packages list
- [ ] T004 Add `pnpm tmj-to-gram` workspace script to root `package.json` pointing at the CLI entry
- [ ] T005 [P] Add `ulid`, `pixelmatch`, `pngjs` as dependencies in `tools/tmj-to-gram/package.json`
- [ ] T006 [P] Create stub `tools/tmj-to-gram/src/cli.ts` with `@effect/cli` entry and `convert` subcommand skeleton (exits 0, no-op body)
- [ ] T007 Run `pnpm install` and verify `pnpm tmj-to-gram --help` resolves without error

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core converter modules that every user story and test layer depends on. Must be complete before any story-specific work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T008 Implement `tools/tmj-to-gram/src/converter/parse-tmj.ts` — read `.tmj` JSON, typed `TmjDocument` interface (layers, tilesets, properties, grid fields per data-model.md)
- [ ] T009 Implement `tools/tmj-to-gram/src/converter/parse-tsx.ts` — read `.tsx` via `fast-xml-parser`, return `TileTypeRegistry` + `GidMap` (tile id → type label)
- [ ] T010 Implement `tools/tmj-to-gram/src/converter/map-context.ts` — extract `MapContext` from `TmjDocument`; validate `h3_anchor` present and `h3_resolution === 15`; return typed errors for missing/wrong values
- [ ] T011 Implement `tools/tmj-to-gram/src/converter/serialize-gram.ts` — deterministic gram text emission in canonical section order per IC-001 §1–§6: header → TileType defs → ItemType defs → Polygon nodes → cell nodes → item instances; each section sorted per IC-001 §Determinism
- [ ] T012 Create `server/world-api/src/map/map-errors.ts` — five typed errors: `MapNotFoundError`, `UnsupportedFormatError`, `GramParseError`, `MapNameMismatchError`, `MapIdCollisionError` (Data.TaggedError per docs/guides/effect-ts.md)
- [ ] T013 Add `MapNotFoundError` and `UnsupportedFormatError` to `HttpMappingError` union and add `Match.tag` branches in `server/src/errors.ts:errorToResponse()` (404 and 400 respectively)

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Map Author Converts TMJ to Gram (Priority: P1) 🎯 MVP

**Goal**: `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` produces a valid `freeplay.map.gram`.

**Independent test**: Run the CLI on `maps/sandbox/freeplay.tmj`. Assert `.map.gram` exists next to source, every `location` is a valid H3 res-15 cell, gram parses cleanly with `@relateby/pattern`.

### Implementation for User Story 1

- [ ] T014 [US1] Implement `tools/tmj-to-gram/src/converter/cell-emission.ts` — scan `layout` tilelayer, resolve GID → type label, compute H3 index per cell via `h3.localIjToCell(anchor, {i: col, j: row})`, return sorted `CellEmission[]` (no compression yet — tile-area is US5)
- [ ] T015 [US1] Implement `tools/tmj-to-gram/src/converter/item-emission.ts` — scan `item-placement` tilelayer(s), load `*.items.json` sidecar (optional), emit `ItemTypeEntry[]` and `ItemInstanceEmission[]`; missing sidecar is not an error
- [ ] T016 [US1] Wire `cli.ts` `convert` subcommand: parse positional `<tmj-path>` and optional `--out` flag; invoke parse-tmj → map-context (exit 1 on error) → parse-tsx → cell-emission → item-emission → serialize-gram → write output; log portal objects as `[warn]` and continue; exit codes per IC-003
- [ ] T017 [US1] Layer 1 structural invariant tests in `tools/tmj-to-gram/test/unit/freeplay.test.ts`: every `location` passes `h3.isValidCell` at res 15; every tile node references a defined `TileType`; every item instance references a defined `ItemType`; item definitions match sidecar entries
- [ ] T018 [US1] Layer 1 negative CLI tests in `tools/tmj-to-gram/test/unit/cli-errors.test.ts`: missing `h3_anchor` → exit 1 with `[error]` message; `h3_resolution` ≠ 15 → exit 1; `--out` to non-existent directory → exit 3; `--out` to non-writable path → exit 3
- [ ] T019 [US1] Commit `maps/sandbox/freeplay.map.gram` (run CLI, inspect output, commit the golden artifact)

**Checkpoint**: `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` works end-to-end. US1 acceptance scenarios pass.

---

## Phase 4: User Story 4 — CI Validates Committed Gram Artifacts (Priority: P4)

**Goal**: CI byte-equality check detects any conversion change that alters output.

**Independent test**: Modify converter to emit cells in different order, re-run, observe non-empty diff and non-zero exit from CI step.

*Note*: This phase is placed before US2/US3 because the golden artifact from US1 is required, and the CI check provides a safety net for all subsequent phases.

### Implementation for User Story 4

- [ ] T020 [US4] Add determinism test in `tools/tmj-to-gram/test/unit/determinism.test.ts` — convert `freeplay.tmj` twice in the same process, assert byte-identical output
- [ ] T021 [P] [US4] Write CI byte-equality script `tools/tmj-to-gram/scripts/ci-golden-check.sh` — loops over `maps/sandbox/*.tmj`, converts each to `/tmp/`, diffs against committed `.map.gram`, exits non-zero on any diff
- [ ] T022 [P] [US4] Add `"ci:golden"` script to `tools/tmj-to-gram/package.json` that invokes the CI check script
- [ ] T023 [US4] Generate and commit `maps/sandbox/redbluegreen.map.gram` and `maps/sandbox/read-and-collect.map.gram` so all sandbox `.tmj` files have golden counterparts

**Checkpoint**: `pnpm --filter @aie-matrix/tmj-to-gram ci:golden` exits 0 against all committed grams.

---

## Phase 5: User Story 2 — RFC-0008 Intermedium Fetches Gram Format (Priority: P2)

**Goal**: `GET /maps/freeplay?format=gram` returns 200, `text/plain; charset=utf-8`, valid gram body.

**Independent test**: With server running, `curl http://localhost:<port>/maps/freeplay?format=gram` returns 200 and the body parses as a valid gram document.

### Implementation for User Story 2

- [ ] T024 [US2] Implement `server/world-api/src/map/MapService.ts` — `Context.Tag("aie-matrix/MapService")` + `MapServiceOps` interface; `Layer.scoped` that globs `maps/**/*.{tmj,map.gram}`, pairs by filename stem, builds `Map<mapId, MapIndexEntry>`, detects `mapId` collisions (`MapIdCollisionError`), calls `validate()` (parses each gram with `@relateby/pattern`, checks `name` metadata matches stem — `GramParseError`, `MapNameMismatchError`)
- [ ] T025 [US2] Implement `MapService.raw(mapId, format)` in `MapService.ts` — returns file byte stream for `"gram"` or `"tmj"`; throws `MapNotFoundError` / `UnsupportedFormatError`
- [ ] T026 [US2] Implement `server/world-api/src/map/MapRoutes.ts` — `GET /maps/:mapId` handler; parse `:mapId` path param and `?format` query param (default `"gram"`); call `MapService.raw`; set `Content-Type` per IC-002; share request tracing + structured logging per `docs/guides/effect-ts.md`
- [ ] T027 [US2] Wire `MapService` Layer and `MapRoutes` into `server/world-api/src/index.ts` alongside existing routes (`/mcp`, `/registry`)
- [ ] T028 [US2] HTTP contract tests in `server/world-api/test/map-routes.test.ts`: `GET /maps/freeplay` → 200 + `text/plain; charset=utf-8`; `GET /maps/freeplay?format=gram` → same; `GET /maps/nonexistent` → 404 JSON; `GET /maps/freeplay?format=unknown` → 400 JSON

**Checkpoint**: `GET /maps/freeplay?format=gram` returns valid gram. US2 acceptance scenarios pass.

---

## Phase 6: User Story 3 — Phaser Debugger Fetches TMJ Format (Priority: P3)

**Goal**: `GET /maps/freeplay?format=tmj` returns 200, `application/json`, original TMJ body.

**Independent test**: `curl http://localhost:<port>/maps/freeplay?format=tmj` returns 200, `Content-Type: application/json`, body matches source `.tmj` file.

### Implementation for User Story 3

- [ ] T029 [US3] Extend `map-routes.test.ts` with TMJ contract tests: `GET /maps/freeplay?format=tmj` → 200 + `application/json` + body parses as valid TMJ JSON matching source file
- [ ] T030 [US3] Verify `MapService.raw(mapId, "tmj")` streams the `.tmj` file correctly (coverage in existing MapService tests or separate test in `server/world-api/test/MapService.test.ts`)

*Note*: Most of the TMJ-serving implementation is already covered by `MapService.raw` from Phase 5. This phase verifies the TMJ path and validates no regression against the Phaser debugger use-case.

**Checkpoint**: `GET /maps/freeplay?format=tmj` returns valid TMJ. US3 acceptance scenarios pass.

---

## Phase 7: User Story 6 — Startup Validation Catches Malformed Gram (Priority: P6)

**Goal**: Malformed or name-mismatched `.map.gram` causes typed startup error before port is bound.

**Independent test**: Place malformed gram in `maps/sandbox/`, start server, observe `GramParseError` + non-zero exit. No HTTP requests served.

### Implementation for User Story 6

- [ ] T031 [P] [US6] Startup validation test in `server/world-api/test/MapService-startup.test.ts`: malformed gram syntax → `GramParseError`; name mismatch (`name` field ≠ stem) → `MapNameMismatchError`; two grams with same `name` → `MapIdCollisionError`; all valid → no error
- [ ] T032 [P] [US6] Create test fixture files in `server/world-api/test/fixtures/map/`: `bad-syntax.map.gram` (unparseable), `name-mismatch.map.gram` (valid gram, wrong `name` field), `collision-a.map.gram` + `collision-b.map.gram` (same `name` value in both)

**Checkpoint**: Server refuses to start on any gram integrity violation. US6 acceptance scenarios pass.

---

## Phase 8: User Story 5 — Tile Area Polygon Conversion (Priority: P5)

**Goal**: `tile-area` rectangle and polygon objects convert to `[<id>:Polygon:<TileTypeLabel> | v1..vN]` nodes with correct interior compression and override rules.

**Independent test**: Convert `maps/sandbox/map-with-polygons.tmj`. Assert gram contains Polygon nodes; no individual nodes for matched interior cells; override cells (different type) are present.

### Implementation for User Story 5

- [ ] T033 [US5] Implement `tools/tmj-to-gram/src/converter/tile-area.ts` — full pipeline per RFC-0009: reject ellipses (exit 2 + `[error]`); synthesize rectangle corners; per-vertex pixel→(col,row) via hex grid math; `h3.localIjToCell(anchor, {i,j})` per vertex; `h3.cellToLatLng` + `h3.polygonToCells` for interior set; pairwise overlap check (exit 2); type-mismatch warning (no exit); return `TileAreaPolygon[]`
- [ ] T034 [US5] Extend `cell-emission.ts` to accept `TileAreaPolygon[]` and apply compression/override: skip individual cell nodes whose H3 index is in an area's interior set AND whose type matches the area's type; keep cells whose type differs (override rule)
- [ ] T035 [US5] Layer 1 polygon structural invariant tests in `tools/tmj-to-gram/test/unit/polygon.test.ts`: polygon vertex cells are valid H3 res-15 indices; no individual nodes for matched interior cells; override cells are present; pairwise non-overlap invariant holds; all polygon type labels have `TileType` definitions
- [ ] T036 [US5] Layer 1 negative polygon tests in `tools/tmj-to-gram/test/unit/polygon-errors.test.ts`: ellipse object → exit 2 + error message naming object id/name; gutter vertex → exit 2 naming object id, vertex index, pixel coordinate; overlapping tile-areas → exit 2 naming both ids and overlap cell count; shared-vertex non-overlapping → exit 0 (no error)
- [ ] T037 [US5] Commit `maps/sandbox/map-with-polygons.map.gram` as a new golden artifact; update CI golden check to include it

**Checkpoint**: Polygon conversion, compression, override, and all negative cases work. US5 acceptance scenarios pass.

---

## Phase 9: User Story 1 Layer 3 — Visual Parity (Priority: P1 supplemental)

**Goal**: SVG renderer pixel-diffs confirm gram and TMJ render identically for every sandbox fixture.

**Independent test**: `pnpm --filter @aie-matrix/tmj-to-gram test:visual` exits 0 for all sandbox fixtures.

### Implementation for User Story 1 (Layer 3)

- [ ] T038 [P] [US1] Create `tools/tmj-to-gram/test/render/fallbacks.ts` — static color/glyph table for sandbox tile types: `Blue→#2196F3`, `Cyan→#00BCD4`, `Green→#4CAF50`, `Yellow→#FFEB3B`, `Red→#F44336`, `Purple→#9C27B0`; document "add a row when adding a fixture" rule
- [ ] T039 [P] [US1] Implement `tools/tmj-to-gram/test/render/svg-renderer.ts` — minimal flat-color SVG emitter from `{tileTypes, cells: [{h3, type}], items: [...]}` intermediate; fixed canvas size; item glyphs centered on hex
- [ ] T040 [P] [US1] Implement `tools/tmj-to-gram/test/render/tmj-adapter.ts` — read `.tmj` via `mapLoader`-style projection, produce render intermediate
- [ ] T041 [P] [US1] Implement `tools/tmj-to-gram/test/render/gram-adapter.ts` — parse `.map.gram` via `@relateby/pattern`, expand polygons via `h3.polygonToCells`, produce render intermediate
- [ ] T042 [US1] Implement pixel-diff harness in `tools/tmj-to-gram/test/render/parity.test.ts` — for each sandbox fixture: render TMJ + gram → rasterize both PNGs via `pngjs` → `pixelmatch` diff → fail on non-zero
- [ ] T043 [US1] Run `pnpm --filter @aie-matrix/tmj-to-gram golden:regen` to generate `tools/tmj-to-gram/test/render/golden/*.png` reference PNGs; commit goldens
- [ ] T044 [US1] Add `"test:visual"` and `"golden:regen"` scripts to `tools/tmj-to-gram/package.json`

**Checkpoint**: Layer 3 parity test passes for all sandbox fixtures. SC-005 satisfied.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, typecheck gate, and final integration verification.

- [ ] T045 [P] Write `tools/tmj-to-gram/README.md` — CLI usage (`pnpm tmj-to-gram convert`), inputs, output format, Layer 1/2/3 test commands, golden regeneration, how to add a sandbox fixture
- [ ] T046 [P] Update `server/world-api/README.md` — document `GET /maps/:mapId` endpoint, `MapService` Layer, startup validation behavior
- [ ] T047 [P] Update `maps/sandbox/README.md` — add tile-area authoring conventions (`h3_anchor`, `h3_resolution`, `tile-area` layer class, vertex-in-hex rule, non-overlap rule), sidecar format, gram regeneration command
- [ ] T048 [P] Update `docs/architecture.md` — add note on the two-read transition (Colyseus reads `.tmj`; world-api reads `.map.gram`) and flag the follow-up RFC that will unify them
- [ ] T049 Run `pnpm typecheck` across all packages; fix any `R`-channel or `Match.exhaustive` failures introduced by the new `MapService` Layer wiring
- [ ] T050 Run `pnpm run lint` and resolve any new lint errors
- [ ] T051 Run full test suite `pnpm test` and verify no regressions in existing world-api tests
- [ ] T052 Follow `quickstart.md` end-to-end: convert `freeplay.tmj`, start server, hit all four curl examples, confirm expected responses; use `curl -w "\ntime_total: %{time_total}s\n"` to manually verify SC-002 (< 50ms p99 for gram endpoint)
- [ ] T053 Confirm `proposals/rfc/0009-map-format-pipeline.md` still reflects all decisions made during implementation (no drift introduced); update any implementation notes if wording was refined during coding (the OQ-1/OQ-2/OQ-9 write-back was done in T000 before Phase 1)

**Checkpoint**: `pnpm typecheck && pnpm test && pnpm --filter @aie-matrix/tmj-to-gram ci:golden` all exit 0. Documentation consistent.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Proposal Sync (Phase 0)**: No dependencies — do first, before any code
- **Setup (Phase 1)**: Depends on Phase 0
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks all user story phases**
- **US1 (Phase 3)**: Depends on Phase 2 — first story, highest priority, unblocks the golden artifacts needed by Phase 4
- **US4 (Phase 4)**: Depends on Phase 3 (needs committed grams) — CI safety net for all subsequent phases
- **US2 (Phase 5)**: Depends on Phase 2 + Phase 3 (needs golden gram to be served) — can start after US1 completes
- **US3 (Phase 6)**: Depends on Phase 5 (TMJ serving reuses MapService.raw) — lightweight, add after US2
- **US6 (Phase 7)**: Depends on Phase 5 (MapService.validate is part of MapService.ts) — can run in parallel with US3
- **US5 (Phase 8)**: Depends on Phase 2; can begin after US1 completes (polygon conversion is an extension of cell-emission.ts)
- **Layer 3 / Phase 9**: Depends on Phase 3 + Phase 8 (needs complete gram output including polygons)
- **Polish (Phase 10)**: Depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Starts immediately after Foundational — no story dependencies
- **US4 (P4)**: Starts after US1 — needs committed golden artifacts
- **US2 (P2)**: Starts after US1 — needs `MapService` which depends on committed grams
- **US3 (P3)**: Starts after US2 — TMJ path is a thin extension of gram-serving MapService
- **US5 (P5)**: Can start after US1 — extends cell-emission.ts; independently testable
- **US6 (P6)**: Starts after US2 — `MapService.validate()` is already in MapService.ts

---

## Parallel Opportunities

### Phase 1 (Setup)
T005, T006 can run in parallel with T001–T004.

### Phase 2 (Foundational)
T008–T011 (converter modules) are independent files — run in parallel.
T012–T013 (error types + server wiring) are independent of converter modules — run in parallel with T008–T011.

### Phase 3 (US1)
T014 (cell-emission) and T015 (item-emission) are independent — run in parallel.
T017 and T018 (tests) are independent — run in parallel with each other, after T016.

### Phase 5 (US2)
T024 (MapService), T025 (MapService.raw), T026 (MapRoutes) are sequential (each builds on the previous).
T028 (tests) runs after T027.

### Phase 8 (US5)
T033 (tile-area.ts) and T034 (extend cell-emission.ts) are sequential.
T035 and T036 (Layer 1 tests) are independent — run in parallel after T034.

### Phase 9 (Layer 3)
T038–T041 are all independent files — run in parallel.
T042 (parity test) depends on all four.

### Phase 10 (Polish)
T045–T048 (docs) are fully independent — run in parallel.
T049–T052 are sequential verification steps.

---

## Parallel Example: User Story 1

```bash
# Parallel: both converter modules are independent files
Task: "Implement cell-emission.ts (T014)"
Task: "Implement item-emission.ts (T015)"

# After both complete:
Task: "Wire cli.ts convert subcommand (T016)"

# Parallel: tests are independent
Task: "Layer 1 structural invariant tests (T017)"
Task: "Negative CLI error tests (T018)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only — Phase 1 + 2 + 3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (CLI conversion + Layer 1 tests)
4. **STOP and VALIDATE**: `pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj` works; Layer 1 tests pass
5. Commit golden artifact

### Incremental Delivery

1. Phase 1 + 2 → scaffold and shared errors ready
2. Phase 3 (US1) → CLI works; Layer 1 tests green; golden artifact committed *(MVP)*
3. Phase 4 (US4) → CI byte-equality gate in place *(safety net)*
4. Phase 5 (US2) → `GET /maps/freeplay?format=gram` works; RFC-0008 can begin
5. Phase 6 (US3) → `GET /maps/freeplay?format=tmj` verified; Phaser debugger unaffected
6. Phase 7 (US6) → startup validation hardened
7. Phase 8 (US5) → polygon conversion complete; `map-with-polygons.map.gram` committed
8. Phase 9 → Layer 3 visual parity confirmed
9. Phase 10 → docs, typecheck, full regression

### Parallel Team Strategy

With two developers after Phase 2 completes:
- **Developer A**: Phase 3 (US1 CLI) → Phase 8 (US5 polygon extension)
- **Developer B**: Phase 5 (US2 MapService/MapRoutes) → Phase 6 (US3) → Phase 7 (US6)
- Both converge on Phase 9 (Layer 3) and Phase 10 (Polish)

---

## Notes

- [P] tasks = different files, no dependencies within that phase
- [Story] label maps each task to its user story for traceability
- All five typed errors must be in place (T012–T013) before any MapService work starts
- `Match.exhaustive` in `server/src/errors.ts` is a compile-time gate — T013 must be correct or `pnpm typecheck` fails
- Commit after each phase checkpoint; include `-s` (DCO sign-off) per AGENTS.md
- Portal objects are always warnings (never errors) — verified in T018 negative tests
- `pnpm tmj-to-gram --help` is the first smoke-test after Phase 1
