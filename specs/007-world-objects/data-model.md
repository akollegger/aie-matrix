# Data Model: World Objects

**Feature**: specs/007-world-objects  
**Date**: 2026-04-22

## Object Definition

Defined in `shared/types/src/objects.ts` (new file). Loaded from `*.objects.json` at server startup.

```
ObjectDefinition {
  name:         string        // display name; returned by look and inspect
  objectClass:  string        // ruleset label; colon-separated multi-label (e.g. "Key:Brass")
  carriable:    boolean       // whether take is permitted
  capacityCost: integer ≥ 0   // capacity units consumed on the host tile (0 = no impact)
  description?: string        // full text returned by inspect (omit → name only)
}
```

Keyed in the sidecar by `objectRef` (string). The `objectRef` is the key; it does not appear inside the record.

## Object Sidecar File

`maps/<scene>/<mapname>.objects.json`  
A plain JSON object:
```json
{
  "<objectRef>": { <ObjectDefinition> },
  ...
}
```

Missing file → no objects. Malformed JSON → startup error (throws from `loadHexMap()`).

## Extended Map Types

`server/colyseus/src/mapTypes.ts` gains:

```
CellRecord {
  ... (existing fields)
  capacity?:         number      // from tileset "capacity" property (existing but not yet typed)
  initialObjectRefs: string[]    // objectRefs declared via tile-class property + object-placement layer
}

LoadedMap {
  ... (existing fields)
  objectSidecar: Map<objectRef, ObjectDefinition>  // empty map if no sidecar
}
```

`initialObjectRefs` is populated by `loadHexMap()` at load time. After server startup, `ObjectService` consumes this field to seed its in-memory state and then ignores it — runtime mutations go through `ObjectService` only.

## In-Memory Object State (ObjectService)

`server/world-api/src/ObjectService.ts`

```
ObjectService state {
  tileObjects:  Map<h3Index, objectRef[]>   // objects currently on each tile (ordered; duplicates allowed)
  ghostInventory: Map<ghostId, objectRef[]> // objects currently carried by each ghost (ordered)
  sidecar: Map<objectRef, ObjectDefinition> // read-only reference to loaded definitions
}
```

State transitions:

| Action | Pre-condition | State change |
|--------|--------------|--------------|
| `take(ghostId, h3Index, objectRef)` | objectRef present in `tileObjects[h3Index]`, definition.carriable = true | Remove first matching objectRef from `tileObjects[h3Index]`; append to `ghostInventory[ghostId]` |
| `drop(ghostId, h3Index, objectRef)` | objectRef present in `ghostInventory[ghostId]`; effective tile capacity not exceeded | Remove first matching objectRef from `ghostInventory[ghostId]`; append to `tileObjects[h3Index]` |
| Server restart | — | State fully re-seeded from `LoadedMap.initialObjectRefs` (objects return to declared positions) |

## Colyseus Schema Extensions

`server/colyseus/src/room-schema.ts` gains two new `MapSchema<string>` fields on `WorldSpectatorState`:

```
tileObjectRefs:  MapSchema<string>   // h3Index → comma-separated objectRef list
                                     // e.g. "key-brass,key-brass,statue"
ghostObjectRefs: MapSchema<string>   // ghostId → comma-separated objectRef list
```

Updated by `WorldBridgeService.setTileObjects(h3Index, refs[])` and `WorldBridgeService.setGhostInventory(ghostId, refs[])` after every `take` and `drop`.

## Shared Type Extensions

`shared/types/src/ghostMcp.ts` gains:

```
TileObjectSummary {
  id:   string           // objectRef
  name: string           // ObjectDefinition.name
  at:   "here" | Compass // "here" when on the ghost's tile; compass face for adjacent
}

TileInspectResult {
  ... (existing fields)
  objects?: TileObjectSummary[]  // present when objects visible; omitted for empty (backward compat)
}

InspectArgs  { objectRef: string }
InspectResult = InspectSuccess | InspectFailure
  InspectSuccess { ok: true; name: string; description?: string }
  InspectFailure { ok: false; code: "NOT_HERE" | "NOT_FOUND"; reason: string }

TakeArgs     { objectRef: string }
TakeResult   = TakeSuccess | TakeFailure
  TakeSuccess { ok: true; name: string }
  TakeFailure { ok: false; code: "NOT_CARRIABLE" | "NOT_HERE" | "NOT_FOUND" | "RULESET_DENY"; reason: string }

DropArgs     { objectRef: string }
DropResult   = DropSuccess | DropFailure
  DropSuccess { ok: true }
  DropFailure { ok: false; code: "NOT_CARRYING" | "TILE_FULL" | "RULESET_DENY"; reason: string }

InventoryResult { ok: true; objects: Array<{ objectRef: string; name: string }> }
```

## Capacity Formula

At any tile with `h3Index`:
```
effectiveCapacity = Σ(capacityCost of all objectRefs in tileObjects[h3Index])
available = tile.capacity - ghostCount - effectiveCapacity
```

- `go` blocks if `available < 1` after the ghost would enter (i.e. `available - 1 < 0`).
- `drop` blocks if `available - capacityCost(droppedObject) < 0`.
- Objects with `capacityCost: 0` never consume capacity.

`tile.capacity` comes from `CellRecord.capacity` (tileset `capacity` property). If the property is absent, capacity is treated as unbounded (no limit). This preserves existing behaviour for tiles that pre-date the capacity property.

## Error Types

`server/world-api/src/world-api-errors.ts` gains `WorldApiObjectError` variants:

```
WorldApiObjectNotHere   { objectRef: string }   → "WorldApiError.ObjectNotHere"
WorldApiObjectNotFound  { objectRef: string }   → "WorldApiError.ObjectNotFound"
WorldApiObjectNotCarriable { objectRef: string } → "WorldApiError.ObjectNotCarriable"
WorldApiObjectNotCarrying  { objectRef: string } → "WorldApiError.ObjectNotCarrying"
WorldApiTileFull        { h3Index: string }      → "WorldApiError.TileFull"
```

All covered in `server/src/errors.ts:errorToResponse()` under `Match.exhaustive`.

## Environment Variable

| Var | Default | Behaviour |
|-----|---------|-----------|
| `AIE_MATRIX_OBJECTS` | unset | Path to the `*.objects.json` sidecar. Absolute or relative to repo root. When unset, loader falls back to `<map-dir>/<map-basename>.objects.json`. An explicit path that does not exist is a startup error; a missing co-located fallback is silently treated as an empty sidecar. |

Follows the same resolution pattern as `AIE_MATRIX_MAP` (`.tmj` path) and `AIE_MATRIX_RULES` (`.gram` path). The three env vars are independent — any combination is valid.

`ServerConfig` (in `server/src/services/ServerConfigService.ts`) gains:
```
objectsPath: string | undefined   // undefined = use co-location fallback
```

## State at Server Startup

1. `parseServerConfigFromEnv()` resolves `AIE_MATRIX_OBJECTS` → `ServerConfig.objectsPath`.
2. `loadHexMap(mapPath, { objectsPath })` parses `.tmj` + `.tsx` + sidecar → `LoadedMap` (with `objectSidecar` and per-cell `initialObjectRefs`).
2. `ObjectService` is constructed from `LoadedMap`. It seeds `tileObjects` from `initialObjectRefs`. `ghostInventory` starts empty.
3. `WorldBridgeService` broadcasts initial tile object state to Colyseus via `setTileObjects()` for every non-empty cell.
