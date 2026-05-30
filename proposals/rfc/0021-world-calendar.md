# RFC-0021: World Calendar — Temporal Dimension and Scheduled Events

**Status:** accepted  
**Date:** 2026-05-29  
**Authors:** @akollegger  
**Related:** [RFC-0012](0012-speaker-rooms.md), [RFC-0006](0006-world-objects.md), [RFC-0005](0005-ghost-conversation-model.md)

## Summary

This RFC adds a temporal dimension to the Matrix world: wall-clock time anchored to the conference timezone (US/Pacific), consistent ISO 8601 timestamping across all MCP and A2A message surfaces, a `timecheck` MCP tool for agents to query current time and upcoming events, and a `WorldCalendar` service that models the conference schedule as a set of calendar events and applies commands to world objects at their scheduled times. The scheduler is strictly a calendar — it fires commands at known times — not a job queue or workflow engine.

## Motivation

The Matrix runs alongside a real conference with a real schedule. Sessions start and end. Coffee breaks open and close. Raffles fire at specific moments. Without a temporal layer, the world has no way to reflect this structure:

- A speaker ghost cannot know when its session window opens and it should `claim` a room.
- A coffee-serving tile has no mechanism to become active during a break and inactive otherwise.
- A raffle booth cannot fire a winner-selection at a scheduled moment.
- Agents cannot reason about urgency, timing, or "what is happening right now."

Wall-clock time tied to the conference timezone is the natural anchor. No synthetic game clock is needed — "morning", "afternoon", and "evening" already carry meaning for attendees.

Timestamping across MCP and A2A is also currently inconsistent. Settling on one format allows agents to order messages, compute durations, and reason about recency without ambiguity.

## Design

### 1. World time

The canonical clock is `Date.now()` in UTC, always rendered as ISO 8601 with a UTC offset for the conference timezone (`America/Los_Angeles` / `US/Pacific`):

```
2026-06-05T09:30:00-07:00
```

A canonical clock utility is provided in the shared package, returning the current time as ISO 8601 with Pacific offset. All server services use this single source rather than calling `Date.now()` directly. There is no synthetic in-world clock; world time _is_ wall-clock time.

### 2. Consistent timestamping

Two surfaces gain mandatory `timestamp` fields:

**MCP message records** (conversation JSONL per RFC-0005):

```typescript
interface MessageRecord {
  thread_id: string
  message_id: string
  role: "user" | "assistant"
  content: string
  timestamp: string          // ISO 8601 with UTC offset — added
  mx_tile: string
  mx_listeners: string[]
  // ...existing fields
}
```

**A2A event envelopes** (IC-004 world event envelope):

```typescript
interface WorldEventEnvelope {
  kind: "aie-matrix.world-event.v1"
  timestamp: string          // ISO 8601 with UTC offset — added
  payload: unknown
}
```

Both fields are required and always set server-side. Clients and agents that ignore them remain unaffected; clients that consume them gain a reliable ordering key.

### 3. `timecheck` MCP tool

A new read-only MCP tool available to all adopted ghosts. `timecheck` is a clock — it tells an agent what time it is. Agents are expected to be temporally aware: if they need to correlate the current time with a scheduled event, that reasoning is theirs to perform using context they already hold.

```typescript
timecheck() => {
  now: string       // ISO 8601 current time in Pacific
  timezone: string  // "America/Los_Angeles"
}
```

### 4. WorldCalendar service

#### Data model

Calendar events are stored as Neo4j nodes with the properties defined by the Gram format: `id`, `title`, `description`, `kind`, `startsAt`, `duration`, `enterCommands`, `exitCommands`. For events tied to a world location, a relationship links the event to its target:

```cypher
(:Event)-[:LOCATED_AT]->(:Tile|:Polygon)
```

The service tracks which events have already fired so they are not re-executed after a server restart. The storage mechanism for this tracking (node properties, a separate audit relationship, or similar) is left to the implementer, provided the invariant holds: an event's `enterCommands` fire exactly once, and its `exitCommands` fire exactly once (for window events).

#### Commands as the mutation model

Rather than encoding bespoke state-change payloads, each `ScheduleEvent` carries two lists of **commands** — the same command strings that any ghost or operator issues through the existing command processing engine. The scheduler executes commands through the same `CommandExecutor` service used by ghost MCP handlers. It supplies a `SchedulerContext` as the caller identity — a fixed system identity with no `h3Index` (hence `NO_ACTOR_ORIGIN` for movement commands) but with `role: "system"` that bypasses ghost-ownership checks. This context type is defined in the shared package alongside the existing ghost context types.

