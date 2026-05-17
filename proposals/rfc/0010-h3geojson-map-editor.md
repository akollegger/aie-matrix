# RFC-0010: H3GeoJSON Map Format and Native Map Editor

**Status:** accepted  
**Date:** 2026-04-28  
**Revised:** 2026-05-17  
**Authors:** @akollegger  
**Related:** [ADR-0005](../adr/0005-h3-native-map-format.md) (H3-native map format),
[RFC-0004](0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0009](0009-map-format-pipeline.md) (map format pipeline)

## Summary

Define H3GeoJSON as the native geometry model for `.map.gram` and `.world.gram`,
and specify a browser-based map editor built on MapLibre GL that authors maps
directly in this format without Tiled as an intermediary. H3GeoJSON is
GeoJSON's geometry model adapted to use H3 cell indices as coordinates.
The editor replaces the Tiled authoring workflow for venue-scale maps (e.g.
Moscone Center) where Tiled's offset-grid abstraction is a poor fit for
geocoded, rotated floor plates.

## Motivation

The current authoring workflow (Tiled `.tmj` → `tmj-to-gram` converter →
`.map.gram`) was designed as a migration bridge, not a long-term solution.
ADR-0005 says as much: "A native world editor is a future effort." Three
pressures make that future urgent:

**Venue scale.** Moscone West covers thousands of H3 resolution-15 cells and
sits at an angle to the street grid. Tiled's odd-q offset coordinate system
has no native concept of geocoding or rotation. Placing an `h3_anchor` at
`(0,0)` and deriving cell positions at load time works for a small sandbox
map but becomes brittle and error-prone at conference-floor scale.

**Polygon authoring.** RFC-0009 introduced `tile-area` object layers in Tiled
as a compression mechanism for large regions. Drawing those polygons accurately
— with vertices that land inside hex cells, not in the gutters — requires
careful pixel-level authoring in Tiled's coordinate system. A native H3 editor
eliminates this class of error: every vertex snaps to a cell by definition.

**The `.tmj` bridge is already showing seams.** Portals (non-adjacent traversal
edges), multi-floor elevation, and `.world.gram` cross-map references have no
Tiled representation. Each new feature requires either a new Tiled workaround
or authoring outside Tiled and merging by hand.

A native editor that speaks H3GeoJSON directly removes the coordinate
translation layer, makes the full `.map.gram` feature set authorable, and
enables GeoJSON polygon import from OpenStreetMap for venue bootstrapping.

## Design

### H3GeoJSON geometry model

H3GeoJSON is GeoJSON's geometry model with H3 cell indices substituted for
`[longitude, latitude]` coordinate pairs. The semantics follow GeoJSON exactly:

| Vertex count | Geometry type | Meaning |
|---|---|---|
| 1 | Point | A single tile |
| 3+ | Polygon | A closed, filled region |

Two-vertex shapes (LineString) are not used. Directed connections between
tiles are portals — serialised as `[:Portal { geometry: [from, to] }]`
elements inside tile layers, not as standalone graph relationships.

Polygon shapes are always closed; the editor enforces this and does not
require the author to repeat the first vertex.

```
// H3GeoJSON point — single tile instance
(ticket-desk:InfoDesk { location: h3`8f2800000000195` })

// H3GeoJSON polygon — filled region, vertices in order
[main-hall:Polygon:CarpetedFloor |
    h3`8f2800000000195`,
    h3`8f28000000001a4`,
    h3`8f2800000000c54`,
    h3`8f2800000000c6c`
]
```

Interior cells of a filled polygon inherit the polygon's tile type and are
not enumerated individually unless they override the type. This is the
compression convention established in RFC-0009 and retained here.

### Tagged-string vocabulary

Literal values in `.map.gram` and `.world.gram` use tagged strings to make
the type of each value explicit and machine-readable without relying on field
name conventions:

| Tag | Type | Example |
|---|---|---|
| `h3\`...\`` | H3 cell index (resolution 15) | `h3\`8f2800000000195\`` |
| `css\`...\`` | CSS expression | `css\`background: #c8b89a\`` |
| `url\`...\`` | File or resource path | `url\`maps/moscone/west.map.gram\`` |
| `char\`...\`` | Single Unicode character | `char\`🔑\`` |

