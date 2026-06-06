# Research: Session Leaderboards

**Feature**: 026-session-leaderboards  
**Date**: 2026-06-06

## Resolved Questions

### 1. Effect Service Layer Pattern

**Decision**: Follow the three-file `GroupService` / `GroupServiceLive` / `GroupServiceInMemory` pattern exactly.

**Rationale**: All recent services (`EvalContractService`, `GroupService`, `LedgerService`) use this split. It keeps the Neo4j dependency out of unit tests and allows the same interface to be wired via `Layer.provide` in production vs. tests.

**Key pattern**:
```typescript
// LeaderboardService.ts
export class LeaderboardService extends Context.Tag("aie-matrix/LeaderboardService")<
  LeaderboardService,
  LeaderboardServiceOps
>() {}

// LeaderboardServiceLive.ts
export const makeLeaderboardServiceLiveLayer = (driver: Driver): Layer.Layer<
  LeaderboardService,
  never,
  WorldCalendarService | WorldBridgeService
> => Layer.scoped(LeaderboardService, Effect.gen(function* () { ... }))
```

---

### 2. TTL Cache Strategy

**Decision**: In-memory `Map<leaderboardId, { result: LeaderboardResult; computedAt: number }>` checked on each read call. Recompute when `Date.now() - computedAt > ttlMs`. TTL read from environment variable `LEADERBOARD_TTL_MS` (default `30_000`).

**Rationale**: Same pattern as `CALENDAR_TICK_MS`. No background fiber needed — lazy recompute on read is simpler and avoids stale push when no spectators are polling. The `world.leaderboard.updated` A2A event is only emitted when rankings actually change after a recompute, so spectators receive push only on meaningful updates.

**Alternatives considered**: Background TTL fiber (like group vote-window cleanup) — rejected as unnecessary overhead for a read-only cache that can be lazily refreshed.

---

### 3. Neo4j Cypher Aggregate Query

**Decision**: Use a parameterized Cypher query pattern per leaderboard spec. Core query shape:

```cypher
MATCH (session:Session {sessionId: $sessionId})<-[:IN_SESSION]-(entry:LedgerEntry)
WHERE ($resource = '*' OR entry.resource = $resource)
  AND ($cause IS NULL OR entry.cause = $cause)
WITH entry.actorId AS actorId, 
     entry.actorKind AS actorKind,
     SUM(CASE WHEN $aggregation = 'sum' AND $direction = 'received' THEN entry.amount ELSE 0 END) AS score,
     MAX(entry.recordedAt) AS lastContributing
WHERE ($actorKind = 'any' OR actorKind = $actorKind)
RETURN actorId, score, lastContributing
ORDER BY score DESC, lastContributing ASC
```

**Rationale**: Parameterized by the `LeaderboardSpec` fields; avoids string interpolation (no injection risk); `lastContributing` is the tie-breaker as specified in RFC-0025 §Open Questions item 3.

---

### 4. LeaderboardSnapshot Persistence

**Decision**: Store as `(:LeaderboardSnapshot)` nodes linked to session via `[:SNAPSHOT_OF]` edges. Properties: `leaderboardId`, `sessionId`, `computedAt`, `isFinal: true`, `entries` (JSON string).

**Rationale**: Consistent with all other durable session artifacts (LedgerEntry, CalendarEvent, Group). Subsequent queries after finalization return the snapshot directly without recomputing.

---

### 5. `world.leaderboard.updated` A2A Event

**Decision**: Extend `WorldEventKind` in `shared/types/src/` (the type is re-exported from `ghosts/funder-agent/src/world-event.ts` but the canonical definition should move to `shared/types/`). Add `"world.leaderboard.updated"` as a new kind. Payload: `LeaderboardResult`.

**Rationale**: Follows the existing `WorldEvent` envelope pattern. Intermedium is already subscribed to A2A events; no new subscription infrastructure needed.

---

### 6. Gram Block Parsing

**Decision**: Parse `[leaderboards:Leaderboards | (id:Leaderboard { ... }), ...]` in the existing `parse-calendar-gram.ts` pattern (server side) and in `import-gram.ts` (map-editor side). Block is optional — absent block → empty leaderboard list.

**Rationale**: The schedule block is already parsed server-side from gram. Leaderboard parsing follows the same pattern. Map-editor needs to display definitions but not execute queries.

---

### 7. MCP Tool Access Control

**Decision**: `leaderboards()` and `leaderboard { id }` require no authentication — use the existing unauthenticated tool path in `mcp-server.ts`. `finalize-leaderboards` uses the same `requireRole(["scheduler", "admin"])` guard already present for `announce`.

**Rationale**: RFC-0025 §3 and §4 are explicit. Leaderboard data is public; finalization is privileged. No new auth infrastructure.

---

### 8. Intermedium Panel Integration

**Decision**: Add `LeaderboardPanel` as a new collapsible sidebar component in Intermedium, shown at Global and Regional camera stops. Subscribe to `world.leaderboard.updated` A2A events via a new `useLeaderboard` hook. When `isFinal: true` arrives, render "Session Complete" badge and stop accepting updates.

**Rationale**: Existing `PanelView` components (`PersonalPanel`, `AreaPanel`, etc.) define the pattern. A collapsible sidebar is already the established UI paradigm for spectator data.

---

### 9. Map Editor Display

**Decision**: Parse the `[leaderboards:Leaderboards | ...]` block in `import-gram.ts` alongside the existing rules block (lines 157–166). Add `leaderboards: LeaderboardSpec[]` to `MapGram` types. Render each spec as a read-only card in `DetailPanel` — no editor controls needed for MVP.

**Rationale**: Rules block is already parsed but not editable in the UI. Leaderboard definitions follow the same read-only display pattern.
