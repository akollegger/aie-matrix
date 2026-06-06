# Contract: Leaderboard Gram Block Syntax

**Feature**: 026-session-leaderboards  
**Applies to**: `.map.gram` files in `maps/`

## Block Declaration

```gram
[leaderboards:Leaderboards |
  (leaderboardId:Leaderboard {
    title: "...",
    description: "...",
    resource: "gold" | "eval-token" | "*" | ...,
    aggregation: "sum" | "count" | "max",
    direction: "received" | "distributed" | "net",
    actorKind: "ghost" | "group" | "any",
    cause: "..."    // optional
  }),
  ...
]
```

## Rules

- Block label: `leaderboards`, node type: `Leaderboards`.
- Each inner node is labeled `:Leaderboard`.
- Node identifier (e.g. `top-distributors`) is the stable `id` used in MCP tool calls and snapshot storage.
- `cause` is optional; omit the property entirely when no cause filter is needed.
- Block is optional. A map with no `[leaderboards:Leaderboards | ...]` block produces an empty leaderboard list; no defaults are injected.
- Multiple leaderboards are comma-separated within the block, following the same pattern as `[schedule:Schedule | ...]` event nodes.

## Parsing Locations

| Location | Purpose |
|---|---|
| `server/world-api/src/` (new file `parse-leaderboard-gram.ts`) | Server-side: extract `LeaderboardSpec[]` at session load time |
| `tools/map-editor/src/io/import-gram.ts` | Client-side: extract specs for read-only display in `DetailPanel` |

## Example

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