### `.map.gram` schema

A map file contains six sections in order:

**1. Header**
```
{
    kind: "matrix-map",
    name: "<identifier>",
    description: "<human-readable>",
    elevation: <integer>   // 0 = ground floor
}
```

**2. Tile type definitions**
```
(carpetedFloor:TileType:CarpetedFloor {
    name: "Carpeted Floor",
    description: "Main hall flooring, suitable for booths and seating",
    capacity: 4,           // optional; omit for unlimited
    style: css`background: #c8b89a`
})
```

Properties: `name` (string, required), `description` (string, optional),
`capacity` (integer, optional), `style` (CSS, optional).

**3. Item type definitions**
```
(brassKey:ItemType:BrassKey {
    name: "Brass Key",
    description: "Opens the side door",
    glyph: char`🔑`,
    takeable: true,
    capacityCost: 1,
    style: css`color: goldenrod`
})
```

Properties: `name`, `description`, `glyph` (char), `takeable` (boolean),
`capacityCost` (integer), `style` (CSS).

**4. Layers**

Each layer is a gram path with a `kind` property and inline element nodes.
Tile and polygon elements use a `geometry` array of H3 indices.

Tile layer — contains tile instances and portals:
```
[hallFloor:Layer { kind: "tile", name: "Hall Floor" } |
    [:Tile:CarpetedFloor { geometry: [h3`8f2800000000195`] }],
    [:Tile:CarpetedFloor { geometry: [h3`8f28000000001a4`] }],
    [:Portal { geometry: [h3`8f2800000000195`, h3`8f28000000001a4`], mode: "Door" }]
]
```

Polygon layer — stores vertex cells only (interior fill is recomputed at load):
```
[hallRegion:Layer { kind: "polygon", name: "Hall Region" } |
    (hall-a:Polygon:CarpetedFloor {
        name: "Hall A",
        description: "Main session hall. Carpeted seating area for 500.",
        geometry: [
            h3`8f2800000000195`,
            h3`8f28000000001a4`,
            h3`8f2800000000c54`,
            h3`8f2800000000c6c`
        ]
    }),
    (hall-a-stage:Polygon:SessionRoom:StagedArea {
        name: "Hall A Stage",
        description: "Raised stage at the front of Hall A. A speaker claims this room to broadcast to everyone in the hall.",
        geometry: [h3`8f2800000000100`, h3`8f2800000000101`, h3`8f2800000000102`]
    })
]
```

Every polygon node requires `name` and `description`. These fields are
mandatory — the editor blocks confirmation of a polygon that lacks either.

Polygon nodes **must** carry a node identifier (e.g. `hall-a`) whenever the
polygon will be referenced at runtime. The node identifier is the stable
machine key. The `name` property is the human-readable display label surfaced
to agents and UIs; `description` gives spatial context in natural language.

The `SessionRoom` label is the server's signal that a polygon is claimable
via the `claim` / `yield` mechanic (RFC-0012). Adding or removing this label
is toggled by a checkbox in the polygon property editor. Any polygon may carry
the label; the server ignores it on polygons that lack a node identifier.
Other semantic labels may be added the same way in future RFCs.

Item layer:
```
[items:Layer { kind: "items", name: "Items" } |
    [:Item:BrassKey { geometry: [h3`8f2800000000015`] }]
]
```

**5. Layer stack**

The `LayerStack` node records display order bottom-to-top:
```
[layers:LayerStack | hallRegion, hallFloor, items]
```

**6. Movement rules**

One auto-generated self-traversal rule per tile type. The engine uses these
to determine which tile types agents can move between:
```
[rules:Rules |
    (carpetedFloor)-[:GO]->(carpetedFloor)
]
```

Additional rules (e.g. cross-type transitions) may be authored manually.

### Portals

A portal is a geometry element inside a tile layer. It stores exactly two
H3 cell indices in its `geometry` array — the directed source and destination.
It does not imply or create tiles; both cells must already exist in the layer.

```
[:Portal { geometry: [h3`8f2800000000195`, h3`8f28000000001a4`], mode: "Door" }]
```

Portal `mode` values are open-ended strings. Suggested values: `"Elevator"`,
`"Stairs"`, `"Door"`, `"Teleporter"`. The pentagonal cell portals (RFC-0004)
are a special case and may warrant their own reserved mode.

Cross-map portals (connecting tiles in different `.map.gram` files) belong in
`.world.gram`, not in either map file. A map has no knowledge of the world
that contains it.

### `.world.gram` schema

A world file assembles maps and owns cross-map portals:

```
{
    kind: "matrix-world",
    name: "<identifier>",
    description: "<human-readable>"
}

