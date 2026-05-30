# Feature Specification: World Calendar — Temporal Dimension and Scheduled Events

**Feature Branch**: `021-world-calendar`
**Created**: 2026-05-29
**Status**: Draft
**Input**: RFC-0021 — World Calendar

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0021](../../proposals/rfc/0021-world-calendar.md)
- **Scope Boundary**: Wall-clock time anchored to US/Pacific; consistent ISO 8601 timestamping on all MCP and A2A messages; a `timecheck` MCP tool; a `WorldCalendar` service that reads a `.calendar.gram` file and executes enter/exit commands at scheduled times via the existing command executor.
- **Out of Scope**: Synthetic game clocks; ghost-class-filtered event visibility; runtime calendar management API; multi-file calendar composition; event-driven (non-calendar) triggers; speaker ghost pre-positioning logic.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghost queries current time (Priority: P1)

A ghost agent needs to know what time it is so it can reason about when things happen. Agents are expected to be temporally aware — `timecheck` is a clock, not a schedule.

**Why this priority**: The `timecheck` tool is the entry point for all temporal reasoning by agents. Without it, ghosts are time-blind.

**Independent Test**: Register a ghost, issue `timecheck`, and observe a well-formed response with a current Pacific timestamp and timezone.

**Acceptance Scenarios**:

1. **Given** a ghost is adopted, **When** the ghost issues `timecheck`, **Then** the response includes `now` (ISO 8601 with Pacific UTC offset) and `timezone: "America/Los_Angeles"`.
2. **Given** any calendar state (events loaded or not), **When** the ghost issues `timecheck`, **Then** the response is `{ now, timezone }` — no upcoming array, no event data.
3. **Given** the server has just started, **When** the ghost issues `timecheck`, **Then** `now` reflects the current wall-clock time in Pacific.

---

### User Story 2 — Messages and events carry consistent timestamps (Priority: P1)

A ghost receives many messages and A2A events from different services. They need a reliable ordering key to reason about recency and sequence.

**Why this priority**: Timestamping is a cross-cutting change touching every message path. It must land alongside the calendar to avoid a window where some messages have timestamps and others don't.

**Independent Test**: Issue `say` from a ghost; inspect the persisted message record for a `timestamp` field. Receive an A2A world event; inspect the envelope for a `timestamp` field.

**Acceptance Scenarios**:

1. **Given** a ghost issues `say`, **When** the message is written to the conversation JSONL, **Then** the record includes a `timestamp` field in ISO 8601 with Pacific UTC offset.
2. **Given** the server emits an A2A world event envelope (IC-004), **When** the envelope is received by the agent host, **Then** the envelope includes a `timestamp` field in ISO 8601 with Pacific UTC offset.
3. **Given** two messages in the same thread, **When** ordered by `timestamp`, **Then** the order matches the server-side sequence of events.

---

### User Story 3 — Scheduler fires enter commands at event start (Priority: P2)

A session is authored in the calendar with `enterCommands: ["claim hall-a ghost_keynote_speaker"]`. When the session's `startsAt` time arrives, the command executes automatically — the speaker ghost holds the room claim without any ghost-side polling.

**Why this priority**: This is the primary value of the calendar for conference mechanics. Without it, speaker rooms and coffee tiles cannot be scheduled.

**Independent Test**: Load a calendar with an event starting 10 seconds in the future. Wait one scheduler tick. Verify the command executed (room is claimed, tile is active, etc.).

**Acceptance Scenarios**:

1. **Given** a calendar event with `startsAt` in the near future and `enterCommands: ["claim hall-a ghost_keynote_speaker"]`, **When** the scheduler tick fires after `startsAt`, **Then** the command is executed and the designated ghost holds the speaker claim for `hall-a`.
2. **Given** the server is restarted after the event has already fired, **When** the scheduler runs again, **Then** the `enterCommands` are not re-executed.
3. **Given** an `enterCommands` entry of `"go n"` (movement command requiring a ghost position), **When** the scheduler executes it, **Then** the command returns `NO_ACTOR_ORIGIN`, is logged, and the scheduler continues without crashing.

---

### User Story 4 — Scheduler fires exit commands at event end (Priority: P2)

