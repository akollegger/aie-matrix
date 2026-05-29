# RFC-0021: World Calendar — Temporal Dimension and Scheduled Events

**Status:** draft  
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

A new read-only MCP tool available to all adopted ghosts:

```typescript
timecheck() => {
  now: string                // ISO 8601 current time in Pacific
  timezone: string           // "America/Los_Angeles"
  upcoming: ScheduledEvent[] // next N events visible to this ghost (default N=3)
}

interface ScheduledEvent {
  id: string                 // stable event identifier
  title: string              // human-readable label
  description: string        // sentence or two of context
  startsAt: string           // ISO 8601
  duration: number           // minutes; 0 for point events
  location?: string          // polygon node identifier if spatially scoped
  kind: "session" | "break" | "raffle" | "custom"
}
```

`duration` expresses the length of the event in minutes, matching the human-scale granularity of the calendar (the same philosophy as using tiles rather than continuous coordinates). `endsAt` is a derived value — `startsAt + duration` — and is not stored or returned directly. The `upcoming` list excludes events whose window has fully elapsed.

"Visible to this ghost" initially means all events — no ghost-specific filtering. A future iteration can scope by location proximity or ghost class.

### 4. WorldCalendar service

#### Data model

Calendar events are stored as Neo4j nodes with the properties defined by the Gram format: `id`, `title`, `description`, `kind`, `startsAt`, `duration`, `enterCommands`, `exitCommands`. For events tied to a world location, a relationship links the event to its target:

```cypher
(:CalendarEvent)-[:LOCATED_AT]->(:Tile|:Polygon)
```

The service tracks which events have already fired so they are not re-executed after a server restart. The storage mechanism for this tracking (node properties, a separate audit relationship, or similar) is left to the implementer, provided the invariant holds: an event's `enterCommands` fire exactly once, and its `exitCommands` fire exactly once (for window events).

#### Commands as the mutation model

Rather than encoding bespoke state-change payloads, each `CalendarEvent` carries two lists of **commands** — the same command strings that any ghost or operator issues through the existing command processing engine. The scheduler executes commands through the same `CommandExecutor` service used by ghost MCP handlers. It supplies a `SchedulerContext` as the caller identity — a fixed system identity with no `h3Index` (hence `NO_ACTOR_ORIGIN` for movement commands) but with `role: "system"` that bypasses ghost-ownership checks. This context type is defined in the shared package alongside the existing ghost context types.

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
    starting = query Neo4j for CalendarEvents where startsAt <= now AND started = false
    for each event: executeCommands(event.enterCommands); mark event.started = true
    ending = query Neo4j for CalendarEvents
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

#### Environment variables

| Variable | Purpose |
|---|---|
| `AIE_MATRIX_CALENDAR` | Path to a `.calendar.gram` file. Unset → no events loaded; world runs in a timeless state with `timecheck` still available. |
| `CALENDAR_TICK_MS` | Scheduler poll interval in milliseconds. Default: `30000`. |

### 5. Calendar Gram format

Calendar events live in a dedicated `.calendar.gram` file — a sibling to the map and rules files, not embedded inside them. Like rules, the format is a flat sequence of nodes with no enclosing layer or wrapper:

```gram
(opening-keynote:CalendarEvent {
  title: "Opening Keynote",
  description: "Welcome address and opening session in the main hall.",
  kind: "session",
  startsAt: "2026-06-05T09:00:00-07:00",
  duration: 60,
  location: "hall-a",
  enterCommands: ["claim hall-a ghost_keynote_speaker"],
  exitCommands: ["yield hall-a"]
})

(morning-break:CalendarEvent {
  title: "Morning Coffee Break",
  description: "Coffee and networking in the main lobby. The coffee cart is open.",
  kind: "break",
  startsAt: "2026-06-05T10:00:00-07:00",
  duration: 30,
  location: "lobby-coffee",
  enterCommands: ["activate lobby-coffee"],
  exitCommands: ["deactivate lobby-coffee"]
})

(booth-12-raffle:CalendarEvent {
  title: "Vendor Raffle — Booth 12",
  description: "End-of-day raffle at the Booth 12 vendor area. Must be present to win.",
  kind: "raffle",
  startsAt: "2026-06-05T17:00:00-07:00",
  duration: 0,
  location: "vendor-booth-12",
  enterCommands: ["raffle vendor-booth-12"],
  exitCommands: []
})
```

