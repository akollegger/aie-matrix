# Implementation Plan: World Calendar — Temporal Dimension and Scheduled Events

**Branch**: `021-world-calendar` | **Date**: 2026-05-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/021-world-calendar/spec.md`

## Summary

Add a temporal dimension to the Matrix world: a canonical Pacific-timezone clock, consistent timestamping on MCP message records and A2A event envelopes, a `timecheck` MCP tool, and a `WorldCalendarService` that loads events from a `.calendar.gram` file and executes their `enterCommands`/`exitCommands` via a narrow `CalendarCommandDispatcher` at scheduled times. Fired-event state persists in Neo4j to survive server restarts.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)
**Primary Dependencies**: `effect` v3+, `@relateby/pattern` (Gram AST), `neo4j-driver` v5, `@aie-matrix/shared-types`, `@aie-matrix/map-gram`
**Storage**: Neo4j (`:CalendarEvent` nodes with `started`/`ended` markers); `.calendar.gram` files on disk
**Testing**: Node.js built-in `node:test` with `ManagedRuntime` pattern; `vitest` where already used in the package
**Target Platform**: Node.js 24 server (`server/world-api`, `server/src`)
**Project Type**: Server-side service extension within existing pnpm workspace monorepo
**Performance Goals**: `timecheck` within normal MCP round-trip budget; scheduler tick ≤ 30s latency
**Constraints**: Stateless application service (ADR-0007) — no in-process-only state for fired events
**Scale/Scope**: Conference-scale event list (O(100) events); single active calendar at a time

## Constitution Check

- [x] **Proposal linkage**: RFC-0021 (`proposals/rfc/0021-world-calendar.md`) covers all work in this plan.
- [x] **Boundary preservation**: New code lives in `server/world-api/src/calendar/` (new subdirectory following established pattern) and `shared/types/src/time.ts`. No existing package boundaries are crossed without contract artifacts.
- [x] **Contract artifacts**: IC-CAL-001 (`timecheck` tool), IC-CAL-002 (Gram format), IC-CAL-003 (`SchedulerContext` + dispatcher) are defined under `specs/021-world-calendar/contracts/`.
- [x] **Verifiable increments**: 5 user stories with independent acceptance scenarios; demo scenario in RFC-0021 and `quickstart.md`.
- [x] **Documentation impact**: `docs/architecture.md` env var table; `proposals/rfc/0021-world-calendar.md` status update.
- [x] **Service tests**: Unit tests required for `WorldCalendarService` and `parse-calendar-gram`; integration test for Neo4j persistence (may land separately if CI Neo4j is unavailable).

## Project Structure

### Documentation (this feature)

```text
specs/021-world-calendar/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 findings
├── data-model.md        # Entity definitions and state transitions
├── quickstart.md        # Local dev verification path
├── contracts/
│   ├── IC-CAL-001-timecheck-tool.md
│   ├── IC-CAL-002-calendar-gram-format.md
│   └── IC-CAL-003-scheduler-context.md
└── tasks.md             # Phase 2 output (/speckit.tasks — not yet created)
```

### Source Code

```text
shared/types/src/
├── time.ts              # NEW: canonical clock utility (worldNow(), WORLD_TIMEZONE)
└── scheduler-context.ts # NEW: SchedulerContext tagged type, NoActorOrigin, UnknownCalendarCommand

server/world-api/src/
└── calendar/
    ├── CalendarEvent.ts             # NEW: CalendarEvent type + ScheduledEvent projection
    ├── parse-calendar-gram.ts       # NEW: Gram parser for .calendar.gram files
    ├── CalendarCommandDispatcher.ts # NEW: narrow command dispatch (claim, yield, activate, etc.)
    ├── WorldCalendarService.ts      # NEW: Effect service (upcomingEvents, tick)
    ├── WorldCalendarService.test.ts # NEW: unit tests
    ├── parse-calendar-gram.test.ts  # NEW: parser unit tests
    └── fixtures/
        └── sample.calendar.gram    # NEW: 3-event fixture (session, break, raffle)

server/src/
└── index.ts             # MODIFIED: add WorldCalendarService to ManagedRuntime

shared/types/src/
└── conversation.ts      # VERIFY: timestamp field write paths use worldNow()

