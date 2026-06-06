# Tasks: Session Leaderboards

**Input**: Design documents from `specs/026-session-leaderboards/`  
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Unit tests required for `LeaderboardServiceInMemory` (all interface methods + error paths). Integration tests planned in same change, may land separately if Neo4j container unavailable in CI.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and gram parsing foundation that all other phases depend on.

- [ ] T001 Add `shared/types/src/leaderboard.ts` defining `LeaderboardSpec`, `LeaderboardEntry`, and `LeaderboardResult` types per `data-model.md`
- [ ] T002 Export `LeaderboardSpec`, `LeaderboardEntry`, `LeaderboardResult` from `shared/types/src/index.ts`
- [ ] T003 Add `"world.leaderboard.updated"` to the `WorldEventKind` union in `shared/types/src/` (migrate canonical definition from `ghosts/funder-agent/src/world-event.ts` if needed)
- [ ] T004 Create `server/world-api/src/leaderboard-errors.ts` with typed `Data.TaggedError` types: `LeaderboardNotFound`, `LeaderboardPersistenceError`
- [ ] T005 Create `server/world-api/src/parse-leaderboard-gram.ts` — parse `[leaderboards:Leaderboards | ...]` gram block into `LeaderboardSpec[]`; return empty array when block is absent
- [ ] T006 [P] Add `LeaderboardSpec` to `tools/map-editor/src/types/map-gram.ts`
- [ ] T007 [P] Update `tools/map-editor/src/io/import-gram.ts` to extract the `[leaderboards:Leaderboards | ...]` block into `leaderboards: LeaderboardSpec[]` (alongside existing rules block parsing at lines 157–166)

**Checkpoint**: Shared types compile; gram parser returns `LeaderboardSpec[]` from a test `.map.gram`; map-editor types updated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `LeaderboardService` interface and in-memory implementation — required before any user story can be wired up.

- [ ] T008 Create `server/world-api/src/LeaderboardService.ts` — `Context.Tag("aie-matrix/LeaderboardService")` with `LeaderboardServiceOps` interface: `listLeaderboards()`, `getLeaderboard(id)`, `finalizeLeaderboards()`
- [ ] T009 Create `server/world-api/src/LeaderboardServiceInMemory.ts` — in-memory `Layer` implementation backed by `Map<string, LeaderboardResult>` and `Map<string, LeaderboardSpec>`; no Neo4j dependency
- [ ] T010 Write unit tests for `LeaderboardServiceInMemory` in `server/world-api/src/leaderboard.test.ts` — cover all interface methods and error paths (`LeaderboardNotFound` on unknown id, empty entries when no data, idempotent finalize, stale-cache fallback on simulated compute failure, tie-breaking: two actors with equal score where earlier contributor ranks first per FR-009)
- [ ] T011 Verify `pnpm test` passes in `server/world-api` with in-memory tests green

**Checkpoint**: `LeaderboardService` interface defined; in-memory implementation passes all unit tests.

---

## Phase 3: User Story 1 — Spectator Views Live Rankings (Priority: P1) 🎯 MVP

**Goal**: Spectators can call `leaderboards()` and `leaderboard { id }` MCP tools and receive live ranked results computed from the world ledger.

**Independent Test**: Load a map with one declared leaderboard, trigger two ghost ledger entries with different amounts, call `leaderboard { id }` — higher-scoring ghost appears first; `isFinal: false`.

- [ ] T012 [P] [US1] Create `server/world-api/src/LeaderboardServiceLive.ts` — Neo4j-backed `Layer` implementing `LeaderboardServiceOps`; TTL cache (`LEADERBOARD_TTL_MS`, default `60000`); Cypher aggregate query per `data-model.md` including secondary sort on `lastContributingAt` for tie-breaking (FR-009) and `instanceName`→`actorId` fallback for display name (FR-010); stale-cache fallback on query failure (FR-015); emit `world.leaderboard.updated` via `WorldBridgeService` when live rankings change (live-recompute path only — finalization emission handled in T018)
- [ ] T013 [P] [US1] Write integration tests for `LeaderboardServiceLive` in `server/world-api/src/leaderboard.integration.test.ts` — skip when `NEO4J_URI` not set; cover `listLeaderboards`, `getLeaderboard` with real ledger entries, `finalizeLeaderboards()` with snapshot persistence and `isFinal: true` verification, empty-session path, stale-cache path
- [ ] T014 [US1] Add `leaderboards` MCP tool to `server/world-api/src/mcp-server.ts` — no auth required; returns `[{ id, title, description }]` for active session; returns `[]` when no session or no declarations
- [ ] T015 [US1] Add `leaderboard` MCP tool to `server/world-api/src/mcp-server.ts` — no auth required; input `{ id: string }`; returns `LeaderboardResult`; returns `LeaderboardNotFound` error for unknown id
- [ ] T016 [US1] Wire `LeaderboardService` into the live service `Layer` in `server/world-api/src/live/` (alongside `GroupService`, `EvalContractService`)
- [ ] T017 [US1] Load leaderboard specs from map gram at session start — call `parse-leaderboard-gram.ts` in the map-loading path and pass specs to `LeaderboardService`

