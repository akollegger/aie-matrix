# RFC-0025: Session Leaderboards

**Status:** under review  
**Date:** 2026-06-06  
**Authors:** @akollegger  
**Related:** [RFC-0021](0021-world-calendar.md) (World Calendar — game-end via calendar event), [RFC-0022](0022-eval-contract-protocol.md) (Eval Contract Protocol — graded completions as ledger entries), [RFC-0023](0023-in-world-resource-ledger.md) (In-World Resource Ledger — authoritative source for all rankings), [RFC-0024](0024-group-formation-and-chat.md) (Group Formation — group bag as rankable actor), [RFC-0007](0007-agent-host-architecture.md) (Agent Host Architecture — needs update for card/instance name model; dependency for full display name support)

## Summary

Introduce session leaderboards as a spectator-facing, read-only view computed from the world ledger. A map declares which leaderboards are in play — each one a named aggregate query over ledger entries — and the world computes rankings on demand. Ghosts have no leaderboard-facing API; instead, the map's ghost system prompt instructs agents to maximize a measurable ledger quantity (e.g. "distribute as many tokens as possible before the session ends"). The leaderboard reflects what happened; it does not participate in agent decision-making. Game-end is signaled by a calendar `CalendarEvent`, which the leaderboard observes passively to emit a final frozen snapshot.

---

## Motivation

The world now has all the primitives needed to make ghost behavior competitive and observable:

- Every resource movement, eval completion, and group transaction is a ledger entry (RFC-0023).
- The calendar can fire a terminal event at a known time (RFC-0021).
- Ghosts are autonomous agents instructed via system prompt.

What is missing is a way to surface "who is winning" to human spectators without baking a specific scoring model into the world engine. The leaderboard fills that gap. It is a **read model** — a live aggregation over ledger history — not a new write path.

The design constraint is strict content/mechanism separation: the *mechanism* knows how to aggregate ledger entries by actor and rank the results; the *map* decides which aggregations are meaningful. The world engine ships no hardcoded leaderboards; a map with no leaderboard declarations simply has none.

A secondary constraint is agent motivation. Ghosts do not need meta-awareness of standings to compete. A ghost instructed to "maximize distributed tokens" will optimize the behavior that the leaderboard captures, without ever consulting the leaderboard itself. This keeps ghost system prompts grounded in action rather than rank.

---

## Design

### 1. Leaderboard as a Named Aggregate Query

A leaderboard is a named query over `(:LedgerEntry)` nodes in the session subgraph, parameterized by:

| Parameter | Description | Examples |
|---|---|---|
| `resource` | The resource type to aggregate (or `*` for any) | `"gold"`, `"eval-token"`, `*` |
| `aggregation` | How to reduce movements | `"sum"`, `"count"`, `"max"` |
| `direction` | Which side of movements to count | `"received"`, `"distributed"`, `"net"` |
| `actorKind` | Filter to a class of actors | `"ghost"`, `"group"`, `"any"` |
| `cause` | Optional filter on movement cause | `"eval.completion"`, `"trade"` |

These parameters are sufficient to reconstruct all obvious rankings from existing ledger data:

- **Most resources accumulated** → `{ resource: "gold", aggregation: "sum", direction: "received" }`
- **Most resources distributed** → `{ resource: "gold", aggregation: "sum", direction: "distributed" }`
- **Best eval completions (by count)** → `{ resource: "eval-token", aggregation: "count", direction: "received", cause: "eval.completion" }`
- **Most group activity** → `{ resource: "*", aggregation: "count", actorKind: "group" }`

The query runs against the live ledger and is always current. No separate counter or denormalized state is maintained.

### 2. Map Declaration

Leaderboards are declared in the `.map.gram` file as a `[leaderboards:Leaderboards | ...]` block, following the same pattern as `[rules:Rules | ...]` and `[schedule:Schedule | ...]`:

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
  }),
  (group-standings:Leaderboard {
    title: "Group Standings",
    description: "Groups ranked by total resources held at session end.",
    resource: "*",
    aggregation: "sum",
    direction: "net",
    actorKind: "group"
  })
]
```

The node identifier (e.g. `top-distributors`) is the stable key used in queries and snapshots. A map with no `[leaderboards:Leaderboards | ...]` block simply has no leaderboards. No default leaderboards are injected by the engine.

### 3. LeaderboardService

A `LeaderboardService` in `server/world-api` manages the declared leaderboards for the active session.

A leaderboard query result must carry: the leaderboard identity and description, an ordered list of entries (each with actor identity, display name, and numeric score), the time the result was computed, and a flag indicating whether the result is the final frozen snapshot. Field naming is left to the implementer.

**Query path:** The service runs a Cypher aggregate for a leaderboard's parameters against `(:LedgerEntry)` nodes in `LIVE_SESSION_ID`'s subgraph and returns a ranked list. Results are not cached between requests; freshness is the point.

**Game-end:** When the `WorldCalendarService` fires a calendar event with `kind: "game-end"`, `LeaderboardService` computes all leaderboards one final time, stores the snapshots as Neo4j nodes (`:LeaderboardSnapshot`), and marks them `isFinal: true`. Subsequent queries return the frozen snapshot rather than recomputing. This decouples the leaderboard from the timing mechanism — the calendar fires a command (`"finalize-leaderboards"`), the same command executor path used by all other calendar events.

### 4. MCP Surface (Role-Based Access)

Leaderboards are exposed via MCP tools, consistent with all other game session APIs. Read tools are public — no authentication required, consistent with Intermedium's unauthenticated deployment. `finalize-leaderboards` is restricted to the `scheduler` and `admin` roles, identical to `announce`.

```
leaderboards()
  → [{ id, title, description }]           // declared leaderboards for active session

