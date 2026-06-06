# `@aie-matrix/shared-types`

Shared contracts consumed across the monorepo: MCP payloads, registry payloads, compass types, conversation notifications, and world item definitions.

## World item exports

The world-items feature adds these shared exports:

- `ItemDefinition`
- `ItemSidecar`
- `TileItemSummary`
- `InspectArgs`, `InspectResult`
- `TakeArgs`, `TakeResult`
- `DropArgs`, `DropResult`
- `InventoryResult`

`TileInspectResult` always includes an `objects` field (`TileItemSummary[]`, possibly empty) in `look` responses.

## Leaderboard exports

The session-leaderboards feature (RFC-0025) adds these shared exports:

- `LeaderboardSpec` — map-declared leaderboard configuration (resource, aggregation, direction, actorKind, optional cause)
- `LeaderboardEntry` — one ranked row (actorId, displayName, score, lastContributingAt)
- `LeaderboardResult` — full ranked result with `isFinal` flag and computation timestamp