```
// Window event: session in Hall A
enterCommands: ["claim hall-a ghost_keynote_speaker"]
exitCommands:  ["yield hall-a"]

// Window event: coffee tile activation
enterCommands: ["activate lobby-coffee"]
exitCommands:  ["deactivate lobby-coffee"]

// Point event: raffle
enterCommands: ["raffle vendor-booth-12"]
exitCommands:  []
```

Commands that require a positioned actor (e.g. `go n`) fail gracefully when no actor origin is available — the same result as trying to move through a wall or off the map edge. The command executor returns a `NO_ACTOR_ORIGIN` error; the scheduler (and any other elevated caller such as an admin console) logs it and continues. No special scheduler-specific error type is needed; the failure is a property of the command, not the caller.

This means every new world mechanic that needs a command gets scheduler support for free, as long as the command is defined. No new scheduler-specific state-change variant is needed.

#### Scheduler fiber

A long-running Effect fiber starts with the server and polls for due events at a configurable tick interval (default: 30 seconds):

```
SchedulerFiber:
  loop:
    now = worldNow()
    starting = query Neo4j for ScheduleEvents where startsAt <= now AND started = false
    for each event: executeCommands(event.enterCommands); mark event.started = true
    ending = query Neo4j for ScheduleEvents
               where startsAt + duration <= now AND started = true AND ended = false
               AND duration > 0
    for each event: executeCommands(event.exitCommands); mark event.ended = true
    sleep(tickInterval)
```

The fiber is a `Layer.scoped` Effect service (`WorldCalendarService`) composed into the main server `ManagedRuntime`. It does not replace the server's clock; it only reads `worldNow()` and queries Neo4j.

#### Window vs. point events

| Category | `duration` | Behavior |
|---|---|---|
| Window event | `> 0` | `enterCommands` run at `startsAt`; `exitCommands` run at `startsAt + duration` |
| Point event | `0` | `enterCommands` run once at `startsAt`; `exitCommands` ignored |

The raffle is a point event. Sessions and breaks are window events.

#### Recurring events

A `ScheduleEvent` with `repeat` (minutes) and `until` (ISO 8601) repeats on a fixed interval. Both fields are optional; omitting `repeat` gives a one-off event. `until` is required when `repeat` is set — open-ended recurrence is not supported (a conference has defined hours).

```gram
(hourly-checkin:Event {
  title: "Info Booth Check-in",
  description: "Stop by the info booth for conference updates.",
  kind: "custom",
  startsAt: "09:00:00",
  duration: 10,
  repeat: 60,
  until: "18:00:00",
  location: "info-booth",
  enterCommands: ["activate info-booth"],
  exitCommands: ["deactivate info-booth"]
})
```

At map load time the server **expands** recurring events into discrete one-off occurrences before handing them to the scheduler. Each occurrence gets a derived stable ID: `{id}#{n}` (1-indexed). The scheduler itself has no knowledge of recurrence — it operates only on the expanded flat list, exactly as it does for one-off events.

The `hourly-checkin` event above produces 10 occurrences: `hourly-checkin#1` at 09:00, `hourly-checkin#2` at 10:00, … `hourly-checkin#10` at 18:00. This mirrors Google Calendar's behaviour — a recurring event is a template that generates a concrete series of dated instances.

#### Environment variables

| Variable | Purpose |
|---|---|
| `CALENDAR_TICK_MS` | Scheduler poll interval in milliseconds. Default: `30000`. |

**Current implementation (transitional)**: `AIE_MATRIX_CALENDAR` points to a standalone `.calendar.gram` file loaded at startup. **Target design**: the calendar is loaded from the active map's `[schedule:Schedule | ...]` block, eliminating the separate file. The `canonical.map.gram` already demonstrates this format. The standalone-file path will be removed once the map-loading integration is complete. No calendar block → world runs in timeless mode; `timecheck` still works.

### 5. Calendar Gram format

A calendar is authored directly in the `.map.gram` file as a `[schedule:Schedule | ...]` block, exactly as rules are embedded with `[rules:Rules | ...]`. The map is the complete description of the world — tiles, polygons, rules, and schedule together.

