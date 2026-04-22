# IC-012: Colyseus Object State Broadcast

**Feature**: 007-world-objects  
**Owner**: `server/colyseus/src/room-schema.ts`, `server/world-api/src/colyseus-bridge.ts`  
**Consumers**: `client/phaser/` (spectator rendering — deferred), debug panel

## Schema Additions to `WorldSpectatorState`

Two new `MapSchema<string>` fields are added alongside the existing `ghostTiles`, `ghostModes`, `tileCoords`, and `tileClasses`:

```typescript
/** h3Index → comma-separated objectRef list. Empty string = no objects on tile. */
@type({ map: "string" })
declare tileObjectRefs: MapSchema<string>;

/** ghostId → comma-separated objectRef list. Entry absent = ghost carries nothing. */
@type({ map: "string" })
declare ghostObjectRefs: MapSchema<string>;
```

Comma-separated list format: `"sign-welcome"` or `"key-brass,key-brass,statue"`.  
Empty tile: entry removed from the map (do not set to empty string — use `.delete(key)`).  
Empty ghost inventory: entry removed from the map.

## Bridge Methods Added to `ColyseusWorldBridge`

`server/world-api/src/colyseus-bridge.ts`:

```typescript
/** Replace the object list on a tile. Pass empty array to clear. */
setTileObjects(h3Index: string, objectRefs: string[]): void;

/** Replace the carried object list for a ghost. Pass empty array to clear. */
setGhostInventory(ghostId: string, objectRefs: string[]): void;
```

`ObjectService` calls both after every `take` and `drop`. At server startup, `ObjectService` calls `setTileObjects` for each tile with initial objects.

## Downstream Contract

Phaser spectators that subscribe to `room.state.tileObjectRefs.onChange` and `room.state.ghostObjectRefs.onChange` will receive real-time updates. The format (comma-separated string) was chosen for simplicity at the data-pipeline stage; the Phaser client RFC may introduce a richer schema.

This contract is stable for the Phaser client RFC to build on without further server changes.
