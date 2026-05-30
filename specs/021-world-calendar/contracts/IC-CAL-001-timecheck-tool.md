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
  now: string       // ISO 8601, Pacific UTC offset, e.g. "2026-06-05T09:30:00-07:00"
  timezone: string  // IANA timezone name: "America/Los_Angeles"
}
```

`timecheck` is a clock. It tells the agent what time it is. Event schedules are not surfaced here — agents are expected to be temporally aware and correlate the current time with any schedule context they already hold.

## Invariants

- `now` is always in Pacific time with an explicit UTC offset; never a bare UTC `Z` timestamp.
- `timezone` is always `"America/Los_Angeles"`.
- The tool is available to any adopted ghost regardless of role or location.
- The tool never fails under normal operation.