server/agent-host/src/
└── types.ts             # MODIFIED: add timestamp field to WorldEvent (alongside sentAt)
```

**Structure Decision**: All new calendar logic is scoped to `server/world-api/src/calendar/`, following the existing `rules/` subdirectory pattern. The canonical clock utility lives in `shared/types` because it is consumed by both `server/world-api` (MCP messages) and `server/agent-host` (A2A envelopes).

## Implementation Phases

### Phase A — Shared foundations (no service changes)

1. **`shared/types/src/time.ts`**: Export `worldNow(): string` using `Intl.DateTimeFormat` with `timeZone: "America/Los_Angeles"`. Export the IANA name as `WORLD_TIMEZONE = "America/Los_Angeles"`.

2. **`shared/types/src/conversation.ts`**: Audit all `MessageRecord` write paths. Ensure every `append()` call supplies `timestamp: worldNow()`. No schema change — field already exists.

3. **`server/agent-host/src/types.ts`**: Add `timestamp: string` to `WorldEvent`. In `translate-world-v1.ts`, set `timestamp: worldNow()` at translation time. Retain `sentAt` (deprecated, not removed).

### Phase B — Calendar types and Gram parser

4. **`server/world-api/src/calendar/CalendarEvent.ts`**: Define `CalendarEvent` and `ScheduledEvent` types. `CalendarEvent` is the full runtime shape (with commands); `ScheduledEvent` is the `timecheck` projection (commands omitted).

5. **`server/world-api/src/calendar/parse-calendar-gram.ts`**: Parse `CalendarEvent` nodes from a flat Gram file or an inline `[:Calendar | ...]` block. Use `@relateby/pattern`'s `Gram.parse()` — same approach as `server/world-api/src/rules/gram-rules.ts`. Validate required fields; reject and return a typed `CalendarParseError` for any violation.

6. **`server/world-api/src/calendar/fixtures/sample.calendar.gram`**: Three-event fixture (opening keynote / session / 60 min, morning break / break / 30 min, vendor raffle / raffle / 0 min).

7. **`server/world-api/src/calendar/parse-calendar-gram.test.ts`**: Unit tests — valid fixture loads all 3 events; missing required field returns parse error; negative duration returns parse error; duplicate node identifier returns parse error; embedded `[:Calendar | ...]` block produces same output as standalone file.

### Phase C — Command dispatcher

8. **`server/world-api/src/calendar/CalendarCommandDispatcher.ts`**: An Effect service (or plain module, depending on whether DI is needed) that maps command strings to their handler Effects. Registered commands: `claim`, `yield`, `activate`, `deactivate`, `raffle`. Unregistered commands return `UNKNOWN_CALENDAR_COMMAND`. Movement commands return `NO_ACTOR_ORIGIN`. Accepts `SchedulerContext` as caller identity.

   Note: `activate` and `deactivate` commands depend on RFC-0006 world objects being implemented. If they are not available, the dispatcher registers them as stubs that return `COMMAND_NOT_YET_IMPLEMENTED` — a logged no-op that does not crash the scheduler.

### Phase D — WorldCalendarService and scheduler fiber

9. **`server/world-api/src/calendar/WorldCalendarService.ts`**: Effect service with:
   - `upcomingEvents(limit: number): Effect<ScheduledEvent[]>` — returns events not yet ended, sorted by `startsAt`, capped at `limit`.
   - `tick(): Effect<void>` — queries for due events, dispatches commands via `CalendarCommandDispatcher`, writes `started`/`ended` markers to Neo4j.
   - `makeWorldCalendarLayer(events: CalendarEvent[]): Layer<WorldCalendarService, never, Neo4jGraphService>`.

10. **Scheduler fiber in `server/src/index.ts`**: `Layer.scoped` fiber that calls `WorldCalendarService.tick()` on the `CALENDAR_TICK_MS` interval. Composed alongside the existing startup sequence, after Neo4j layer is available.

11. **`WorldCalendarService.test.ts`**: Unit tests with stub Neo4j — `upcomingEvents` excludes elapsed events; `tick` dispatches enter commands for due events and marks them started; `tick` does not re-dispatch already-started events; point events do not trigger exit commands; exit commands fire at `startsAt + duration`.

### Phase E — `timecheck` MCP tool and server wiring

12. **`mcp-server.ts`**: Register `timecheck` tool — calls `WorldCalendarService.upcomingEvents(3)` and the canonical clock. No input params; always returns `{ now, timezone, upcoming }`.

13. **`server/src/index.ts` calendar loading**: Read `AIE_MATRIX_CALENDAR` at startup; if set, parse with `parse-calendar-gram`; pass events to `makeWorldCalendarLayer`. If unset, pass empty array. Fail startup on parse error with clear message.

14. **`docs/architecture.md`**: Add `AIE_MATRIX_CALENDAR` and `CALENDAR_TICK_MS` to the env var table.

### Phase F — Integration test

15. **Neo4j persistence test** (may land separately if CI Neo4j unavailable): Start `WorldCalendarService` with a Neo4j-backed layer, fire a tick past an event's `startsAt`, dispose and re-create the service with the same Neo4j instance, fire a tick again — assert the event is not re-dispatched.

**Integration test coverage gap (per constitution §Service Testing Requirements):**

If the integration test is deferred because `NEO4J_URI` is not available in CI, the following `WorldCalendarService` methods lack live-service verification:

| Method | What's uncovered | Condition for coverage |
|---|---|---|
| `tick()` — `started` marker write | Neo4j `MERGE … SET n.started=true` is executed and persists across process restart | `NEO4J_URI` set in CI; integration test suite runs |
| `tick()` — `ended` marker write | Neo4j `SET n.ended=true` persists for window events | Same |
| `tick()` — idempotency on restart | Re-creating the service layer with same Neo4j instance does not re-fire already-started events | Same |

Unit tests with stub Neo4j cover all method signatures and logic branches. The integration test adds confidence that the Neo4j write format is correct and that the uniqueness constraint prevents double-firing on restart. It is safe to ship the unit-tested implementation; the integration test MUST be added before the feature is considered production-ready.

## Complexity Tracking

No constitution violations. The decision to use a `CalendarCommandDispatcher` instead of a full `CommandExecutor` refactor is an explicit scope boundary — the full refactor is a separate future RFC.

## Key Dependencies and Risks

| Risk | Mitigation |
|---|---|
| `activate`/`deactivate` commands don't exist yet (RFC-0006) | Register as stubs returning `COMMAND_NOT_YET_IMPLEMENTED`; log at warn level; scheduler continues |
| `claim` precondition fails if speaker ghost not pre-positioned (RFC-0012 open question) | Accepted MVP tradeoff; documented in RFC-0021 Open Question 2 |
| Neo4j unavailable during development | Unit tests use stub Neo4j; integration test skips when `NEO4J_URI` unset |
| `sentAt` → `timestamp` rename in IC-004 breaks agent-host consumers | `sentAt` retained alongside `timestamp`; breaking rename deferred |