A coffee-serving tile is active during a scheduled break. When the break's duration elapses, `exitCommands: ["deactivate lobby-coffee"]` runs automatically, making the tile inactive.

**Why this priority**: Window events without exit handling leave world state permanently altered. Enter and exit must be paired.

**Independent Test**: Load a calendar with a 1-minute window event. Wait past `startsAt + duration`. Verify the exit command executed and the world object returned to its pre-event state.

**Acceptance Scenarios**:

1. **Given** a window calendar event with `enterCommands` and `exitCommands`, **When** `startsAt + duration` elapses and the scheduler ticks, **Then** `exitCommands` execute and the affected world object reflects the post-event state.
2. **Given** a point event (`duration: 0`), **When** the event fires, **Then** only `enterCommands` execute; `exitCommands` are ignored even if non-empty.
3. **Given** the server restarts after enter has fired but before exit is due, **When** the scheduler resumes, **Then** exit fires correctly at `startsAt + duration` without re-firing enter.

---

### User Story 5 — Calendar authored in Gram alongside the map (Priority: P3)

A world author writes the conference schedule in a `.calendar.gram` file or inline in the `.map.gram` file using `[:Calendar | ...]`, using the same toolchain as map and rule authoring.

**Why this priority**: Format consistency reduces cognitive overhead for authors. Gram is the established format; a bespoke JSON file would be a second authoring surface.

**Independent Test**: Write a `.calendar.gram` fixture with three events (session, break, raffle). Point `AIE_MATRIX_CALENDAR` at it. Start the server. Issue `timecheck` and verify all three events appear.

**Acceptance Scenarios**:

1. **Given** a `.calendar.gram` file with valid `CalendarEvent` nodes, **When** the server starts with `AIE_MATRIX_CALENDAR` pointing to it, **Then** all events are loaded and visible in `timecheck` results.
2. **Given** a `.map.gram` file containing a `[:Calendar | ...]` block, **When** the parser processes it, **Then** the embedded events are loaded identically to a standalone `.calendar.gram` file.
3. **Given** a `.calendar.gram` file with a syntax error, **When** the server starts, **Then** startup fails with a clear error message identifying the file and line.

---

### Edge Cases

- What happens when `enterCommands` partially fails (first command succeeds, second fails)? The scheduler logs the failure and continues; the event is still marked as fired (see Open Question 6 in RFC-0021).
- What if the server is down when an event's `startsAt` passes? On next startup, the scheduler detects the unfired event and executes it immediately on the first tick.
- What if `startsAt` is in the past when the calendar file is loaded for the first time? Same as above — fires on first tick.
- What if two events share the same `startsAt`? Both fire on the same tick; order within the tick is unspecified.
- What if `duration` is negative? Treat as a malformed event; reject at parse time with a clear error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The server MUST expose a canonical clock source returning the current time as ISO 8601 with US/Pacific UTC offset; all services MUST use this source rather than accessing the system clock directly.
- **FR-002**: MCP conversation message records MUST include a `timestamp` field (ISO 8601, Pacific offset) set at write time.
- **FR-003**: A2A world event envelopes (IC-004) MUST include a `timestamp` field (ISO 8601, Pacific offset) set at emit time.
- **FR-004**: The server MUST expose a `timecheck` MCP tool available to all adopted ghosts, returning current Pacific time and timezone.
- **FR-005**: The `timecheck` response MUST include `now` (ISO 8601 with Pacific UTC offset) and `timezone` (IANA name `"America/Los_Angeles"`). No event schedule is surfaced — agents reason about time themselves.
- **FR-006**: The server MUST load calendar events from a `.calendar.gram` file specified by `AIE_MATRIX_CALENDAR`; if the variable is unset, the server starts without events (timeless mode).
- **FR-007**: The Gram parser MUST accept `CalendarEvent` nodes in a standalone `.calendar.gram` file and in an inline `[:Calendar | ...]` block within a `.map.gram` file; both representations MUST produce identical runtime behavior.
- **FR-008**: The `WorldCalendarService` MUST execute each event's `enterCommands` exactly once at or after `startsAt`, and each event's `exitCommands` exactly once at or after `startsAt + duration` (for window events); these invariants MUST hold across server restarts.
- **FR-009**: Commands MUST be dispatched through the existing `CommandExecutor` service using a `SchedulerContext` identity (`role: "system"`, no actor position); movement commands that require a position MUST return `NO_ACTOR_ORIGIN` and be logged without crashing the scheduler.
- **FR-010**: Calendar parsing MUST reject events with negative `duration` or missing required fields, failing server startup with a descriptive error.

