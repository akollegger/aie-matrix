# RFC-0010: H3GeoJSON Map Format and Native Map Editor

**Status:** draft  
**Date:** 2026-04-28  
**Authors:** @akollegger  
**Related:** [ADR-0005](../adr/0005-h3-native-map-format.md) (H3-native map format),
[RFC-0004](0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0009](0009-map-format-pipeline.md) (map format pipeline)

## Summary

Define H3GeoJSON as the native geometry model for `.map.gram` and `.world.gram`,
and specify a browser-based map editor — forked from
[h3-viewer](https://github.com/JosephChotard/h3-viewer) — that authors maps
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
tiles are portals — authored as typed relationships in the portal layer, not
as geometry.

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

A map file contains five sections in order:

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

**4. Tile instances and shapes (H3GeoJSON geometry)**

Single tiles are point geometries. Regions are polygon geometries with an
ordered vertex list of H3 indices. Portals are relationships and are not
represented as geometry (see Portals below).

**5. Item instances**
```
(key1:BrassKey { location: h3`8f2800000000015` })
```

### Portals

A portal is a typed directed relationship between two existing tile references.
It does not imply or create tiles — it connects tiles that already exist.

```
// By reference (tiles defined elsewhere in the map)
(entrance)-[:Portal { mode: "Elevator" }]->(lobby)

// Inline (tiles defined at point of use)
(a:Tile { location: h3`8f28...` })-[:Portal { mode: "Stairs" }]->(b:Tile { location: h3`8f29...` })
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

The editor organises authoring into four layer types per map, each with a
distinct content type and interaction model:

**Polygon layer (zero or one per map).** Drawing surface for closed filled
regions only. Each polygon is assigned a tile type from the palette. Polygons
require a minimum of three vertices and are always closed — the editor
prevents open shapes and has no concept of points or lines in this layer.
On confirmation, `h3.polygonToCells` populates the tile layer with the
filled cell set.

**Tile layer (exactly one per map).** The canonical set of tile instances.
Populated by: polygon fill (from the polygon layer), direct cell painting, or
import from an existing `.tmj`. Individual cells are painted and erased here;
type overrides for cells inside polygons are also authored here. This layer is
what the game engine consumes.

**Portal layer (zero or one per map).** Directed traversal relationships
between pairs of existing tiles. Select two tiles and create a typed directed
Portal edge between them. Portals are relationships, not geometry — this layer
authors edges, not nodes. Portal `mode` (e.g. `"Elevator"`, `"Stairs"`,
`"Door"`) is set in the property editor.

**Item layer (zero or more per map).** Placement of item instances on tile
cells. Multiple item layers are supported (e.g. `furniture`, `spawn-points`,
`vendor-booths`). Each layer is independently toggleable.

| Layer | Count | Authors |
|---|---|---|
| Polygon | 0 or 1 | Closed filled regions (3+ vertices) |
| Tile | exactly 1 | Individual cell instances and type overrides |
| Portal | 0 or 1 | Directed traversal edges between tile pairs |
| Item | 0 or more | Item instances placed on tiles |

### Editor (h3-viewer fork)

The editor is a fork of
[JosephChotard/h3-viewer](https://github.com/JosephChotard/h3-viewer), which
already provides H3 cell rendering on an OpenStreetMap/Mapbox base, multi-cell
selection, and H3 index accumulation. The fork adds:

- **Polygon draw mode.** Click to place vertices; the editor snaps each vertex
  to the nearest H3 cell centroid. The polygon closes automatically on
  confirmation. Minimum three vertices enforced.
- **Polygon fill.** On confirmation, calls `h3.polygonToCells` to derive the
  interior cell set. The tile layer is populated from this set.
- **Property editor panel.** Select a cell, polygon, or item to inspect and
  edit its type and properties.
- **Layer panel.** Toggle visibility and editability of polygon, tile, portal,
  and item layers.
- **Tile type palette.** Define tile types with name, description, capacity,
  and style. Paint cells by selecting a type and clicking.
- **Item type palette.** Define item types with name, description, glyph,
  takeable, and capacityCost. Place instances on tile cells.
- **Portal tool.** Select two cells and create a typed directed Portal
  relationship between them.
- **Export to `.map.gram`.** Serialise the full map to H3GeoJSON-based gram
  format. Import from `.map.gram` for continued editing.
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

**Build the editor from scratch.** A clean-room implementation would have no
dependency on the h3-viewer codebase. Rejected: the h3-viewer already provides
the hardest parts — H3 rendering on a real-world map base, multi-cell
selection, and H3 index export. Forking gives immediate visual feedback during
development and a working baseline to validate design decisions against real
geography.
