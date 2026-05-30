# IC-CAL-003: SchedulerContext and CalendarCommandDispatcher Contract

**Consumers**: `WorldCalendarService`, future admin console, any elevated caller
**Owner**: `shared/types` (SchedulerContext type); `server/world-api/src/calendar/` (dispatcher)

## SchedulerContext

A caller identity used when dispatching commands without a ghost actor:

```typescript
// shared/types/src/scheduler-context.ts
class SchedulerContext extends Data.TaggedClass("SchedulerContext")<{
  readonly role: "system"
}> {}
// No h3Index — movement commands fail with NoActorOrigin
```

Defined in `shared/types/src/scheduler-context.ts`, re-exported from `shared/types/src/index.ts`. Kept separate from `time.ts` so each file has a single concern. The `CalendarCommandDispatcher` and any future elevated callers (admin console) accept `SchedulerContext` as a valid caller identity.

## CalendarCommandDispatcher

A narrow command dispatch surface for calendar-eligible commands. Only commands that make semantic sense without a positioned actor are registered:

| Command string | Effect invoked | Notes |
|---|---|---|
| `claim <roomId> <ghostId>` | speaker claim logic | Fails with `ClaimRule` rejection if ghost not in room |
| `yield <roomId>` | speaker yield logic | |
| `activate <locationId>` | tile/polygon activation | Requires RFC-0006 `activate` command to exist |
| `deactivate <locationId>` | tile/polygon deactivation | |
| `raffle <boothId>` | raffle selection logic | |

Commands not in this table return `UNKNOWN_CALENDAR_COMMAND`. Movement commands (`go`, `traverse`) are not registered; if they appear in `enterCommands` or `exitCommands`, the dispatcher returns `NO_ACTOR_ORIGIN` and logs a warning.

## Error types

```typescript
class NoActorOrigin extends Data.TaggedError("NoActorOrigin")<{
  command: string
}> {}

class UnknownCalendarCommand extends Data.TaggedError("UnknownCalendarCommand")<{
  command: string
}> {}
```

`NoActorOrigin` — returned when a command requires a positioned actor but `SchedulerContext` provides none (e.g. `go n`). `UnknownCalendarCommand` — returned when the command string is not registered in the dispatcher. Both are logged at warn level by the scheduler fiber and do not propagate as failures — the scheduler continues to the next command.