```gram
[schedule:Schedule |
  (opening-keynote:Event {
    title: "Opening Keynote",
    description: "Welcome address and opening session in the main hall.",
    kind: "session",
    startsAt: "09:00:00",
    duration: 60,
    location: "hall-a",
    enterCommands: ["claim hall-a ghost_keynote_speaker"],
    exitCommands: ["yield hall-a"]
  }),
  (morning-break:Event {
    title: "Morning Coffee Break",
    description: "Coffee and networking in the main lobby. The coffee cart is open.",
    kind: "break",
    startsAt: "10:00:00",
    duration: 30,
    location: "lobby-coffee",
    enterCommands: ["activate lobby-coffee"],
    exitCommands: ["deactivate lobby-coffee"]
  }),
  (booth-12-raffle:Event {
    title: "Vendor Raffle — Booth 12",
    description: "End-of-day raffle at the Booth 12 vendor area. Must be present to win.",
    kind: "raffle",
    startsAt: "17:00:00",
    duration: 0,
    location: "vendor-booth-12",
    enterCommands: ["raffle vendor-booth-12"],
    exitCommands: []
  }),
  (hourly-checkin:Event {
    title: "Info Booth Check-in",
    description: "Stop by the info booth for conference updates.",
    kind: "custom",
    startsAt: "09:00:00",
    duration: 10,
    repeat: 60,
    until: "18:00:00",
    location: "info-booth",
    enterCommands: ["activate info-booth"],
    exitCommands: ["deactivate info-booth"]
  })
]
```

The node identifier (e.g. `opening-keynote`) is the stable machine key used in logging and Neo4j; it does not change when `title` or `description` are edited. A map with no `[schedule:Schedule | ...]` block loads normally and runs in timeless mode.

## Demo Scenario

A contributor can verify the full mechanic end-to-end in roughly fifteen minutes:

1. Start the server with `AIE_MATRIX_CALENDAR` pointing at the sample `.calendar.gram` fixture (to be committed at `server/world-api/src/calendar/fixtures/sample.calendar.gram`). Set `CALENDAR_TICK_MS=5000` for fast iteration.
2. Adopt a ghost. Issue `timecheck`. Verify the response includes `now` (ISO 8601 with Pacific offset), `timezone: "America/Los_Angeles"`, and at least one upcoming event with `title`, `description`, `startsAt`, and `duration`.
3. Issue `say` from the ghost. Verify the emitted message record includes a `timestamp` field. Verify a received A2A event envelope also includes a `timestamp` field.
4. Set a `ScheduleEvent`'s `startsAt` to a value a few seconds in the future. Wait one tick. Verify the `enterCommands` executed — e.g. the target tile is now active, or the designated speaker ghost holds the room claim.
5. Wait past `startsAt + duration`. Wait one tick. Verify `exitCommands` executed — e.g. the tile is inactive again.
6. Restart the server. Verify already-fired events do not re-fire.

## Open Questions

1. ~~**Ghost visibility for `timecheck`**~~ **Resolved**: `timecheck` returns only the current time and timezone — no event list. Agents are temporally aware by design; correlating a known schedule with the current time is their responsibility, not the tool's.

2. ~~**`claim` precondition with calendar dispatch**~~ **Resolved**: The scheduler is command-agnostic — it fires and forgets. A failed `claim` (speaker not yet in the room, room already claimed, etc.) is logged at warn level and the scheduler continues. No retry, no special handling. World authors are responsible for authoring calendars where commands are likely to succeed; the scheduler does not second-guess them.

3. ~~**Calendar management at runtime**~~ **Deferred**: For MVP, the calendar is part of world/map authoring — events are defined in `.calendar.gram` alongside the map and rules, and loaded at startup. Runtime additions are out of scope for now. When this becomes necessary, the right surface is privileged `schedule` and `cancel` commands (not a new HTTP endpoint), consistent with the command-based model used throughout. The scheduler fiber would need to query Neo4j for live event state rather than iterating the startup-loaded in-memory array.

4. ~~**`CALENDAR_TICK_MS` floor**~~ **Resolved**: The scheduler polls every `CALENDAR_TICK_MS` milliseconds (default `30000` = 30 seconds), so an event may fire up to 30 seconds after its `startsAt`. This is acceptable for conference-scale events where the meaningful granularity is minutes. World authors should treat `startsAt` precision as ± `CALENDAR_TICK_MS`. A sleep-until-next-event approach would give sub-second precision but adds complexity and is not worth it unless sub-minute scheduling becomes a requirement.

