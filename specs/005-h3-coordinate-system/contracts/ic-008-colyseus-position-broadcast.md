# IC-008: Colyseus Ghost Position Broadcast

**Contract ID**: IC-008  
**Feature**: 005-h3-coordinate-system  
**Status**: Draft  
**Consumers**: `client/phaser` (existing), `client/map-overlay` (new)

---

## Summary

The Colyseus `WorldSpectatorState.ghostTiles` schema value format changes from `"col,row"` strings to H3 res-15 index strings. The `tileCoords` map is retained for backward compatibility with the Phaser client.

---

## Schema (unchanged field names, changed value semantics)

```typescript
// server/colyseus/src/room-schema.ts

export class WorldSpectatorState extends Schema {
  @type({ map: "string" })
  declare ghostTiles: MapSchema<string>;
  // key: ghostId (UUID)
  // value: H3 res-15 index string  ← CHANGED from "col,row"

  @type({ map: TileCoord })
  declare tileCoords: MapSchema<TileCoord>;
  // key: h3Index  ← CHANGED from "col,row" tileId
  // value: { col: number, row: number }  ← unchanged (populated from CellRecord)

  @type({ map: "string" })
  declare tileClasses: MapSchema<string>;
  // key: h3Index  ← CHANGED from "col,row" tileId
  // value: tileClass string  ← unchanged
}
```

---

## Value Format Change

| Field | Before | After |
|---|---|---|
| `ghostTiles[ghostId]` | `"5,3"` | `"8f2830828052d25"` |
| `tileCoords` keys | `"5,3"` | `"8f2830828052d25"` |
| `tileClasses` keys | `"5,3"` | `"8f2830828052d25"` |

---

## Phaser Client Compatibility

The Phaser client (`client/phaser`) reads `ghostTiles` to get ghost positions, then looks up `tileCoords[tileId]` for col/row rendering coordinates. After this change:

1. `ghostTiles[ghostId]` now yields an H3 index string.
2. The Phaser client must use that H3 index string as the key into `tileCoords` to get `{ col, row }`.
3. The `tileCoords` map is still populated by the server from `CellRecord.col` and `CellRecord.row`, so the Phaser rendering pipeline continues to work without a Phaser client update.

**Required Phaser client change**: Update the key lookup from `state.tileCoords.get(tileId)` to `state.tileCoords.get(ghostTiles.get(ghostId))` — a one-line change if the Phaser client was using the tileId directly.

---

## Map Overlay Client

The `client/map-overlay` package:
1. Subscribes to Colyseus `ghostTiles` patch events.
2. For each `ghostId → h3Index` pair, calls `h3.cellToLatLng(h3Index)` to get lat/lng.
3. Renders a ghost marker at that lat/lng on the real-world map.
4. On `ghostTiles` patch (position change), updates the marker position.

No dependency on `tileCoords` or `tileClasses` — the overlay client works entirely from H3 indices.