**Checkpoint**: `leaderboards()` and `leaderboard { id }` respond correctly; live rankings reflect ledger entries; TTL cache prevents per-request recompute.

---

## Phase 4: User Story 2 — Spectator Sees Final Frozen Rankings (Priority: P2)

**Goal**: `finalize-leaderboards` command freezes all rankings permanently; Intermedium transitions to "Session Complete" state.

**Independent Test**: Call `finalize-leaderboards` as scheduler; call `leaderboard { id }` — returns `isFinal: true` with unchanged entries; repeat call returns same frozen result.

- [ ] T018 [US2] Implement `finalizeLeaderboards()` in `LeaderboardServiceLive.ts` — compute final rankings, persist `(:LeaderboardSnapshot)` Neo4j nodes linked to session via `[:SNAPSHOT_OF]`, set `isFinal: true`, emit `world.leaderboard.updated` with `isFinal: true` for each leaderboard via `WorldBridgeService` (finalization-specific emission; live-recompute emission is in T012)
- [ ] T019 [US2] Register `finalize-leaderboards` command handler in `server/world-api/src/calendar/CalendarCommandDispatcher.ts` — restricted to `scheduler` and `admin` roles (same guard as `announce`)
- [ ] T020 [US2] Add `finalize-leaderboards` MCP tool entry in `server/world-api/src/mcp-server.ts` with `requireRole(["scheduler", "admin"])` guard
- [ ] T022 [US2] Create `clients/intermedium/src/hooks/useLeaderboard.ts` — fetch `leaderboard { id }` once on mount (initial load); subscribe to `world.leaderboard.updated` A2A events; set `sessionComplete` flag when `isFinal: true`
- [ ] T023 [US2] Create `clients/intermedium/src/components/LeaderboardPanel/LeaderboardEntry.tsx` — render single rank row: rank number, display name, score
- [ ] T024 [US2] Create `clients/intermedium/src/components/LeaderboardPanel/LeaderboardPanel.tsx` — collapsible sidebar panel; ranked table using `LeaderboardEntry`; "Session Complete" badge when `sessionComplete`; tabs/carousel for multiple leaderboards
- [ ] T025 [US2] Integrate `LeaderboardPanel` into `clients/intermedium/src/App.tsx` — visible at Global and Regional camera stops

**Checkpoint**: `finalize-leaderboards` freezes rankings; Intermedium shows "Session Complete" and rankings stop updating.

---

## Phase 5: User Story 3 — Map Author Declares Leaderboards (Priority: P3)

**Goal**: Maps with `[leaderboards:Leaderboards | ...]` blocks surface exactly those leaderboards; maps without the block surface none.

**Independent Test**: Load two maps (one with block, one without); call `leaderboards()` for each — first returns declared specs, second returns `[]`.

- [ ] T026 [US3] Add leaderboard spec display to `tools/map-editor/src/panels/detail/DetailPanel.tsx` — render each `LeaderboardSpec` from parsed gram as a read-only card showing title, description, resource, aggregation, direction, actorKind, cause
- [ ] T027 [US3] Create `tools/map-editor/src/panels/detail/LeaderboardDefinitionCard.tsx` — read-only card component
- [ ] T028 [US3] Add `[leaderboards:Leaderboards | ...]` block to `maps/sandbox/canonical.map.gram` — include `top-distributors` and `eval-champions` leaderboard specs from RFC-0025 §2 as the demo map
- [ ] T029 [US3] Update ghost system prompt in `maps/sandbox/canonical.map.gram` — reference the competitive objective so ghosts optimize behavior the leaderboard captures (per RFC-0025 §5)
- [ ] T030 [US3] Verify `leaderboards()` returns `[]` for a map without a `[leaderboards:Leaderboards | ...]` block (covered by existing `parse-leaderboard-gram.ts` empty-block behavior from T005)

**Checkpoint**: Map editor shows leaderboard definition cards; `maps/sandbox/canonical.map.gram` loads and surfaces the declared leaderboards; maps without the block return `[]`.

---

## Phase 6: User Story 4 — Admin Finalizes Leaderboards (Priority: P4)

**Goal**: Scheduler/admin role can call `finalize-leaderboards` explicitly; calendar `game-end` event auto-finalizes; non-privileged callers are rejected.

**Independent Test**: Call `finalize-leaderboards` as scheduler — succeeds. Call as ghost role — rejected. Fire `game-end` calendar event — leaderboards auto-finalize.

