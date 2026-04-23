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
