# Data Model: World Items

**Feature**: specs/007-world-objects  
**Date**: 2026-04-22

## Item Definition

Defined in `shared/types/src/items.ts`. Loaded from `*.items.json` at server startup.

```
ItemDefinition {
  name:         string                        // display name; returned by look and inspect
  itemClass:  string                        // ruleset label; colon-separated multi-label (e.g. "Key")
  carriable:    boolean                       // whether take is permitted
  capacityCost: integer ≥ 0                   // capacity units consumed on the host tile (0 = no impact)
  description?: string                        // full text returned by inspect (omit → name only)
  attrs?:       Record<string, string|number> // open-ended authoring data; Neo4j maps as attr_* properties
}
```

Keyed in the sidecar by `itemRef` (string). The `itemRef` is the key; it does not appear inside the record.

## Object Sidecar File

`maps/<scene>/<mapname>.items.json`  
A plain JSON object:
```json
{
  "<itemRef>": { <ItemDefinition> },
  ...
}
```

Missing file → no items. Malformed JSON → startup error (throws from `loadHexMap()`).

## Extended Map Types

`server/colyseus/src/mapTypes.ts` gains:

```
CellRecord {
  ... (existing fields)
  capacity?:         number      // from tileset "capacity" property (existing but not yet typed)
  initialItemRefs: string[]    // itemRefs declared via tile-class property + item-placement layer
}

LoadedMap {
  ... (existing fields)
  itemSidecar: Map<itemRef, ItemDefinition>  // empty map if no sidecar
}
```

`initialItemRefs` is populated by `loadHexMap()` at load time. After server startup, `ItemService` consumes this field to seed its in-memory state and then ignores it — runtime mutations go through `ItemService` only.

## In-Memory Object State (ItemService)

`server/world-api/src/ItemService.ts`

```
ItemService state {
  tileObjects:  Map<h3Index, itemRef[]>   // objects currently on each tile (ordered; duplicates allowed)
  ghostInventory: Map<ghostId, itemRef[]> // objects currently carried by each ghost (ordered)
  sidecar: Map<itemRef, ItemDefinition> // read-only reference to loaded definitions
}
```

State transitions:

| Action | Pre-condition | State change |
|--------|--------------|--------------|
| `take(ghostId, h3Index, itemRef)` | itemRef present in `tileObjects[h3Index]`, definition.carriable = true | Remove first matching itemRef from `tileObjects[h3Index]`; append to `ghostInventory[ghostId]` |
| `drop(ghostId, h3Index, itemRef)` | itemRef present in `ghostInventory[ghostId]`; effective tile capacity not exceeded | Remove first matching itemRef from `ghostInventory[ghostId]`; append to `tileObjects[h3Index]` |
| Server restart | — | State fully re-seeded from `LoadedMap.initialItemRefs` (objects return to declared positions) |

## Colyseus Schema Extensions

`server/colyseus/src/room-schema.ts` gains two new `MapSchema<string>` fields on `WorldSpectatorState`:

```
tileItemRefs:  MapSchema<string>   // h3Index → comma-separated itemRef list
                                     // e.g. "key-brass,key-brass,statue"
ghostItemRefs: MapSchema<string>   // ghostId → comma-separated itemRef list
```

Updated by `WorldBridgeService.setTileObjects(h3Index, refs[])` and `WorldBridgeService.setGhostInventory(ghostId, refs[])` after every `take` and `drop`.

## Shared Type Extensions

`shared/types/src/ghostMcp.ts` gains:

```
TileItemSummary {
  id:   string           // itemRef
  name: string           // ItemDefinition.name
  at:   "here" | Compass // "here" when on the ghost's tile; compass face for adjacent
}

TileInspectResult {
  ... (existing fields)
  objects: TileItemSummary[]   // always present; [] when no items on that tile slice
}

InspectArgs  { itemRef: string }
InspectResult = InspectSuccess | InspectFailure
  InspectSuccess { ok: true; name: string; description?: string }
  InspectFailure { ok: false; code: "NOT_HERE" | "NOT_FOUND"; reason: string }

TakeArgs     { itemRef: string }
TakeResult   = TakeSuccess | TakeFailure
  TakeSuccess { ok: true; name: string }
  TakeFailure { ok: false; code: "NOT_CARRIABLE" | "NOT_HERE" | "NOT_FOUND" | "RULESET_DENY"; reason: string }

DropArgs     { itemRef: string }
DropResult   = DropSuccess | DropFailure
  DropSuccess { ok: true }
  DropFailure { ok: false; code: "NOT_CARRYING" | "TILE_FULL" | "RULESET_DENY"; reason: string }

InventoryResult { ok: true; objects: Array<{ itemRef: string; name: string }> }
```

## Capacity Formula

At any tile with `h3Index`:
```
effectiveCapacity = Σ(capacityCost of all itemRefs in tileObjects[h3Index])
available = tile.capacity - ghostCount - effectiveCapacity
```

- `go` blocks if `available < 1` after the ghost would enter (i.e. `available - 1 < 0`).
- `drop` blocks if `available - capacityCost(droppedObject) < 0`.
- Objects with `capacityCost: 0` never consume capacity.

`tile.capacity` comes from `CellRecord.capacity` (tileset `capacity` property). If the property is absent, capacity is treated as unbounded (no limit). This preserves existing behaviour for tiles that pre-date the capacity property.

## Error Types

`server/world-api/src/world-api-errors.ts` gains `WorldApiObjectError` variants:

```
WorldApiItemNotHere   { itemRef: string }   → "WorldApiError.ObjectNotHere"
WorldApiItemNotFound  { itemRef: string }   → "WorldApiError.ObjectNotFound"
WorldApiItemNotCarriable { itemRef: string } → "WorldApiError.ObjectNotCarriable"
WorldApiItemNotCarrying  { itemRef: string } → "WorldApiError.ObjectNotCarrying"
WorldApiTileFull        { h3Index: string }      → "WorldApiError.TileFull"
```

All covered in `server/src/errors.ts:errorToResponse()` under `Match.exhaustive`.

## Environment Variable

| Var | Default | Behaviour |
|-----|---------|-----------|
| `AIE_MATRIX_ITEMS` | unset | Path to the `*.items.json` sidecar. Absolute or relative to repo root. When unset, loader falls back to `<map-dir>/<map-basename>.items.json`. An explicit path that does not exist is a startup error; a missing co-located fallback is silently treated as an empty sidecar. |

Follows the same resolution pattern as `AIE_MATRIX_MAP` (`.tmj` path) and `AIE_MATRIX_RULES` (`.gram` path). The three env vars are independent — any combination is valid.

`ServerConfig` (in `server/src/services/ServerConfigService.ts`) gains:
```
itemsPath: string | undefined   // undefined = use co-location fallback
```

## State at Server Startup

1. `parseServerConfigFromEnv()` resolves `AIE_MATRIX_ITEMS` → `ServerConfig.itemsPath`.
2. `loadHexMap(mapPath, { itemsPath })` parses `.tmj` + `.tsx` + sidecar → `LoadedMap` (with `itemSidecar` and per-cell `initialItemRefs`).
2. `ItemService` is constructed from `LoadedMap`. It seeds `tileObjects` from `initialItemRefs`. `ghostInventory` starts empty.
3. `WorldBridgeService` broadcasts initial tile object state to Colyseus via `setTileObjects()` for every non-empty cell.
