# Contract: Leaderboard MCP Tools

**Feature**: 026-session-leaderboards  
**Package**: `server/world-api`  
**Access**: Unauthenticated (reads); scheduler/admin role (finalize)

## Tool: `leaderboards`

Returns all leaderboards declared for the active session.

**Input**: none

**Output**:
```typescript
Array<{
  id: string;       // stable gram node identifier
  title: string;
  description: string;
}>
```

**Behavior**:
- Returns an empty array when no session is active or the map has no leaderboard declarations.
- Never errors for missing session — returns `[]`.

---

## Tool: `leaderboard`

Returns ranked entries for one named leaderboard.

**Input**:
```typescript
{ id: string }
```

**Output**: `LeaderboardResult`
```typescript
{
  id: string;
  title: string;
  description: string;
  entries: Array<{
    actorId: string;
    displayName: string;
    score: number;
    lastContributingAt: string; // ISO
  }>;
  computedAt: string; // ISO
  isFinal: boolean;
}
```

**Behavior**:
- Returns spec fields + empty `entries` array when leaderboard exists but has no qualifying ledger entries.
- Returns a `LeaderboardNotFound` error when `id` does not match any declared leaderboard.
- Returns frozen snapshot when `isFinal: true`; no recomputation.
- Live rankings are TTL-cached server-side; spectators always receive the current cache slot.

---

## Command: `finalize-leaderboards`

Freezes all declared leaderboards into permanent snapshots.

**Access**: `scheduler` and `admin` roles only (same guard as `announce`).

**Input**: none (command dispatched via `CalendarCommandDispatcher`)

**Behavior**:
- Computes final rankings for all declared leaderboards.
- Persists `(:LeaderboardSnapshot)` nodes to Neo4j.
- Marks all results `isFinal: true`.
- Emits `world.leaderboard.updated` A2A event with `isFinal: true` for each leaderboard.
- Idempotent — calling again after finalization is a no-op.
- Unauthorized callers receive an `AuthorizationError`.

---

## Downstream Consumers

| Consumer | Usage |
|---|---|
| `clients/intermedium` | Calls `leaderboard { id }` on A2A push; displays rankings panel |
| `tools/map-editor` | Calls `leaderboards()` to validate declarations pre-session (no live data needed) |
| Calendar scheduler | Fires `finalize-leaderboards` via `enterCommands` on `game-end` event |