The node identifier (e.g. `opening-keynote`) is the stable machine key used in logging and Neo4j; it does not change when `title` or `description` are edited. Multiple `.calendar.gram` files can be composed for multi-day conferences by concatenating them or pointing `AIE_MATRIX_CALENDAR` at each in sequence (open question — see below).

A calendar can also be embedded directly in a `.map.gram` file using an anonymous `Calendar` block, exactly as rules are embedded with `[rules:Rules | ...]`:

```gram
[:Calendar |
  (opening-keynote:CalendarEvent {
    title: "Opening Keynote",
    ...
  })

  (morning-break:CalendarEvent { ... })
]
```

The standalone `.calendar.gram` file and the embedded `[:Calendar | ...]` block are equivalent representations. The parser treats them the same way.

## Demo Scenario

A contributor can verify the full mechanic end-to-end in roughly fifteen minutes:

1. Start the server with `AIE_MATRIX_CALENDAR` pointing at the sample `.calendar.gram` fixture (to be committed at `server/world-api/src/calendar/fixtures/sample.calendar.gram`). Set `CALENDAR_TICK_MS=5000` for fast iteration.
2. Adopt a ghost. Issue `timecheck`. Verify the response includes `now` (ISO 8601 with Pacific offset), `timezone: "America/Los_Angeles"`, and at least one upcoming event with `title`, `description`, `startsAt`, and `duration`.
3. Issue `say` from the ghost. Verify the emitted message record includes a `timestamp` field. Verify a received A2A event envelope also includes a `timestamp` field.
4. Set a `CalendarEvent`'s `startsAt` to a value a few seconds in the future. Wait one tick. Verify the `enterCommands` executed — e.g. the target tile is now active, or the designated speaker ghost holds the room claim.
5. Wait past `startsAt + duration`. Wait one tick. Verify `exitCommands` executed — e.g. the tile is inactive again.
6. Restart the server. Verify already-fired events do not re-fire.

## Open Questions

1. **Ghost visibility for `timecheck`**: Should upcoming events be filtered by the ghost's current location or class? A Scavenger probably doesn't need session schedules; a Scholar doesn't need raffle times. Filtering could be added without changing the tool surface.

2. **`claim` precondition with calendar dispatch**: The `ClaimRule` in RFC-0012 requires the speaker to be physically inside the room. If the speaker ghost hasn't arrived yet when the calendar fires the `claim` command, the command fails. Should the scheduler retry? Should speaker ghosts have a pre-positioning convention?

3. **Calendar management at runtime**: The Gram seed file covers the known conference schedule. Should an operator endpoint exist to add one-off events at runtime (e.g., an impromptu BoF)?

4. **`CALENDAR_TICK_MS` floor**: A 30-second poll granularity means events can fire up to 30 seconds late. Is this acceptable, or should the fiber sleep until the *next* scheduled event rather than polling at a fixed interval?

5. **Multi-file calendars**: For a multi-day conference, should `AIE_MATRIX_CALENDAR` accept a glob or a comma-separated list of `.calendar.gram` paths, or is a single concatenated file the expected authoring convention?

6. **Command sequence atomicity**: If `enterCommands` or `exitCommands` contains multiple commands and one fails mid-sequence, should execution halt or continue? The raffle and speaker-claim scenarios both use single-command lists, but the model permits multi-command sequences.

## Alternatives

**Synthetic game clock instead of wall-clock time.** A game clock could run at an accelerated rate for testing. Rejected: the Matrix is tied to a real conference; synthetic time would decouple in-world events from the IRL schedule that motivates them.

**Bespoke state-change payloads instead of commands.** An earlier draft used a typed `StateChange` discriminated union (`assign-speaker`, `set-tile-active`, `fire-raffle`). Rejected: it requires a parallel extension path alongside the command system. Using commands as the mutation model means every new mechanic that gets a command automatically works with the scheduler.

**Event-driven triggers instead of a calendar.** State changes could be triggered by in-world events ("when ghost X enters room Y, fire Z") rather than by time. This models reactive mechanics (RFC-0002 rules) but does not model the conference schedule, which is calendar-driven by definition. Both can coexist; this RFC covers the calendar case only.

**External cron service instead of a server fiber.** A separate cron job could POST to a `/calendar/tick` endpoint. This externalizes scheduling but adds a deployment dependency and loses the Effect structured-concurrency guarantees. The fiber approach keeps everything inside the existing `ManagedRuntime` scope.

**Store events only in memory.** Simpler than Neo4j, but violates the stateless-application-service invariant from ADR-0007: a server restart would lose `started`/`ended` markers and could re-fire events. Neo4j persistence is required.
