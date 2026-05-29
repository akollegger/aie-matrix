# Data Model: World Calendar

## CalendarEvent

Represents a scheduled happening. Loaded from a `.calendar.gram` file at startup; persisted to Neo4j for fired-event tracking.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | string (ULID) | required, unique | Gram node identifier; stable machine key |
| `title` | string | required | Human-readable label |
| `description` | string | required | Sentence or two; surfaced via `timecheck` |
| `kind` | `"session" \| "break" \| "raffle" \| "custom"` | required | Drives `timecheck` filtering in future iterations |
| `startsAt` | string (ISO 8601) | required | Pacific UTC offset |
| `duration` | integer (minutes) | required, ≥ 0 | 0 = point event |
| `location` | string | optional | Polygon node identifier from the map |
| `enterCommands` | string[] | required (may be empty) | Commands dispatched at `startsAt` |
| `exitCommands` | string[] | required (may be empty) | Commands dispatched at `startsAt + duration`; ignored for point events |

**Derived**: `endsAt = startsAt + duration` (not stored; computed when needed)

**Validation rules**:
- `duration` must be ≥ 0; negative values are a parse error
- `startsAt` must be a valid ISO 8601 datetime
- `enterCommands` and `exitCommands` must be non-null arrays (empty array is valid)
- `id` must be unique within the loaded event set

## ScheduledEvent (read-only projection)

Returned by the `timecheck` MCP tool. Command lists are omitted — agents see what is happening, not how it is implemented.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same as `CalendarEvent.id` |
| `title` | string | |
| `description` | string | |
| `kind` | string | |
| `startsAt` | string (ISO 8601) | |
| `duration` | integer (minutes) | |
| `location` | string? | Optional |

## Neo4j schema

```cypher
(:CalendarEvent {
  id: string,       // unique constraint
  started: boolean, // true after enterCommands fire
  ended: boolean    // true after exitCommands fire (window events only)
})

(:CalendarEvent)-[:LOCATED_AT]->(:Tile|:Polygon)
```

Uniqueness constraint: `CREATE CONSTRAINT calendar_event_id_unique IF NOT EXISTS FOR (e:CalendarEvent) REQUIRE e.id IS UNIQUE`

The `started` and `ended` properties are write-once by the scheduler. Only these two properties need Neo4j persistence; all other event data is loaded from the Gram file at startup.

## WorldEvent envelope extension (IC-004)

The existing `WorldEvent` type in `server/agent-host/src/types.ts` gains a `timestamp` field alongside the existing `sentAt`:

```typescript
type WorldEvent = {
  readonly schema: "aie-matrix.world-event.v1"
  readonly eventId: string
  readonly ghostId: string
  readonly kind: WorldEventKind
  readonly payload: Record<string, unknown>
  readonly sentAt: string    // existing — retained for compatibility
  readonly timestamp: string // added — canonical Pacific ISO 8601
}
```

`sentAt` is retained for backwards compatibility and deprecated; `timestamp` is the authoritative field going forward.

## MessageRecord extension

`MessageRecord` in `shared/types/src/conversation.ts` already includes a `timestamp: string` field. No schema change is needed; the implementation must verify all write paths supply it from the canonical clock utility rather than ad-hoc `new Date().toISOString()`.

## State transitions

### CalendarEvent lifecycle

```
[loaded]
   │
   │  startsAt reached
   ▼
[started]  ← enterCommands dispatched; Neo4j started=true
   │
   │  startsAt + duration reached (window events only)
   ▼
[ended]    ← exitCommands dispatched; Neo4j ended=true

Point events (duration=0): [loaded] → [started]; no [ended] transition
```

### Scheduler fiber tick

```
tick():
  for each event where startsAt ≤ now AND started=false:
    dispatch enterCommands → mark started=true in Neo4j

  for each event where (startsAt + duration) ≤ now
                   AND started=true AND ended=false
                   AND duration > 0:
    dispatch exitCommands → mark ended=true in Neo4j
```
