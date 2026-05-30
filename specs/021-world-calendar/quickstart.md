# Quickstart: World Calendar

## Prerequisites

- Server running locally (`pnpm dev` from repo root, or `pnpm dev` inside `server/`)
- A ghost adopted (use the ghost CLI or ghost management UI)
- Neo4j available (local Docker or Aura)

## Step 1 — Load the sample calendar

Set the environment variable before starting the server:

```bash
AIE_MATRIX_CALENDAR=server/world-api/src/calendar/fixtures/sample.calendar.gram
CALENDAR_TICK_MS=5000   # fast ticks for local testing
```

## Step 2 — Issue `timecheck`

From a ghost MCP session:

```json
{ "tool": "timecheck", "params": {} }
```

Expected response:

```json
{
  "now": "2026-06-05T09:15:00-07:00",
  "timezone": "America/Los_Angeles",
  "upcoming": [
    {
      "id": "opening-keynote",
      "title": "Opening Keynote",
      "description": "Welcome address and opening session in the main hall.",
      "kind": "session",
      "startsAt": "2026-06-05T09:00:00-07:00",
      "duration": 60,
      "location": "hall-a"
    }
  ]
}
```

## Step 3 — Verify scheduler fires

Edit the fixture to set `startsAt` to a time ~15 seconds in the future. Restart the server. Watch server logs — within one tick (5s) you should see the enter commands execute.

## Step 4 — Verify fired-event idempotency

After the event fires, restart the server. The event should not re-fire. Confirm via server logs and Neo4j: `MATCH (e:CalendarEvent {id: "opening-keynote"}) RETURN e.started`.

## Known pending items

- **Step 3 / `activate` and `deactivate` commands**: The coffee-tile activation commands (`activate lobby-coffee`, `deactivate lobby-coffee`) are registered as stubs returning `CommandNotYetImplemented` — logged at warn level, scheduler continues. These will be wired to actual world-object state when RFC-0006 is implemented.
- **Step 4 / Neo4j idempotency**: The fired-event idempotency check via Neo4j (Steps 4 and 6 in the RFC demo) requires a live Neo4j connection (`NEO4J_URI`). In local development without Neo4j, the in-memory state prevents re-firing within a single process lifetime, but the cross-restart guarantee requires the database. See plan.md Phase F for the integration test coverage gap documentation.

## Running tests

```bash
pnpm test --filter @aie-matrix/world-api
# or from server/world-api/:
pnpm test
```

Calendar-specific tests are in:
- `server/world-api/src/calendar/parse-calendar-gram.test.ts`
- `server/world-api/src/calendar/WorldCalendarService.test.ts`