### Key Entities

- **CalendarEvent**: A scheduled happening with a stable node identifier, `title`, `description`, `kind` (`session | break | raffle | custom`), `startsAt` (ISO 8601), `duration` (minutes, ≥ 0), optional `location` (polygon node identifier), `enterCommands` (string array), and `exitCommands` (string array).
- **SchedulerContext**: A caller identity used by the scheduler and other elevated callers (e.g. admin console) when dispatching commands through the `CommandExecutor`. Has `role: "system"` and no actor position.
- **ScheduledEvent**: The read-only projection of a `CalendarEvent` returned by `timecheck` — same fields minus the command lists.

### Interface Contracts

- **IC-001**: `ScheduledEvent` shape in `timecheck` response — `{ id, title, description, startsAt, duration, kind, location? }` — defined in the shared types package; `timecheck` and any future calendar-aware tools depend on this shape.
- **IC-002**: `SchedulerContext` type defined in the shared types package alongside existing ghost context types; `CommandExecutor` MUST accept it as a valid caller identity.
- **IC-003**: `.calendar.gram` / `[:Calendar | ...]` parse output — the calendar parser MUST produce a list of `CalendarEvent` values identical regardless of whether the source was a standalone file or an embedded block.
- **IC-004** (existing, extended): A2A world event envelope gains a mandatory `timestamp` field; the agent host and all consumers MUST tolerate this addition without breaking.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A ghost agent issues `timecheck` and receives `{ now, timezone }` within the same round-trip latency budget as other read-only MCP tools.
- **SC-002**: Every message in the conversation JSONL and every A2A event envelope produced after this feature lands includes a `timestamp` field; zero messages are produced without one.
- **SC-003**: A calendar event's `enterCommands` execute within one scheduler tick (≤ 30 seconds by default) of its `startsAt`; across 10 events in unit tests using stub Neo4j state, no event fires more than once and no event is skipped after a service restart.
- **SC-004**: A world author can load a `.calendar.gram` fixture and observe all events in `timecheck` output without writing any code outside the Gram file and environment variable.
- **SC-005**: Server startup with a malformed `.calendar.gram` file fails within 5 seconds with an error message that identifies the file and the specific parse failure.

## Assumptions

- The conference timezone is fixed at `America/Los_Angeles` for AIEWF 2026; no per-event timezone override is needed.
- The scheduler tick granularity of 30 seconds (configurable via `CALENDAR_TICK_MS`) is acceptable for conference-scale events; sub-minute precision is not required.
- No general `CommandExecutor` service exists in the codebase. This feature introduces a narrow `CalendarCommandDispatcher` that maps the known calendar command strings to their handler Effects. A full `CommandExecutor` refactor is out of scope and deferred to a future RFC.
- For MVP, a single `.calendar.gram` file (or inline `[:Calendar | ...]` block) covers the full schedule; multi-file composition is deferred (RFC-0021 Open Question 5).
- `timecheck` is a clock only — no event schedule is surfaced. Agents correlate time with schedule context they hold in memory.
- The `claim` precondition issue (speaker ghost must be in the room when `enterCommands` fires) is an open question in RFC-0021 and is not resolved by this spec; the MVP accepts that the claim may fail if the ghost is not pre-positioned.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — add `AIE_MATRIX_CALENDAR` and `CALENDAR_TICK_MS` to the Selected Environment Variables table; note `WorldCalendarService` in the Effect orchestration layer section.
- `specs/021-world-calendar/` — this spec and the sample fixture file (`server/world-api/src/calendar/fixtures/sample.calendar.gram`).
- `proposals/rfc/0021-world-calendar.md` — status update to `under review` once spec is accepted.
