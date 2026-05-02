# Data Model: H3GeoJSON Map Editor

**Feature**: `012-h3geojson-map-editor`  
**Updated**: 2026-05-02

All domain types live in `tools/map-editor/src/types/map-gram.ts`.  
All editor runtime state types live in `tools/map-editor/src/state/editor-state.ts`.  
H3 resolution 15 is the only supported resolution. `H3Index` is a branded `string`.

---

## Annotated format reference

The canonical example (`maps/sandbox/canonical.map.gram`) demonstrates every construct. This section walks through it section by section.

### 1. Header (bare record)

```gram
{ kind: "matrix-map", name: "canonical-example", description: "...", elevation: 0 }
```

The leading bare record is the map header. `kind` is the literal discriminant that identifies this as a matrix-map file. `name` is a machine identifier used for file naming. `elevation` is the floor number (0 = ground floor). `description` is optional.

### 2. Tile type definitions (nodes)

```gram
(floor:TileType:Floor { name: "Floor", description: "Open walkable area", capacity: 4, style: css`background: #c8b89a` })
(pillar:TileType:Pillar { name: "Pillar", capacity: 0, style: css`background: #555` })
```

Each tile type is a named gram node. The node **identity** (`floor`, `pillar`) is the gram identifier — lowercase-kebab, unique within the file, and reused in movement rules. The **labels** follow: `TileType` is the category tag; the second label (`Floor`, `Pillar`) is the `typeName` used on tile instances and polygons. `style` is raw CSS stored as a `css`...`` tagged string.

The built-in `floor:TileType:Floor` type is always present in a new map and cannot be deleted.

### 3. Item type definitions (nodes)

```gram
(brassKey:ItemType:BrassKey { name: "Brass Key", glyph: char`🔑`, takeable: true, capacityCost: 1 })
```

Same node pattern as tile types. `glyph` is a single Unicode character stored as a `char`...`` tagged string. `takeable: true` means a ghost agent can pick it up. `capacityCost` is how many capacity units it occupies on a tile.

### 4. Layers (walks)

```gram
[ground:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [...] })]
[overrides:Layer {kind: "tile"} | (:Tile:Pillar { geometry: [...] }), (:Portal { geometry: [...], mode: "Door" })]
[collectibles:Layer {kind: "items"} | (:Item:BrassKey { geometry: [...] })]
```

Each layer is a gram walk. The **identity** (`ground`, `overrides`, `collectibles`) is the layer's stable ID. The `kind` property determines which element types are valid inside.

**Polygon elements** — `geometry` contains the N vertex H3 cells that define the shape boundary (3 = triangle, 4 = rectangle, 6 = hexagon). The full cell fill is **derived by the consumer** using `h3.polygonToCellsExperimental` with `containmentOverlapping` mode — it is **not stored** in the file. The type label (`Floor`) assigns a tile type to all interior cells.

**Tile elements** — `geometry` contains a single H3 cell. The type label (`Pillar`) is the tile type. Explicit tiles override any polygon tile at the same cell.

**Portal elements** — `geometry` contains exactly two cells: `[fromCell, toCell]`. `mode` is a free-form string (`"Door"`, `"Stairs"`, `"Elevator"`, `"Teleporter"`, …). Portals live in tile layers.

**Item elements** — `geometry` contains a single H3 cell. The type label (`BrassKey`) references an `ItemType.typeName`.

### 5. Layer stack (walk)

```gram
[layers:LayerStack | ground, overrides, collectibles]
```

Declares render and priority order. First listed = bottom (rendered underneath). Topmost tile layer wins when multiple layers cover the same cell.

### 6. Movement rules (walk)

```gram
[rules:Rules | (floor)-[:GO]->(floor), (floor)-[:GO]->(pillar)]
```

Each element is a directed gram relationship using the `:GO` label. The source and target node identities (`floor`, `pillar`) are the **same identifiers** as the `TileType` node identities — gram identifiers are global within a file. Each rule declares that an agent on a `fromType` cell may move to a `toType` cell. Creating a new tile type automatically generates a self-rule; additional cross-type rules can be authored by hand.

---

## Domain types (`map-gram.ts`)

### MapMeta

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `"matrix-map"` | yes | literal discriminant |
| `name` | `string` | yes | machine identifier; used as file base name |
| `description` | `string` | no | human-readable label |
| `elevation` | `number` | yes | floor number, 0 = ground |

### TileType

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | gram node identity, e.g. `carpetedFloor` |
| `typeName` | `string` | yes | gram label used on instances, e.g. `CarpetedFloor` |
| `name` | `string` | yes | display name in editor palette |
| `description` | `string` | no | |
| `capacity` | `number` | no | max simultaneous occupants |
| `style` | `string` | no | raw CSS content; serialised as `css`...`` |

### ItemType

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | gram node identity |
| `typeName` | `string` | yes | gram label used on instances |
| `name` | `string` | yes | display name |
| `description` | `string` | no | |
| `glyph` | `string` | yes | single Unicode character; serialised as `char`...`` |
| `takeable` | `boolean` | yes | can a ghost agent pick it up |
| `capacityCost` | `number` | no | capacity units consumed on placement |
| `style` | `string` | no | raw CSS content |

### TileInstance

An explicitly painted H3 cell. Overrides any polygon tile at the same cell.

| Field | Type | Required | Notes |
|---|---|---|---|
| `h3Index` | `H3Index` | yes | resolution-15 cell id |
| `typeName` | `string` | yes | references a `TileType.typeName` |
| `isOverride` | `boolean` | no | true when painted over a polygon fill cell |

### PolygonShape

A closed filled region defined by N vertex H3 cells.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | editor-generated identifier, not stored in gram |
| `typeName` | `string` | yes | tile type applied to all interior cells |
| `vertices` | `H3Index[]` | yes | the N defining corner cells; stored as `geometry` in gram |
| `cells` | `H3Index[]` | yes | computed fill — **not stored in gram**; derived from `vertices` via `polygonToCellsExperimental(containmentOverlapping)` at import time and on each render |
| `sides` | `number` | yes | derived as `vertices.length`; used by the editor for vertex handle count |

The separation is deliberate: `geometry` in the gram file holds the compact vertex definition (3–6 cells); the consumer always recomputes the full fill. This keeps the file small and makes polygon editing (vertex dragging) the canonical operation.

### Portal

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | editor-generated |
| `fromH3` | `H3Index` | yes | source cell |
| `toH3` | `H3Index` | yes | target cell |
| `mode` | `string` | yes | crossing type: `"Door"`, `"Stairs"`, `"Elevator"`, `"Teleporter"`, … |

### ItemInstance

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | editor-generated |
| `typeName` | `string` | yes | references an `ItemType.typeName` |
| `h3Index` | `H3Index` | yes | cell location |

### MovementRule

Declares a permitted agent traversal between two tile types. Serialised as `(fromId)-[:GO]->(toId)` in the `[rules:Rules | ...]` walk.

| Field | Type | Required | Notes |
|---|---|---|---|
| `fromTypeName` | `string` | yes | source `TileType.typeName` |
| `toTypeName` | `string` | yes | target `TileType.typeName` |

A new map starts with one rule: `Floor → Floor`. Every new tile type automatically receives a self-rule on creation.

---

## Editor state types (`editor-state.ts`)

The editor uses a unified layer model. All layers live in a single ordered array rather than separate fields by kind.

### MapLayer (union)

```typescript
type MapLayer = PolygonLayerState | TileLayerState | ItemsLayerState