- [ ] T031 [US4] Add `game-end` calendar event with `enterCommands: ["finalize-leaderboards"]` to `maps/sandbox/canonical.map.gram` — follows RFC-0025 §6 pattern
- [ ] T032 [US4] Verify `requireRole(["scheduler", "admin"])` guard on `finalize-leaderboards` rejects ghost tokens — add a test case to `leaderboard.test.ts` asserting `AuthorizationError` for non-privileged callers
- [ ] T033 [US4] Verify calendar dispatch of `finalize-leaderboards` end-to-end — add a test in `CalendarCommandDispatcher` tests (or integration test) that fires the command as scheduler role and asserts `isFinal: true` on subsequent `getLeaderboard` calls

**Checkpoint**: Authorization guard verified; calendar-triggered finalization verified end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T034 [P] Update `docs/architecture.md` — add `LeaderboardService` to server/world-api component inventory; note `world.leaderboard.updated` A2A event
- [ ] T035 [P] Update `proposals/rfc/0025-session-leaderboards.md` status from "under review" to "accepted"
- [ ] T036 [P] Update `shared/types/src/` package README (if present) to mention leaderboard types
- [ ] T037 Run the end-to-end demo scenario from `specs/026-session-leaderboards/quickstart.md` — all 5 steps pass
- [ ] T038 Run `pnpm run build` from repo root — passes cleanly (hard gate per constitution)
- [ ] T039 Run `pnpm test` in `server/world-api` — all unit tests pass
- [ ] T040 Run `pnpm typecheck` across all packages — no errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T006 and T007 (map-editor) are parallel to T001–T005.
- **Phase 2 (Foundational)**: Depends on T001–T004 (types and errors from Phase 1). BLOCKS all user story phases.
- **Phase 3 (US1)**: Depends on Phase 2 complete. No dependency on US2/US3/US4.
- **Phase 4 (US2)**: Depends on Phase 2 complete. T018–T020 (server finalization) depend on Phase 3's `LeaderboardServiceLive` (T012). T022–T025 (Intermedium) can start after T001–T003.
- **Phase 5 (US3)**: Depends on T005–T007 (gram parsing). Independent of US1/US2 server work.
- **Phase 6 (US4)**: Depends on T019–T020 (command registration from Phase 4).
- **Phase 7 (Polish)**: Depends on all desired user stories complete.

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies
- **US2 (P2)**: T018–T020 depend on `LeaderboardServiceLive` (US1 T012); T022–T025 (Intermedium) need shared types (Phase 1) only
- **US3 (P3)**: Depends on gram parser (T005–T007, Phase 1) only — independent of US1/US2
- **US4 (P4)**: Depends on command registration (T019, US2)

### Parallel Opportunities

Within Phase 1: T006 and T007 (map-editor) parallel to T001–T005 (server/shared).  
Within Phase 3: T012 and T013 are both marked [P] and can be drafted in parallel.  
Within Phase 4: T018–T020 (server) parallel to T022–T025 (Intermedium client).  
Within Phase 7: T034, T035, T036 all parallel.

---

## Parallel Example: Phase 4 (US2)

```
# Server-side finalization (T018–T020) in parallel with Intermedium UI (T022–T025):
Task A: "Implement finalizeLeaderboards() in LeaderboardServiceLive.ts"  (T018)
Task B: "Create useLeaderboard.ts hook in clients/intermedium"            (T022)
Task C: "Create LeaderboardPanel component in clients/intermedium"        (T024)
# Merge when both sides complete and wire in App.tsx (T025)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (shared types + gram parser)
2. Complete Phase 2: Foundational (service interface + in-memory + tests)
3. Complete Phase 3: US1 (live service + MCP tools)
4. **STOP and VALIDATE**: `leaderboards()` and `leaderboard { id }` work end-to-end
5. Demo with `maps/sandbox/canonical.map.gram`

### Incremental Delivery

1. Phase 1 + 2 → types and service interface ready
2. Phase 3 (US1) → live rankings via MCP tools ← **MVP**
3. Phase 4 (US2) → frozen snapshots + Intermedium panel
4. Phase 5 (US3) → map author leaderboard declarations + editor display
5. Phase 6 (US4) → admin finalization + calendar integration
6. Phase 7 → polish, docs, build gate

### Parallel Team Strategy

With two contributors:
- Contributor A: Phase 1–3 (server: types, service, MCP tools)
- Contributor B: Phase 1 types only → then Phase 5 US3 (map-editor display, gram parsing)
- After Phase 3: Contributor A continues Phase 4 server work; Contributor B does Phase 4 Intermedium work

---

## Notes

- `[P]` tasks touch different files and have no blocking dependencies on incomplete tasks in the same phase.
- `[Story]` labels map tasks to spec user stories for traceability.
- Unit tests (T010) MUST pass before wiring the live Layer (T016).
- Integration tests (T013) skip automatically when `NEO4J_URI` is unset — mark CI status accordingly.
- Constitution hard gate: `pnpm run build` (T038) must pass before opening a PR.
- Run `/speckit-verify` before opening the PR.
