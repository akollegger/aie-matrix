# Data Model: Session Leaderboards

**Feature**: 026-session-leaderboards  
**Date**: 2026-06-06

## Shared Types (`shared/types/src/leaderboard.ts`)

### LeaderboardSpec

Declared in the map; defines one named query.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable key from the gram node identifier (e.g. `"top-distributors"`) |
| `title` | `string` | Human-readable display name |
| `description` | `string` | One-line explanation shown to spectators |
| `resource` | `string` | Resource type to aggregate; `"*"` matches any resource |
| `aggregation` | `"sum" \| "count" \| "max"` | Reduction function |
| `direction` | `"received" \| "distributed" \| "net"` | Which side of movements to count |
| `actorKind` | `"ghost" \| "group" \| "any"` | Filter to a class of actors |
| `cause` | `string \| undefined` | Optional filter on movement cause (e.g. `"eval.completion"`) |

### LeaderboardEntry

One row in a ranked result.

| Field | Type | Description |
|---|---|---|
| `actorId` | `string` | Ghost id or group id |
| `displayName` | `string` | Ghost instance name if set; fallback to `actorId` |
| `score` | `number` | Aggregate value |
| `lastContributingAt` | `string` | ISO timestamp of actor's last qualifying ledger entry (used for tie-breaking) |

### LeaderboardResult

Full result of one leaderboard query.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Leaderboard id from spec |
| `title` | `string` | Leaderboard title from spec |
| `description` | `string` | Leaderboard description from spec |
| `entries` | `LeaderboardEntry[]` | Ranked entries (descending by score, then ascending by `lastContributingAt`) |
| `computedAt` | `string` | ISO timestamp when this result was computed |
| `isFinal` | `boolean` | `true` once `finalize-leaderboards` has run |

---

## Neo4j Graph Model

### New node: `(:LeaderboardSnapshot)`

Persisted when `finalize-leaderboards` fires. One node per leaderboard per session.

| Property | Type | Description |
|---|---|---|
| `snapshotId` | `string` (ULID) | Unique identifier |
| `sessionId` | `string` | The session this snapshot belongs to |
| `leaderboardId` | `string` | Which leaderboard |
| `computedAt` | `string` | ISO timestamp |
| `isFinal` | `true` | Always `true` for persisted snapshots |
| `entriesJson` | `string` | JSON-serialized `LeaderboardEntry[]` |

### New relationship: `(:LeaderboardSnapshot)-[:SNAPSHOT_OF]->(:Session)`

Links each snapshot to its session subgraph. Consistent with how `(:LedgerEntry)-[:IN_SESSION]->(:Session)` and `(:Group)-[:PARTICIPANT_IN]->(:Session)` are structured.

---

## In-Memory Cache

`LeaderboardService` maintains:

```typescript
type CacheEntry = {
  result: LeaderboardResult;
  computedAt: number; // Date.now()
}

private cache: Map<string, CacheEntry> // keyed by leaderboardId
private isFinal: boolean
private finalSnapshots: Map<string, LeaderboardResult> // keyed by leaderboardId
```

- On each `getLeaderboard(id)` call:
  1. If `isFinal`, return `finalSnapshots.get(id)`
  2. If cache entry exists and `Date.now() - computedAt < ttlMs`, return cached result
  3. Otherwise recompute from Neo4j, update cache, emit `world.leaderboard.updated` A2A event if rankings changed
- On `finalizeLeaderboards()`:
  1. Recompute all leaderboards
  2. Persist `(:LeaderboardSnapshot)` nodes to Neo4j
  3. Populate `finalSnapshots`
  4. Set `isFinal = true`
  5. Emit `world.leaderboard.updated` with `isFinal: true` for each leaderboard

---

## Gram Syntax

Declared in `.map.gram` as a block following the schedule block pattern:

```gram
[leaderboards:Leaderboards |
  (top-distributors:Leaderboard {
    title: "Top Distributors",
    description: "Ghosts who distributed the most gold during the session.",
    resource: "gold",
    aggregation: "sum",
    direction: "distributed",
    actorKind: "ghost"
  }),
  (eval-champions:Leaderboard {
    title: "Eval Champions",
    description: "Ghosts with the most successfully graded eval completions.",
    resource: "eval-token",
    aggregation: "count",
    direction: "received",
    cause: "eval.completion",
    actorKind: "ghost"
  })
]
```

Parsed server-side alongside `parse-calendar-gram.ts`; parsed client-side in `import-gram.ts` for map-editor display. Absent block → empty `LeaderboardSpec[]`.