interface PolygonLayerState extends BaseLayer {
  kind: "polygon"
  committed: PolygonShape[]     // confirmed polygons
}

interface TileLayerState extends BaseLayer {
  kind: "tile"
  tiles: Map<H3Index, TileInstance>
  portals: Portal[]
}

interface ItemsLayerState extends BaseLayer {
  kind: "items"
  items: ItemInstance[]
}

interface BaseLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}
```

### UIState

```typescript
interface UIState {
  activeTool: "paint" | "erase" | "polygon" | "portal" | "place-item" | "hand"
  activeTypeId: string | null       // selected TileType id
  activeLayerId: string             // id of the layer receiving edits
  inProgressPolygon: H3Index[]      // vertices placed but not yet confirmed
  portalPendingFrom: H3Index | null  // first cell of a portal in progress
  selectedElement: ElementRef | null
  hint: string | null
  showBoundingBox: boolean
  polygonVertexCount: number        // 3 | 4 | 6 — shape for next polygon placement
  draggedPolygon: { ... } | null    // live preview during polygon drag
  editingPolygon: { layerId, polyId } | null   // polygon in vertex-edit mode
  vertexDragPreview: { cells, vertices } | null // live preview during vertex drag
}
```

The `hand` tool enables selecting, dragging, and vertex-editing polygons. Vertex editing is entered by double-clicking a selected polygon; exited by Escape. In vertex-edit mode, individual vertex handles (cyan dots on the map) can be dragged to deform the polygon.

### MapEditorState (root)

```typescript
interface MapEditorState {
  meta: MapMeta
  tileTypes: TileType[]
  itemTypes: ItemType[]
  rules: MovementRule[]
  layers: MapLayer[]   // bottom (index 0) → top; topmost tile wins per cell
  ui: UIState
}
```

---

## State transitions

| Action | Guard | Effect |
|---|---|---|
| `PAINT_CELL(h3)` | active layer is tile, not locked | adds/updates `TileInstance` with active type |
| `ERASE_CELL(h3)` | active layer is tile, not locked; cell is an explicit instance | removes `TileInstance`; no effect on polygon virtual tiles |
| `ADD_POLYGON_VERTEX(h3)` | active layer is polygon | appends to `ui.inProgressPolygon` |
| `CONFIRM_POLYGON` | `inProgressPolygon.length >= 3` | calls `computeCellsFromVertices` to compute fill; commits `PolygonShape` (with `vertices` and `cells`) to active polygon layer; clears `inProgressPolygon` |
| `CANCEL_POLYGON` | — | clears `inProgressPolygon` |
| `PLACE_POLYGON(cells, sides, vertices)` | active layer is polygon | commits a shape-button-placed polygon; `vertices` are the N anchor cells, `cells` is the precomputed fill |
| `BEGIN_POLYGON_EDIT(layerId, polyId)` | — | enters vertex-edit mode; populates `vertices` lazily if absent |
| `COMMIT_VERTEX_DRAG` | `editingPolygon` and `vertexDragPreview` set | writes new `cells` and `vertices` from drag preview to polygon; stays in edit mode |
| `EXIT_POLYGON_EDIT` | — | clears `editingPolygon` and `vertexDragPreview` |
| `DELETE_POLYGON(layerId, id)` | — | removes polygon; clears selection if it was selected |
| `SELECT_PORTAL_FROM(h3)` | — | sets `ui.portalPendingFrom` |
| `CREATE_PORTAL(h3)` | `portalPendingFrom` set | adds `Portal` to active tile layer; clears `portalPendingFrom` |
| `CREATE_TILE_TYPE(tileType)` | — | creates type; auto-adds `MovementRule { fromTypeName, toTypeName }` (self-rule) |
| `PLACE_ITEM(h3, itemTypeName)` | active layer is items, not locked | adds `ItemInstance` |
| `ADD_LAYER(kind, name)` | — | appends new layer; activates it; switches tool to layer default |
| `REMOVE_LAYER(layerId)` | `layers.length > 1` | removes layer; activates nearest remaining layer |
| `SET_ACTIVE_LAYER(layerId)` | — | changes `activeLayerId`; auto-switches tool to layer default |
| `IMPORT_MAP(state)` | — | replaces full `MapEditorState`; on import, polygon `cells` are recomputed from `vertices` via `computeCellsFromVertices` |

---

## Layer kind / tool compatibility

Each active tool is only valid against the active layer's kind. Switching layers auto-switches the tool.

| Active layer kind | Default tool | Valid tools |
|---|---|---|
| `polygon` | `polygon` | `polygon`, `hand` |
| `tile` | `paint` | `paint`, `erase`, `portal`, `hand` |
| `items` | `place-item` | `place-item`, `erase`, `hand` |

---

## Polygon shapes

The editor supports three fixed shapes via the shape button panel:

| Button | Sides | Geometry entries |
|---|---|---|
| Triangle | 3 | 3 vertex cells |
| Rectangle | 4 | 4 corner cells |
| Hexagon | 6 | 6 vertex cells |

Pentagon (5-sided) is intentionally unsupported. Pentagons exist in the H3 grid itself (12 per resolution) but are special cells with irregular geometry; polygon tools target regular shapes only.