5. ~~**Multi-file calendars**~~ **Resolved**: Standalone `.calendar.gram` files are not supported. A calendar belongs in the `.map.gram` file as a `[schedule:Schedule | ...]` block — the map is the complete description of the world at a point in time. Multi-day schedules are handled by map switching. `AIE_MATRIX_CALENDAR` is removed; the world server loads the calendar from the active map's `[schedule:Schedule | ...]` block the same way it loads tiles and rules.

6. ~~**Command sequence atomicity**~~ **Resolved**: The scheduler is fire-and-forget — execution continues past individual command failures. Each command in a sequence is attempted independently; a failure is logged at warn level and the next command runs. This is consistent with the scheduler's agnosticism toward command semantics.

## Addendum: `announce` command

The calendar scheduler needs a way to deliver a message to all adopted ghosts regardless of their position — for example, "Morning coffee break starts in 5 minutes, head to the lobby." The existing `say` command is position-scoped (local cluster) and room-scoped `say` (RFC-0012) is polygon-scoped. Neither covers world-wide reach. Crucially, `announce` is **not** a conversation mechanic: it is a one-shot, single-direction world event — no thread, no reply, no conversational mode side-effects.

### Design

`announce` fires a `world.announcement` A2A event directly to all currently adopted ghosts. It does not touch conversation threads, does not enter or require conversational mode, and carries no `thread_id`. It is structurally identical to other `WorldEventKind` events (proximity, session start/end) — a typed push notification agents observe and act on.

It is not available to ordinary ghost agents — the grant list is intentionally small:

- **Scheduler** (`SchedulerContext`) — fires announce as part of `enterCommands` / `exitCommands`
- **Admin console** — operator-initiated announcements at runtime

```gram
(coffee-warning:Event {
  title: "Coffee break in 5 minutes",
  kind: "break",
  startsAt: "09:55:00",
  duration: 0,
  enterCommands: ["announce Coffee break starts in 5 minutes — head to the lobby."]
})
```

### A2A event shape

```typescript
// WorldEventKind gains: "world.announcement"
{
  schema: "aie-matrix.world-event.v1",
  kind: "world.announcement",
  payload: {
    content: string,       // the announcement text
    source: "scheduler" | "admin"
  },
  timestamp: string        // ISO 8601, Pacific offset
}
```

No `thread_id`, no `message_id`, no reply surface. Agents handle it the same way they handle `world.proximity.enter` — observe and decide.

### Command surface

```typescript
announce({ content: string }) => {
  ok: true,
  delivered: number   // count of ghost IDs the event was pushed to
}
```

Rejected with `ANNOUNCE_NOT_AUTHORIZED` if called without the announcer grant. Rejected with `ANNOUNCE_CONTENT_EMPTY` if `content` is blank.

### Open questions

- Should there be a `title` field on `world.announcement` separate from `content`, so agents can triage without parsing the message body?
- Should the admin console surface `announce` as a dedicated UI action, or compose it from the existing command input?

## Alternatives

**Synthetic game clock instead of wall-clock time.** A game clock could run at an accelerated rate for testing. Rejected: the Matrix is tied to a real conference; synthetic time would decouple in-world events from the IRL schedule that motivates them.

**Bespoke state-change payloads instead of commands.** An earlier draft used a typed `StateChange` discriminated union (`assign-speaker`, `set-tile-active`, `fire-raffle`). Rejected: it requires a parallel extension path alongside the command system. Using commands as the mutation model means every new mechanic that gets a command automatically works with the scheduler.

**Event-driven triggers instead of a calendar.** State changes could be triggered by in-world events ("when ghost X enters room Y, fire Z") rather than by time. This models reactive mechanics (RFC-0002 rules) but does not model the conference schedule, which is calendar-driven by definition. Both can coexist; this RFC covers the calendar case only.

**External cron service instead of a server fiber.** A separate cron job could POST to a `/calendar/tick` endpoint. This externalizes scheduling but adds a deployment dependency and loses the Effect structured-concurrency guarantees. The fiber approach keeps everything inside the existing `ManagedRuntime` scope.

**Store events only in memory.** Simpler than Neo4j, but violates the stateless-application-service invariant from ADR-0007: a server restart would lose `started`/`ended` markers and could re-fire events. Neo4j persistence is required.
