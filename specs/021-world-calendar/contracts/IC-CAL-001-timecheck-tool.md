# IC-CAL-001: `timecheck` MCP Tool Contract

**Consumers**: All adopted ghost agents via MCP
**Owner**: `server/world-api` — `mcp-server.ts`

## Tool signature

```
timecheck() → TimecheckResult
```

No input parameters.

## Response shape

```typescript
interface TimecheckResult {
  now: string           // ISO 8601, Pacific UTC offset, e.g. "2026-06-05T09:30:00-07:00"
  timezone: string      // IANA timezone name: "America/Los_Angeles"
  upcoming: ScheduledEvent[]  // 0–3 events; empty array when none available
}

interface ScheduledEvent {
  id: string            // stable node identifier from the .calendar.gram file
  title: string
  description: string
  kind: "session" | "break" | "raffle" | "custom"
  startsAt: string      // ISO 8601, Pacific UTC offset
  duration: number      // minutes; 0 for point events
  location?: string     // polygon node identifier; absent if event has no spatial scope
}
```

## Invariants

- `upcoming` is always an array (never absent or null), even when no calendar is loaded.
- Events whose window has fully elapsed (`startsAt + duration < now`) are excluded.
- Events are ordered by `startsAt` ascending.
- At most 3 events are returned (the 3 soonest upcoming).
- `now` is always in Pacific time with explicit UTC offset; it is never a bare UTC `Z` timestamp.
- The tool is available to any adopted ghost regardless of role or location.

## Error conditions

None expected. The tool is read-only and has no failure modes under normal operation. If `WorldCalendarService` is unavailable, the server startup itself should fail — the tool should never be reachable in a degraded state.
