# Research: World Calendar

## Canonical clock source

**Decision**: Use `Date.now()` formatted with `Intl.DateTimeFormat` (or a lightweight helper) to render ISO 8601 with the Pacific UTC offset. No third-party date library is needed; Node 24 has full IANA timezone support via the built-in `Intl` API.

**Where to put it**: A single exported function in `shared/types/src/time.ts`, re-exported from `@aie-matrix/shared-types`. This mirrors how `MessageRecord` is defined in `shared/types/src/conversation.ts` — shared types own shared contracts.

**Rationale**: Keeps the clock co-located with the types that use it (`MessageRecord`, `WorldEvent`). Zero new dependencies.

---

## Timestamp field on existing message surfaces

**MessageRecord** (`shared/types/src/conversation.ts`): The field `timestamp: string` **already exists** in the current definition. No schema change required — only a verification that all write paths set it from the canonical clock rather than ad-hoc `new Date().toISOString()` calls.

**WorldEvent (IC-004)** (`server/agent-host/src/types.ts`): The envelope has a `sentAt: string` field, which is already emitted. The RFC refers to `timestamp` — the implementation should decide whether to rename `sentAt` → `timestamp` for consistency, or alias it. Renaming is a breaking change to IC-004 consumers; aliasing (adding `timestamp` alongside `sentAt`) is safer for the first iteration and can be cleaned up later.

**Decision**: Add `timestamp` to `WorldEvent` as an alias for `sentAt` in the first pass. Document the deprecation of `sentAt` as a follow-on cleanup.

---

## CalendarEvent Gram parsing

**Pattern to follow**: Rules are parsed in `server/world-api/src/rules/gram-rules.ts` using `@relateby/pattern`'s `Gram.parse()`. The parser returns raw Gram AST nodes; the rules loader then extracts typed values from them.

**Calendar parsing location**: New file `server/world-api/src/calendar/parse-calendar-gram.ts`, mirroring `rules/gram-rules.ts`. Parses `CalendarEvent` nodes from a flat Gram file or an inline `[:Calendar | ...]` block.

**Gram node shape**: A `CalendarEvent` node is a labeled node with properties. The Gram AST represents it as a `Node` with labels `["CalendarEvent"]` and a properties map. String array properties (`enterCommands`, `exitCommands`) are Gram array literals.

**Startup loading**: `server/src/index.ts` currently loads rules from `AIE_MATRIX_RULES` at startup (lines 366–372). Calendar loading follows the same pattern: read `AIE_MATRIX_CALENDAR`, parse, pass to `WorldCalendarService` layer construction. Absent env var → empty event list; service still starts (timeless mode).

**Embedded calendar in `.map.gram`**: The `parseMapGram` function in `shared/map-gram/src/parse.ts` already processes layered blocks. A `[:Calendar | ...]` block can be extracted by the same parser as an unrecognized layer type — the calendar loader checks if a parsed map includes a `Calendar`-labeled block and extracts its nodes. This is additive; the existing `parseMapGram` does not need to change.

---

## WorldCalendarService design

**Follows**: `ItemService` pattern (stateful, in-memory tracking overlaid on persisted data) and `MovementRulesService` pattern (loaded once at startup, effectively immutable at runtime).

**Interface**:
```
WorldCalendarService:
  upcomingEvents(limit: number): Effect<ScheduledEvent[]>
  tick(): Effect<void>   // called by the scheduler fiber on each interval
```

`tick()` queries the internal event list for events that are due (start or end), executes their commands via `CommandExecutor`, and records which have fired. The fired-event state must survive server restarts — see persistence section below.

**Layer construction**: `makeWorldCalendarLayer(events: CalendarEvent[])` — takes parsed events, returns a `Layer` providing `WorldCalendarService`. Composed into `ManagedRuntime` in `server/src/index.ts`.

---

## CommandExecutor and SchedulerContext

**Current state**: There is no `CommandExecutor` service. MCP tools are implemented as individual Effect functions wired directly into `mcp-server.ts`. There is no shared dispatch layer.

**Decision**: Do not introduce a general `CommandExecutor` for this feature — that is a larger refactor than the RFC scope justifies. Instead, implement a `CalendarCommandDispatcher` in `server/world-api/src/calendar/` that maps the command strings used in `enterCommands`/`exitCommands` to the specific Effect functions that implement them. This is a narrower surface: only the commands that make sense for calendar dispatch are registered (`claim`, `yield`, `activate`, `deactivate`, `raffle`). Movement commands (`go`) are not registered and return `NO_ACTOR_ORIGIN` by convention.

**SchedulerContext**: A plain tagged type `{ _tag: "SchedulerContext" }` passed alongside commands to bypass ghost-identity checks. The individual command Effect functions that the dispatcher calls accept an optional caller context.

**Rationale**: A full `CommandExecutor` refactor would require touching every MCP tool handler. The calendar scope is limited to a small, known set of commands. The dispatcher is an explicit extension point for future commands; the RFC's "free scheduler support for every command" observation remains aspirational until a full refactor lands.

---

## Fired-event persistence

**Current constraint**: ADR-0007 mandates stateless application services — fired-event state cannot live only in process memory.

**Decision**: Store `fired` and `ended` markers as boolean properties on `(:CalendarEvent)` Neo4j nodes. This is the simplest approach given Neo4j is already the world graph store and the only other stateful backing services (Redis) are scoped to ephemeral presence data.

**Neo4j write**: `MERGE (:CalendarEvent {id: $id}) SET n.started = true` — idempotent on restart.

**Alternative considered**: A separate `(:EventFired {eventId, firedAt})` node for auditability. Deferred — the boolean property approach is sufficient for MVP and can be migrated to an audit node without changing the scheduler logic.

---

## `timecheck` MCP tool placement

**Location**: Added to `server/world-api/src/mcp-server.ts` alongside the existing tools (`whereami`, `look`, etc.) via `server.registerTool("timecheck", ...)`. The tool calls `WorldCalendarService.upcomingEvents(3)` and the canonical clock utility.

**Registration**: The tool is registered for all adopted ghosts (no role restriction), matching the pattern of `whereami` and `whoami`.

---

## Testing approach

**Framework**: Node built-in `node:test` with `ManagedRuntime` — same as `MapService.test.ts` and `WorldService.test.ts` patterns.

**Unit tests** (no live Neo4j needed):
- `parse-calendar-gram.test.ts` — parses fixture files, validates `CalendarEvent` extraction, rejects malformed input.
- `WorldCalendarService.test.ts` — tests `upcomingEvents()` filtering (elapsed events excluded, limit respected), `tick()` command dispatch with a stub dispatcher, fired-event idempotency (tick does not re-dispatch already-fired events).

**Integration tests** (require Neo4j):
- Fired-event persistence: after `tick()`, restart service, confirm events are not re-fired.

**Fixtures**: A `server/world-api/src/calendar/fixtures/sample.calendar.gram` with three events (session, break, raffle) covering window and point event types, reused by unit tests and the demo scenario.