// Map references
(moscone-west:Map { src: url`maps/moscone/west.map.gram` })
(moscone-north:Map { src: url`maps/moscone/north.map.gram` })

// Cross-map portal
(west-elevator:Tile { location: h3`8f28...` })-[:Portal { mode: "Elevator" }]->(north-elevator:Tile { location: h3`8f29...` })
```

The world file does not redeclare tile or item types — those belong to the
individual map files.

### Layer model

The editor organises authoring into three layer kinds per map. All layers
are held in a single ordered `layers` array; the `LayerStack` node records
the display order (bottom-to-top).

**Polygon layer (`kind: "polygon"`, zero or one per map).** Drawing surface
for closed filled regions. Each polygon is assigned a tile type from the
palette. Polygons require a minimum of three vertices and are always closed.
The implementation stores **only the vertex cells** — the full interior cell
set is recomputed on demand via `h3.polygonToCells`. This avoids storing
large cell arrays in the file while keeping the gram source compact.
Vertex snapping ensures every vertex is an exact H3 cell centroid — no
approximate positioning.

**Tile layer (`kind: "tile"`, one or more per map).** Contains tile instances
and portal relationships. Populated by direct cell painting or from a polygon
fill. Portals live in this layer as geometry elements alongside the tiles —
there is no separate portal layer. This is a deliberate simplification: a
portal is anchored to two specific cells and travels with the tile layer that
owns those cells.

**Item layer (`kind: "items"`, zero or more per map).** Placement of item
instances on tile cells. Multiple item layers are supported (e.g. `furniture`,
`spawn-points`, `vendor-booths`). Each layer is independently toggleable.

| Layer kind | Count | Contains |
|---|---|---|
| `"polygon"` | 0 or 1 | Closed filled regions (3+ vertices, vertex-only storage) |
| `"tile"` | 1 or more | Tile instances + portal edges between cell pairs |
| `"items"` | 0 or more | Item instances placed on tile cells |

### Editor

The editor is built with TypeScript 5.7, React 18, Vite 6, MapLibre GL 5
(base map), h3-js 4, and `@relateby/pattern` for gram import parsing.
It is browser-only; files are exchanged via browser download/upload with
no server-side persistence.

Features:

- **Polygon draw mode.** Two sub-modes: freeform vertex-by-vertex placement
  (vertices snap to H3 cell centroids, min 3 vertices enforced, polygon
  closes on confirmation) and one-click preset shapes (3/4/6-vertex regular
  polygons centred on the clicked cell). Vertex drag is supported for
  post-creation adjustment.
- **Polygon fill.** On confirmation or vertex edit, calls
  `h3.polygonToCellsExperimental(vertices, 15, containmentOverlapping)` to
  derive the interior cell set for display. Only the vertex cells are
  persisted; the fill is recomputed at load time.
- **Property editor panel.** Context-aware: shows map metadata (name,
  description, elevation, bounding-box, movement rules) when nothing is
  selected; shows type and editable properties when a tile, polygon, portal,
  or item is selected. For polygons, `name` and `description` are required
  fields — the editor marks them invalid and blocks export until both are
  filled. A **Session Room** checkbox toggles the `SessionRoom` label on the
  polygon node, signalling to the world server that the polygon is
  claimable/yieldable.
- **Layer panel.** Toggle visibility (eye icon) and editability (lock icon)
  per layer. Layers can be renamed, added, removed, and reordered.
- **Tile type palette.** Define tile types with name, description, capacity,
  and CSS style. The built-in "Floor" type is immutable. Paint cells by
  selecting a type and clicking; eraser mode removes individual cells.
- **Item type palette.** Define item types with name, description, glyph
  (Unicode character), takeable flag, capacityCost, and style. Place
  instances on tile cells.
- **Portal tool.** Click a source cell (SELECT_PORTAL_FROM), then a
  destination cell (CREATE_PORTAL) to create a typed directed Portal element
  in the active tile layer. Portal `mode` is editable in the property panel.
- **Export to `.map.gram`.** Serialises the full map — header, types, layers,
  instances, polygons (vertices only), portals, movement rules — to gram
  format for download.
- **Import from `.map.gram`.** Parses via `@relateby/pattern`, restores all
  types and layers, recomputes polygon fills from vertex cells. Emits import
  warnings for unrecognised fields.
- **GeoJSON import (deferred).** Import an external GeoJSON polygon (e.g. from
  OpenStreetMap) as a starting polygon shape. Deferred because imported
  polygons will require vertex adjustment to snap to H3 cells — a workflow that
  needs its own design.

## Open Questions

1. **Polygon vertex adjustment workflow.** When a GeoJSON polygon is imported,
   its vertices will rarely fall on H3 cell centroids. The correct snapping
   workflow needs its own design. Deferred — GeoJSON import is out of scope
   for this RFC.

2. **Shared tile type palette.** Tile types are defined per map, which means
   multi-floor venues will repeat the same type definitions across map files.
   A shared palette mechanism is deferred until per-map duplication becomes
   a practical burden.

3. **Pentagon cell portal authoring.** The 12 H3 pentagon cells are permanent
   global portals in ghost world cosmology (RFC-0004). Their authoring
   affordances are deferred — pentagon cells are not reachable in the MVP
   conference floor maps.

4. **`.world.gram` editor.** Assembling a world from multiple maps is deferred.
   The editor targets single-map authoring for MVP.

5. **Movement rules authoring.** The current implementation auto-generates one
   self-traversal rule per tile type and exposes the full rule set as read-only
   in the property panel. Whether authors should be able to add cross-type
   traversal rules (e.g. agents on `CarpetedFloor` can enter `StagedArea`) is
   not decided. A full movement-rules editor is deferred.

6. **Undo/redo.** There is no undo system. Import-save-reload is the current
   recovery path. A history stack would significantly improve authoring
   ergonomics at venue scale but is deferred for MVP.

## Alternatives

**Continue extending the Tiled workflow.** The `tmj-to-gram` converter already
handles polygons and items. Additional features (portals, elevation) could be
encoded as Tiled custom properties or object layers. Rejected: every new
feature requires a Tiled encoding convention and a converter rule. At venue
scale, the coordinate translation errors accumulate. The Tiled bridge served
its purpose bootstrapping the sandbox maps; this RFC retires it. Existing
`.tmj` files are not imported into the native editor — the sandbox `.map.gram`
files produced by the converter are the migration artifact.

**Author `.map.gram` by hand.** The gram format is human-readable and could be
edited in a text editor. Rejected for venue-scale maps: Moscone West has
thousands of cells. Manual H3 index entry is error-prone and offers no spatial
feedback. A visual editor is essential.

**Adopt an existing GIS editor (QGIS, Felt, etc.).** GIS tools support polygon
drawing on real-world maps and GeoJSON export. Rejected: GIS tools produce
geographic coordinates, not H3 indices. The translation step from GeoJSON to
H3 is non-trivial at polygon boundaries and still requires the vertex-snap
problem to be solved. A purpose-built editor that works natively in H3
coordinates eliminates this class of error entirely.

**Build the editor from scratch.** A clean-room implementation was initially
expected to fork [h3-viewer](https://github.com/JosephChotard/h3-viewer).
In practice the implementation was built on MapLibre GL 5 directly, which
gave finer control over hex rendering and layer interaction. h3-viewer
provided useful reference for H3 index accumulation patterns but was not
forked.
