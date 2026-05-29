# IC-CAL-002: Calendar Gram Format Contract

**Consumers**: World authors, `WorldCalendarService` parser, map editor tooling
**Owner**: `server/world-api` — `calendar/parse-calendar-gram.ts`

## Standalone file: `.calendar.gram`

A flat sequence of `CalendarEvent` nodes, one per event, no enclosing wrapper:

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
  description: "Coffee and networking in the main lobby.",
  kind: "break",
  startsAt: "2026-06-05T10:00:00-07:00",
  duration: 30,
  location: "lobby-coffee",
  enterCommands: ["activate lobby-coffee"],
  exitCommands: ["deactivate lobby-coffee"]
})

(booth-12-raffle:CalendarEvent {
  title: "Vendor Raffle — Booth 12",
  description: "End-of-day raffle. Must be present to win.",
  kind: "raffle",
  startsAt: "2026-06-05T17:00:00-07:00",
  duration: 0,
  location: "vendor-booth-12",
  enterCommands: ["raffle vendor-booth-12"],
  exitCommands: []
})
```

## Embedded in `.map.gram`

An anonymous `Calendar`-labeled block, analogous to `[rules:Rules | ...]`:

```gram
[:Calendar |
  (opening-keynote:CalendarEvent { ... })
  (morning-break:CalendarEvent { ... })
]
```

The standalone and embedded representations are equivalent. The parser produces identical `CalendarEvent[]` output from either source.

## Required properties

All properties are required unless marked optional:

| Property | Gram type | Notes |
|---|---|---|
| node identifier | bare identifier | Stable key; must be unique within the file |
| `title` | string | |
| `description` | string | |
| `kind` | string | Must be one of `session`, `break`, `raffle`, `custom` |
| `startsAt` | string | ISO 8601 with UTC offset |
| `duration` | integer | Minutes; 0 for point events; must be ≥ 0 |
| `location` | string | Optional; polygon node identifier |
| `enterCommands` | string[] | Required; empty array `[]` is valid |
| `exitCommands` | string[] | Required; empty array `[]` is valid |

## Parse error behavior

The parser MUST reject and return an error (not silently skip) for:
- Missing required properties
- `duration < 0`
- Invalid ISO 8601 in `startsAt`
- Duplicate node identifiers within the same file

Server startup MUST fail with a descriptive error message including the file path and the specific violation when the calendar file cannot be fully parsed.
