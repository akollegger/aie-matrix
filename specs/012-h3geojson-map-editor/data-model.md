# Data Model: H3GeoJSON Map Editor

**Feature**: `012-h3geojson-map-editor`  
**Date**: 2026-04-28

All types live in `tools/map-editor/src/types/map-gram.ts` (domain model) and `tools/map-editor/src/state/editor-state.ts` (editor runtime state). Resolution 15 is the only supported H3 resolution; `H3Index` is a `string` branded type.

---

## Domain Types (map-gram.ts)

### MapMeta
Header block of a `.map.gram` file.

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `"matrix-map"` | yes | literal discriminant |
| `name` | `string` | yes | machine identifier |
| `description` | `string` | no | human-readable label |
| `elevation` | `number` | yes | 0 = ground floor |

### TileType
Defines a class of floor tile. Serialised as a gram node.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | gram identifier (e.g. `carpetedFloor`) |
| `typeName` | `string` | yes | gram label (e.g. `CarpetedFloor`) |
| `name` | `string` | yes | display name |
| `description` | `string` | no | |
| `capacity` | `number` | no | max simultaneous occupants |
| `style` | `string` | no | CSS expression, stored as `css\`...\`` |

### ItemType
Defines a class of placeable item.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | gram identifier |
| `typeName` | `string` | yes | gram label |
| `name` | `string` | yes | display name |
| `description` | `string` | no | |
| `glyph` | `string` | yes | single Unicode character |
| `takeable` | `boolean` | yes | can ghost pick it up |
| `capacityCost` | `number` | no | tiles consumed when placed |
| `style` | `string` | no | CSS expression |

### TileInstance
A single H3 cell in the map.

| Field | Type | Required | Notes |
|---|---|---|---|
| `h3Index` | `H3Index` | yes | resolution-15 cell id |
| `typeName` | `string` | yes | references a `TileType.typeName` |
| `isOverride` | `boolean` | no | true when painted over a polygon fill |

### PolygonShape
An ordered vertex list defining a closed filled region.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | gram identifier |
| `typeName` | `string` | yes | tile type applied to interior cells |
| `vertices` | `H3Index[]` | yes | min 3, order defines boundary |

Interior cells are **not** stored anywhere. They are derived on-the-fly from the committed vertices using `h3.polygonToCells` whenever the polygon layer renders. Deleting the `PolygonShape` removes all associated virtual tiles from the display.

### Portal
A typed directed traversal edge between two tile cells.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | generated identifier |
| `fromH3` | `H3Index` | yes | source cell (must be in tile layer) |
| `toH3` | `H3Index` | yes | target cell (must be in tile layer) |
| `mode` | `string` | yes | e.g. `"Elevator"`, `"Stairs"`, `"Door"` |

### ItemInstance
A placed item on a tile cell.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | generated identifier |
| `typeName` | `string` | yes | references an `ItemType.typeName` |
| `h3Index` | `H3Index` | yes | cell must exist in tile layer |

---

## Editor State Types (editor-state.ts)

### TileLayer
```
{
  tiles: Map<H3Index, TileInstance>
}
```

### PolygonLayer
```
{
  committed: PolygonShape[]
  inProgress: H3Index[]   // vertices placed but not yet confirmed
}
```

### PortalLayer
```
{
  portals: Portal[]
  pendingFrom: H3Index | null  // first cell selected, waiting for second
}
```

### ItemLayer
```
{
  id: string
  name: string
  visible: boolean
  locked: boolean
  items: ItemInstance[]
}
```

### MapEditorState (root)
```
{
  meta: MapMeta
  tileTypes: TileType[]
  itemTypes: ItemType[]
  tileLayer: TileLayer
  polygonLayer: PolygonLayer
  portalLayer: PortalLayer
  itemLayers: ItemLayer[]
  ui: {
    activeTool: "paint" | "erase" | "polygon" | "portal" | "place-item"
    activeTypeId: string | null
    activeItemLayerId: string | null
    layerVisibility: Record<"tile" | "polygon" | "portal" | string, boolean>
    layerLocked: Record<"tile" | "polygon" | "portal" | string, boolean>
  }
}
```

---

## State Transitions

| Action | Guard | Effect |
|---|---|---|
| `PAINT_CELL(h3Index)` | tile layer not locked | adds/updates TileInstance with active type |
| `ERASE_CELL(h3Index)` | tile layer not locked | removes TileInstance |
| `ADD_POLYGON_VERTEX(h3Index)` | polygon layer not locked | appends to `inProgress` |
| `CONFIRM_POLYGON` | `inProgress.length >= 3` | commits `PolygonShape` to `polygonLayer.committed`, clears `inProgress`; virtual tiles are derived on render — no TileInstances are created |
| `CANCEL_POLYGON` | — | clears `inProgress` |
| `SELECT_PORTAL_FROM(h3Index)` | cell in tile layer | sets `pendingFrom` |
| `CREATE_PORTAL(h3Index)` | `pendingFrom` set; target in tile layer | adds Portal, clears `pendingFrom` |
| `PLACE_ITEM(h3Index)` | cell in tile layer; item layer not locked | adds ItemInstance |
| `IMPORT_MAP(state)` | — | replaces full MapEditorState |
