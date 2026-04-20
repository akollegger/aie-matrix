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

The Phaser spectator (`client/phaser/src/scenes/SpectatorView.ts`) already iterates `ghostTiles` and uses each value as the key into `tileCoords` (`tileCoords.get(tileId)` where `tileId` comes from the `ghostTiles` entry). After this change, those values are H3 res-15 strings instead of `"col,row"`, and the server keys `tileCoords` / `tileClasses` by the same H3 strings — so **no Phaser code change is required** for marker placement.

Debug helpers (e.g. `spectatorDebug.ts`) that log or assume `"col,row"`-shaped ids may warrant a wording-only update so logs read clearly; behavior remains correct as long as they use the same id for `ghostTiles` and `tileCoords` lookups.

---

## Map Overlay Client

The `client/map-overlay` package:
1. Subscribes to Colyseus `ghostTiles` patch events.
2. For each `ghostId → h3Index` pair, calls `h3.cellToLatLng(h3Index)` to get lat/lng.
3. Renders a ghost marker at that lat/lng on the real-world map.
4. On `ghostTiles` patch (position change), updates the marker position.

No dependency on `tileCoords` or `tileClasses` — the overlay client works entirely from H3 indices.
