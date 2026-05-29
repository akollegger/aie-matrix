# Data Model: Map Catalog Standardization & Moscone West Map

**Spec**: `specs/020-map-catalog-standardization`  
**Date**: 2026-05-25

## Map Catalog Entry (runtime, in-memory)

After TMJ removal, the catalog entry is gram-only:

| Field | Type | Notes |
|-------|------|-------|
| `mapId` | `string` | Derived from gram filename stem (e.g., `moscone-west` from `moscone-west.map.gram`) |
| `gramPath` | `string` | Absolute path to `.map.gram` file |

**Removed**: `tmjPath?: string`

---

## Map Gram Document (file-based)

The canonical data store. No schema changes to the gram format itself — only the catalog indexing changes.

| Field | Notes |
|-------|-------|
| `kind` | Must be `"matrix-map"` |
| `name` | Display name (e.g., `"Moscone West"`) |
| `elevation` | Integer floor level (0 = ground) |
| TileType nodes | Named tile categories with `capacity` and optional `style` |
| Layer nodes | Polygon or tile geometry definitions |
| LayerStack node | Ordered list of layers |
| Rules node | `GO` edges between traversable TileTypes |

---

## Moscone West TileType Entities

| Identity | TypeName | capacity | Traversable | Notes |
|----------|----------|----------|-------------|-------|
| `floor` | `Floor` | 4 | ✅ | General surface |
| `wall` | `Wall` | 0 | ❌ | Structural boundary |
| `lobby` | `Lobby` | 6 | ✅ | Entry / welcome area |
| `corridor` | `Corridor` | 4 | ✅ | Circulation path |
| `expo` | `ExpoHall` | 8 | ✅ | Main vendor floor |
| `stage` | `MainStage` | 12 | ✅ | Keynote stage |
| `room_2001` | `Room2001` | 6 | ✅ | Breakout room |
| `room_2002` | `Room2002` | 6 | ✅ | Breakout room |
| `room_2003` | `Room2003` | 6 | ✅ | Breakout room |
| `booth_a` | `VendorBoothA` | 3 | ✅ | Illustrative vendor (e.g., Neo4j) |
| `booth_b` | `VendorBoothB` | 3 | ✅ | Illustrative vendor (e.g., Anthropic) |
| `booth_c` | `VendorBoothC` | 3 | ✅ | Illustrative vendor (e.g., LangChain) |

### Traversal Graph (rules)

Edges are directed (`GO`); non-adjacent tile types are not directly reachable.

```
floor ↔ floor
floor → lobby
floor → corridor
lobby ↔ lobby
lobby ↔ corridor
lobby → expo
corridor ↔ corridor
corridor → expo
corridor → room_2001
corridor → room_2002
corridor → room_2003
corridor → stage
expo ↔ expo
expo ↔ booth_a
expo ↔ booth_b
expo ↔ booth_c
room_2001 ↔ room_2001
room_2002 ↔ room_2002
room_2003 ↔ room_2003
stage ↔ stage
```

(`wall` has no edges — capacity 0 makes it unreachable by movement rules)

---

## State Transitions

No new state machine. The TMJ removal affects the catalog build at server startup only:

**Before**: Startup scans `maps/**/*.tmj` + `maps/**/*.map.gram` → pairs them → builds index  
**After**: Startup scans `maps/**/*.map.gram` only → builds index directly

---

## File Deletions (no data migration needed)

All `.tmj` files have existing `.map.gram` counterparts; no content is lost.

| File | Map ID | Gram counterpart |
|------|--------|-----------------|
| `maps/sandbox/freeplay.tmj` | `freeplay` | `maps/sandbox/freeplay.map.gram` ✅ |
| `maps/sandbox/map-with-polygons.tmj` | `map-with-polygons` | `maps/sandbox/map-with-polygons.map.gram` ✅ |
| `maps/sandbox/read-and-collect.tmj` | `read-and-collect` | `maps/sandbox/read-and-collect.map.gram` ✅ |
| `maps/sandbox/redbluegreen.tmj` | `redbluegreen` | `maps/sandbox/redbluegreen.map.gram` ✅ |
| `maps/moscone/moscone-west.tmx` | _(authoring source)_ | `maps/moscone/moscone-west.map.gram` (rewritten) ✅ |
