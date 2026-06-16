# Tasks: World Calendar — Temporal Dimension and Scheduled Events

**Input**: Design documents from `specs/021-world-calendar/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Unit tests required per constitution. Integration test (Neo4j persistence) may land separately if CI Neo4j is unavailable — plan must document which methods lack coverage if deferred.

**Organization**: Tasks grouped by user story. US1 and US2 share foundational dependencies (clock, types). US3–US5 build on the WorldCalendarService from US3.

---

## Phase 1: Setup

**Purpose**: Scaffold new files; verify existing ones need no structural changes.

- [x] T001 Create `server/world-api/src/calendar/` directory with placeholder `index.ts` that re-exports the public API of the calendar module
- [x] T002 Create `server/world-api/src/calendar/fixtures/` directory and commit `sample.calendar.gram` with three events: a 60-minute session (`opening-keynote`), a 30-minute break (`morning-break`), and a 0-duration raffle (`booth-12-raffle`) — all set to `startsAt: "2099-06-05T09:00:00-07:00"` (far future) so they appear in `upcoming` without firing during tests; tests that need elapsed events construct in-memory `CalendarEvent` objects directly
- [x] T003 Confirm `shared/types/src/conversation.ts` `MessageRecord` definition includes `timestamp: string` (research finding: it already does); if missing, add it and update `shared/types/src/index.ts` export

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Canonical clock and updated type contracts that every user story depends on.

⚠️ **CRITICAL**: US1–US5 cannot begin until this phase is complete.

- [x] T004 Implement canonical clock utility in `shared/types/src/time.ts`: export `worldNow(): string` using `Intl.DateTimeFormat` with `timeZone: "America/Los_Angeles"` returning ISO 8601 with explicit UTC offset; export `WORLD_TIMEZONE = "America/Los_Angeles"`; re-export from `shared/types/src/index.ts`
- [x] T005 [P] Define `CalendarEvent` and `ScheduledEvent` types in `server/world-api/src/calendar/CalendarEvent.ts`; `CalendarEvent` includes all fields (id, title, description, kind, startsAt, duration, location?, enterCommands, exitCommands); `ScheduledEvent` is the `timecheck` projection (command fields omitted); export both
- [x] T006 [P] Add `timestamp: string` field to `WorldEvent` in `server/agent-host/src/types.ts` alongside existing `sentAt`; update `translate-world-v1.ts` to set `timestamp: worldNow()` at translation time; retain `sentAt` (deprecated, not removed)
- [x] T007 Audit all `MessageRecord` write paths in `server/conversation/` and `server/world-api/`; replace any ad-hoc `new Date().toISOString()` with `worldNow()` from `@aie-matrix/shared-types`

**Checkpoint**: `worldNow()` is available; `CalendarEvent` / `ScheduledEvent` types are defined; `WorldEvent` has `timestamp`; all `MessageRecord` writes use the canonical clock.

---

## Phase 3: User Story 1 — Ghost queries `timecheck` (Priority: P1) 🎯 MVP

**Goal**: A ghost issues `timecheck` and receives current Pacific time, timezone, and upcoming events.

**Independent Test**: Register a ghost, issue `timecheck` with a calendar fixture loaded, verify the response shape matches IC-CAL-001. Issue `timecheck` with no calendar loaded, verify `upcoming` is an empty array.

- [x] T008 [US1] Implement Gram parser in `server/world-api/src/calendar/parse-calendar-gram.ts`: parse `CalendarEvent` nodes from a flat `.calendar.gram` file using `@relateby/pattern`'s `Gram.parse()`, following the pattern in `server/world-api/src/rules/gram-rules.ts`; return `Effect<CalendarEvent[], CalendarParseError>`; validate all required fields; reject negative `duration`; reject duplicate node identifiers
- [x] T009 [US1] Add parser support for embedded `[:Calendar | ...]` block in a `.map.gram` file to `parse-calendar-gram.ts`; produce identical `CalendarEvent[]` output as the standalone file path
- [x] T010 [US1] Implement `WorldCalendarService` stub in `server/world-api/src/calendar/WorldCalendarService.ts` with only `upcomingEvents(limit: number): Effect<ScheduledEvent[]>` (no `tick()` yet); filter out events whose window has fully elapsed; sort by `startsAt`; cap at `limit`; provide `makeWorldCalendarLayer(events: CalendarEvent[]): Layer<WorldCalendarService>`
- [x] T011 [US1] Register `timecheck` tool in `server/world-api/src/mcp-server.ts` alongside existing tools; call `WorldCalendarService.upcomingEvents(3)` and `worldNow()`; return `{ now, timezone, upcoming }` per IC-CAL-001; no input parameters; available to all adopted ghosts
- [x] T012 [US1] Wire calendar loading in `server/src/index.ts`: read `AIE_MATRIX_CALENDAR` env var; if set, parse with `parse-calendar-gram`; pass events to `makeWorldCalendarLayer`; if unset, pass empty array; fail startup with descriptive error on parse failure; add `WorldCalendarService` to `ManagedRuntime`
- [x] T013 [US1] Write unit tests in `server/world-api/src/calendar/parse-calendar-gram.test.ts` using `node:test`: valid fixture loads all 3 events with correct field values; missing required field returns `CalendarParseError`; negative duration returns `CalendarParseError`; duplicate node identifier returns `CalendarParseError`; embedded `[:Calendar | ...]` block produces same output as standalone file
- [x] T014 [US1] Write unit tests in `server/world-api/src/calendar/WorldCalendarService.test.ts` using `node:test` + `ManagedRuntime`: `upcomingEvents` returns events sorted by `startsAt`; `upcomingEvents` excludes events whose window has elapsed; `upcomingEvents` caps results at the requested limit; empty event list returns empty array

**Checkpoint**: `timecheck` is functional end-to-end. Ghost can query current time and see upcoming events from the sample fixture.

---

## Phase 4: User Story 2 — Consistent timestamps on messages and events (Priority: P1)

**Goal**: Every `MessageRecord` and every A2A event envelope carries a `timestamp` field.

**Independent Test**: Issue `say` from a ghost; inspect the JSONL record for `timestamp` in Pacific ISO 8601 format. Receive an A2A event; inspect the envelope for `timestamp`.

- [x] T015 [US2] Verify (and fix if needed) that `server/conversation/src/store.ts` `append()` supplies `timestamp: worldNow()` for every `MessageRecord` written — cross-reference the audit from T007
- [x] T016 [US2] Verify (and fix if needed) that `server/world-api/src/mcp-server.ts` `say` handler supplies `timestamp: worldNow()` in the message record it constructs before calling `append()`
- [x] T017 [US2] Write unit tests covering two surfaces: (1) in `server/conversation/src/store.test.ts`, construct a `MessageRecord` and call `append()`; assert the written record's `timestamp` is present, parseable as ISO 8601, and uses a Pacific UTC offset (`-07:00` or `-08:00`), not bare `Z`; (2) in `server/agent-host/src/translate-world-v1.test.ts`, call `translateColyseusWorldV1()` and assert the resulting `WorldEvent` includes both `timestamp` (Pacific offset) and `sentAt`

**Checkpoint**: All messages and A2A events produced after this phase have `timestamp` set from the canonical clock.

---

## Phase 5: User Story 3 — Scheduler fires enter commands at event start (Priority: P2)

**Goal**: When a calendar event's `startsAt` arrives, `enterCommands` execute automatically.

**Independent Test**: Load a fixture with an event starting 10 seconds in the future. Wait one tick. Verify the command dispatched (check logs or world state).

- [x] T018 [US3] Define `SchedulerContext` type (`{ _tag: "SchedulerContext", role: "system" }`) as a `Data.TaggedError`-style tagged type in `shared/types/src/scheduler-context.ts`; re-export from `shared/types/src/index.ts`; then implement `CalendarCommandDispatcher` in `server/world-api/src/calendar/CalendarCommandDispatcher.ts`: map command strings `claim`, `yield`, `activate`, `deactivate`, `raffle` to their handler Effects; unregistered commands return `UnknownCalendarCommand` (`Data.TaggedError`); movement commands (`go`, `traverse`) return `NoActorOrigin` (`Data.TaggedError`); accept `SchedulerContext` as caller identity
- [x] T019 [US3] Implement `tick(): Effect<void>` on `WorldCalendarService` in `server/world-api/src/calendar/WorldCalendarService.ts`: query loaded events for those where `startsAt ≤ now` and not yet started; call `CalendarCommandDispatcher` for each `enterCommand`; record the event as started in Neo4j (`MERGE (:CalendarEvent {id}) SET n.started = true`); log `NoActorOrigin` and `UnknownCalendarCommand` tagged errors at warn level without crashing
- [x] T020 [US3] Add Neo4j uniqueness constraint for `CalendarEvent.id` to startup migration in `server/src/index.ts` (or wherever Neo4j constraints are applied): `CREATE CONSTRAINT calendar_event_id_unique IF NOT EXISTS FOR (e:CalendarEvent) REQUIRE e.id IS UNIQUE`
- [x] T021 [US3] Add scheduler fiber to `server/src/index.ts`: `Layer.scoped` Effect that calls `WorldCalendarService.tick()` on a `CALENDAR_TICK_MS`-millisecond interval (default 30000); add `CALENDAR_TICK_MS` env var to env config
- [x] T022 [US3] Write unit tests in `WorldCalendarService.test.ts` for `tick()`: due event dispatches its `enterCommands` via a stub dispatcher; already-started event is not re-dispatched; `NoActorOrigin` from dispatcher is logged and does not propagate as a failure; point event (`duration: 0`) dispatches `enterCommands` on first tick past `startsAt`; two events sharing the same `startsAt` both fire without error

**Checkpoint**: Scheduler fires enter commands. Observer can set a near-future `startsAt` in the fixture and see the command log on the next tick.

---

## Phase 6: User Story 4 — Scheduler fires exit commands at event end (Priority: P2)

**Goal**: When `startsAt + duration` elapses for a window event, `exitCommands` execute automatically.

**Independent Test**: Load a fixture with a window event starting now and ending in 10 seconds. Wait past the end. Verify exit commands executed in logs.

- [x] T023 [US4] Extend `tick()` in `WorldCalendarService.ts` to also query events where `(startsAt + duration) ≤ now AND started = true AND ended = false AND duration > 0`; dispatch `exitCommands`; record `ended = true` in Neo4j
- [x] T024 [US4] Write unit tests in `WorldCalendarService.test.ts` for exit dispatch: exit commands fire at correct time for window events; exit commands do not fire for point events (`duration: 0`); server restart between enter and exit fires exit correctly on next tick past `startsAt + duration` (test with stub Neo4j returning `started=true, ended=false`)

**Checkpoint**: Enter and exit are paired. Window events fully automate open/close mechanics.

---

## Phase 7: User Story 5 — Calendar authored in Gram (Priority: P3)

**Goal**: A world author writes events in `.calendar.gram` or inline `[:Calendar | ...]` and they load correctly.

**Independent Test**: Write the sample fixture, point `AIE_MATRIX_CALENDAR` at it, start server, issue `timecheck`, see all 3 events. Also test embedded block in a `.map.gram` file.

- [x] T025 [US5] Write end-to-end smoke test in `server/world-api/test/calendar-loading.test.ts` using `node:test`: start server with `AIE_MATRIX_CALENDAR` pointing at `sample.calendar.gram` (which uses far-future `startsAt` dates); issue `timecheck`; assert all 3 fixture events appear in `upcoming`; server starts cleanly without errors
- [x] T026 [US5] Write parse error smoke test: start server with a malformed `.calendar.gram` (missing required field); assert startup fails with a non-zero exit and the error message names the file

**Checkpoint**: Full authoring-to-runtime path verified end-to-end.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T027 [P] Update `docs/architecture.md`: add `AIE_MATRIX_CALENDAR` and `CALENDAR_TICK_MS` to the Selected Environment Variables table; note `WorldCalendarService` in the Effect orchestration layer section
- [x] T028 [P] Update `proposals/rfc/0021-world-calendar.md` status from `draft` to `under review`
- [x] T029 Update `server/world-api/README.md` (or equivalent package README) to document `AIE_MATRIX_CALENDAR`, `CALENDAR_TICK_MS`, and how to run the calendar unit tests
- [x] T030 Run full test suite (`pnpm test` from repo root); confirm no regressions in existing world-api, conversation, and agent-host tests
- [x] T031 Follow quickstart.md end-to-end with the sample fixture and confirm all 6 demo scenario steps pass; note any steps that remain pending (e.g. `activate`/`deactivate` stubs) in a comment in quickstart.md
- [x] T032 If Neo4j integration test (fired-event idempotency) was deferred, add a comment to `WorldCalendarService.test.ts` naming the uncovered methods and the condition under which full coverage will be added (per constitution integration test requirements)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user story phases**
- **Phase 3 (US1 — timecheck)**: Depends on Phase 2
- **Phase 4 (US2 — timestamps)**: Depends on Phase 2; can run in parallel with Phase 3
- **Phase 5 (US3 — enter commands)**: Depends on Phase 3 (needs `WorldCalendarService`) and Phase 2
- **Phase 6 (US4 — exit commands)**: Depends on Phase 5
- **Phase 7 (US5 — Gram format)**: Depends on Phase 3 (parser) — can overlap with Phase 5
- **Phase 8 (Polish)**: Depends on all story phases complete

### User Story Dependencies

- **US1** and **US2** are independent of each other after Phase 2
- **US3** depends on US1 (`WorldCalendarService` stub must exist)
- **US4** depends on US3 (extends `tick()`)
- **US5** depends on US1 (parser used in loading path)

### Parallel Opportunities

- T005 and T006 (Phase 2): different packages, run in parallel
- T008 and T009 (US1 parsing) can overlap with T015/T016 (US2 audit) once Phase 2 completes
- T013 and T014 (US1 tests) can run in parallel — different test files
- T027 and T028 (Phase 8 docs) are independent, run in parallel

---

## Parallel Example: Phase 2

```
Parallel start after Phase 1:
  T004 — shared/types/src/time.ts (worldNow)
  T005 — server/world-api/src/calendar/CalendarEvent.ts (types)
  T006 — server/agent-host/src/types.ts (WorldEvent timestamp)
Sequential after T004:
  T007 — MessageRecord write-path audit (needs worldNow available)
```

---

## Implementation Strategy

### MVP (User Stories 1 + 2 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (`timecheck` tool)
4. Complete Phase 4: US2 (timestamp consistency)
5. **Stop and validate**: `timecheck` works, messages have timestamps
6. This delivers temporal awareness to agents without the scheduler

### Full delivery

Continue with Phase 5 (enter commands) → Phase 6 (exit commands) → Phase 7 (Gram format) → Phase 8 (polish).

---

## Notes

- `activate` and `deactivate` commands depend on RFC-0006. In T018, register them as stubs returning `CommandNotYetImplemented` — a logged no-op that does not crash the scheduler.
- `sentAt` on `WorldEvent` is retained for backwards compatibility (T006). A cleanup RFC can remove it once consumers migrate to `timestamp`.
- If the Neo4j integration test (fired-event idempotency) is deferred, T032 must document the gap per the constitution's service testing requirements.
