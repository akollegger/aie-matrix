# Contract: world.leaderboard.updated A2A Event

**Feature**: 026-session-leaderboards  
**Type**: A2A push event  
**Direction**: `server/world-api` → subscribers (including `clients/intermedium`)

## Event Envelope

Follows the existing `WorldEvent` shape in `shared/types/src/`:

```typescript
{
  schema: "aie-matrix.world-event.v1";
  kind: "world.leaderboard.updated";  // new WorldEventKind value
  payload: LeaderboardResult;          // see data-model.md
  ghostId: string;                     // world system actor id
  eventId: string;                     // ULID
  sentAt: string;                      // ISO timestamp
}
```

## Emission Conditions

1. **Live recompute**: Emitted after a TTL-triggered recompute **only when the ranking order or any score has changed** from the previous cached result. Avoids redundant pushes when the session is idle.
2. **Finalization**: Emitted once per leaderboard immediately after `finalize-leaderboards` completes, with `payload.isFinal: true`. This is the signal for Intermedium to transition to "Session Complete" state.

## Intermedium Subscription

`useLeaderboard` hook in `clients/intermedium/src/hooks/useLeaderboard.ts`:
- Subscribes to A2A event stream for `kind === "world.leaderboard.updated"`.
- Updates local `Map<leaderboardId, LeaderboardResult>` state on each event.
- When `event.payload.isFinal === true`, sets a `sessionComplete` flag that transitions the panel to frozen state.
- No polling fallback needed — MCP `leaderboard { id }` is available for on-demand access (e.g. initial page load before first push arrives).

## Extending WorldEventKind

Add `"world.leaderboard.updated"` to the `WorldEventKind` union in `shared/types/src/` (currently defined in `ghosts/funder-agent/src/world-event.ts` — migrate canonical definition to `shared/types/src/world-event.ts` or extend the union there).

**Downstream impact**: `agent-host/src/colyseus-bridge/translate-world-v1.ts` lookup table must include the new kind. Existing subscribers that don't handle `"world.leaderboard.updated"` will receive it and can safely ignore it.