leaderboard { id: string }
  → LeaderboardResult                       // live rankings (or frozen snapshot if final)
```

Intermedium (`matrix.neo4j.gg`) calls these tools to populate the leaderboard overlay. The map editor / admin UI (`admin.neo4j.gg`) uses the same tools for definition display.

### 5. Ghost Motivation: System Prompt, Not Standings

Ghosts are not told about leaderboards. The map author writes ghost system prompt instructions that name the behavior the leaderboard captures:

> *"You are participating in a session where every token you distribute is recorded. Your goal is to distribute as many tokens as possible before the session ends. Use `timecheck` to monitor how much time remains."*

This is a map content decision — the world engine imposes no standard ghost motivation. The leaderboard is a consequence of what ghosts do, not a goal they pursue directly.

### 6. Calendar Integration

The game-end signal is a standard calendar event with `kind: "game-end"`. No special leaderboard-specific event type is needed:

```gram
(session-end:Event {
  title: "Session End",
  kind: "game-end",
  startsAt: "17:00:00",
  duration: 0,
  enterCommands: ["finalize-leaderboards"],
  exitCommands: []
})
```

The `finalize-leaderboards` command is the only new command required. It is a privileged system command (scheduler and admin contexts only), consistent with `announce`. `kind: "game-end"` is a map-author convention; the scheduler treats it identically to any other event kind and fires `enterCommands` without special behavior.

Warm-up signals ("30 minutes remaining") are `announce` commands on preceding point events — a map design decision, not a leaderboard concern.

### 7. Intermedium Leaderboard UI

Leaderboards are spectator data and belong in the Intermedium (RFC-0008) as an overlay panel, visible at the **Global** and **Regional** camera stops where fleet-level behavior is most legible.

**Panel layout:** A collapsible sidebar or HUD overlay lists each declared leaderboard as a ranked table — rank, ghost display name, and score. When multiple leaderboards are declared, tabs or a carousel switches between them. The panel updates on receipt of `world.leaderboard.updated` A2A events; once `isFinal: true` arrives, the panel transitions to a frozen "Session Complete" state with a visual indicator.

**Visual treatment:** The leaderboard panel follows the existing ghost-world aesthetic (wireframe, dark background, minimal chrome). Ghost display names link to that ghost's Personal camera stop for drill-down. No chart or animation is required for MVP — a ranked list is sufficient.

**Game-end state:** When the final snapshot arrives, the panel transitions to a "Session Complete" state showing the frozen rankings. This is a passive transition — no modal or interruption.

### 8. Map Editor / Admin UI

The map editor (RFC-0010) and admin panel should display the leaderboard definitions declared in the loaded map, similar to how rules are currently shown — read-only at MVP, with authoring support as a follow-on.

The editor parses the `[leaderboards:Leaderboards | ...]` block from the `.map.gram` file and renders each `Leaderboard` node as a card showing its `title`, `description`, and the query parameters (`resource`, `aggregation`, `direction`, `actorKind`, `cause`). No live data is shown in the editor — definitions only.

This is the same pattern as rule display: the editor shows what the map declares; it does not execute queries or connect to a live session.

### 9. Package Ownership

| Package | Responsibility |
|---|---|
| `server/world-api/src/LeaderboardService.ts` | Aggregate queries, snapshot persistence, `finalize-leaderboards` command handler |
| `server/world-api/src/mcp-server.ts` | `leaderboards` and `leaderboard` MCP tools; role-based access guard |
| `shared/types/` | `LeaderboardSpec`, `LeaderboardEntry`, `LeaderboardResult` types |
| `clients/intermedium/` | Leaderboard overlay panel; A2A subscriber for `world.leaderboard.updated`; "Session Complete" final state |
| `clients/map-editor/` | Leaderboard definition display (parse `[leaderboards:Leaderboards | ...]`, render as cards) |
| `maps/<scene>/<scene>.map.gram` | `[leaderboards:Leaderboards | ...]` declarations; ghost system prompt motivation |

---

## Demo Scenario

A contributor can verify the full mechanic end-to-end in roughly fifteen minutes:

1. Load a map with a `[leaderboards:Leaderboards | ...]` block declaring one `top-distributors` leaderboard (resource: `"gold"`, aggregation: `"sum"`, direction: `"distributed"`). Connect as a spectator and call `leaderboards()` → observe the leaderboard listed with its `title` and `description`. No entries yet.
2. Have two ghosts receive different amounts of gold from the world bag via a server-side reward transaction. Call `leaderboard { id: "top-distributors" }` → observe a ranked list with the higher-distributing ghost in first place and correct scores.
3. Fire the `finalize-leaderboards` command (as scheduler or admin). Call `leaderboard { id: "top-distributors" }` → observe `isFinal: true` and identical rankings. Call it again → same frozen result; no recomputation.
4. Attempt to call `leaderboard { id: "top-distributors" }` as a ghost role → observe access denied.
5. Load a map with no `[leaderboards:Leaderboards | ...]` block. Call `leaderboards()` → observe an empty list. No default leaderboards are injected.

---

## Open Questions

1. ~~**Snapshot storage.**~~ **Resolved:** Final snapshots are stored as Neo4j `(:LeaderboardSnapshot)` nodes linked to the session subgraph, consistent with all other durable session artifacts (ledger entries, calendar events, groups).

2. ~~**Display names.**~~ **Resolved:** `displayName` is the ghost's instance name, stored on the `(:Ghost)` node in Neo4j and set at adoption time. When no instance name is present, `displayName` falls back to the ghost's id. The instance naming model (A2A card as "surname", per-adoption "first name") is not yet specified — RFC-0007 (Agent Host Architecture) and IC-001 (agent card `matrix` block) need updating to define it. Those RFCs are a dependency of this one for full display name support; the fallback to ghost id is sufficient for MVP.

3. ~~**Tie-breaking.**~~ **Resolved:** Ties are broken by earliest achievement — secondary sort on the timestamp of the actor's last contributing ledger entry. The actor who reached the score first ranks higher.

4. ~~**Aggregation at scale.**~~ **Resolved:** The service caches the last computed result and recomputes on a configurable TTL rather than on every request or every ledger write. The TTL is a deployment tunable (environment variable, same pattern as `CALENDAR_TICK_MS`). This keeps the write path simple while bounding query frequency at conference scale.

5. ~~**Multi-leaderboard composite score.**~~ **Resolved:** Composite ranking is computed client-side by the spectator dashboard from individual leaderboard results. The engine has no composite concept. Weights are a design judgment best left to the dashboard, where they can be adjusted without a server deploy.

6. ~~**Leaderboard visibility before session start.**~~ **Resolved:** `leaderboard { id }` always returns the spec (title, description, parameters); `entries` is an empty list when no session is active. No error for pre-session access. This allows the map editor to validate declarations without a live session.

7. ~~**`spectator` role definition.**~~ **Resolved:** `leaderboards()` and `leaderboard { id }` require no authentication — leaderboard data is public, consistent with Intermedium's unauthenticated deployment at `matrix.neo4j.gg`. `finalize-leaderboards` remains scheduler/admin only. Full IAM model (covering `admin.neo4j.gg` and `api.neo4j.gg`) is outstanding work outside the scope of this RFC.

9. ~~**Stale domain references in `docs/architecture.md`.**~~ **Resolved:** `docs/architecture.md` and RFC-0014 have been updated to use `matrix.neo4j.gg` and `admin.neo4j.gg`.

8. ~~**Intermedium access to leaderboard data.**~~ **Resolved:** `LeaderboardService` emits a `world.leaderboard.updated` A2A event after each TTL recompute when rankings have changed, and once more with `isFinal: true` on finalization. Intermedium receives updates as an existing A2A subscriber — no Colyseus schema change, no client polling loop. The event shape follows the existing `WorldEventKind` pattern (see RFC-0021 `world.announcement` addendum).

---

## Alternatives

**Per-mechanic leaderboards baked into the engine.** Ship specific leaderboards for evals, resources, and groups as hardcoded views. Simpler to implement but couples content to mechanism — a map that uses none of these mechanics still has them. Rejected in favor of map-declared queries.

**Agent-visible standings (`/me/standing`).** Expose each ghost's current rank via MCP so agents can reason about their position and adapt strategy. Adds agent motivation complexity (agents optimizing rank rather than behavior) and creates a feedback loop that may produce degenerate strategies (all agents do the same thing). Rejected; ghosts optimize behavior, spectators observe rank.

**Leaderboard as a Colyseus schema (real-time push).** Broadcast rankings via Colyseus so spectator clients receive live updates. Rejected — adds Colyseus schema complexity without benefit; A2A notification (`world.leaderboard.updated`) already provides push delivery to all subscribers including Intermedium. The MCP read tools (`leaderboards`, `leaderboard`) remain available for on-demand access (e.g. map editor pre-session validation) but are not the live-update path.

**Composite score as a world primitive.** Define a single "winning score" formula in the map and expose it as the primary leaderboard. Cleaner for ghosts ("maximize your score") but premature — the right weighting is unknown until the map is played. Leaderboards-as-separate-dimensions let spectators and post-game analysis determine what mattered.
