# Contract: `.map.gram` Format

**Feature**: `012-h3geojson-map-editor`  
**Consumers**: map editor (save/load), game engine (map loader), world server (save/serve maps)  
**Version**: RFC-0010

A `.map.gram` file is valid UTF-8 gram notation. The format is GeoJSON-inspired: all spatial elements carry a `geometry` property holding a non-empty array of H3 cell indices, and the array length encodes the element's spatial semantics. Elements live as anonymous inline patterns inside named Layer walks.

Sections appear in order: header, type definitions, layers, layer stack.

---

## 1. Header (required)

```gram
{ kind: "matrix-map", name: "<identifier>", elevation: <integer> }
```

- `kind` MUST be `"matrix-map"`
- `name` MUST be a gram identifier (alphanumeric + hyphens, no spaces)
- `description` optional string
- `elevation` integer; defaults to `0` if omitted on import

---

## 2. Type Definitions (zero or more)

Named standalone nodes defining the types used by spatial elements.

### Tile Type

```gram
(<id>:TileType:<TypeName> { name: "<display name>", style: css`<css-expression>` })
```

- `TileType` MUST appear as the first label after id; `<TypeName>` is used in tile and polygon elements
- `style`, `description`, `capacity` are optional

### Item Type

```gram
(<id>:ItemType:<TypeName> { name: "<display name>", glyph: char`<char>`, takeable: <bool> })
```

- `glyph`, `description`, `capacityCost`, `style` are optional

---

## 3. Layers (zero or more)

Each layer is a named walk with a `kind` property and a sequence of anonymous inline element patterns:

```gram
[<id>:Layer {kind: "<kind>"} | <elem1>, <elem2>, ...]
```

Layer `kind` values: `"polygon"`, `"tile"`, `"items"`.

### Spatial Elements

All elements use the `geometry` property — a non-empty array of H3 cell indices. The array length encodes the spatial semantics:

| Array length | Element label | Meaning |
|---|---|---|
| 1 | `Tile` or `Item` | point in space |
| 2 | `Portal` | directed connection (from → to) |
| ≥ 3 | `Polygon` | filled region boundary |

Label convention: category label first (`Tile`, `Polygon`, `Item`), then type label (`Floor`, `BrassKey`, …).

#### Tile (point, explicit single cell)
```gram
(:Tile:<TypeName> { geometry: [h3`<h3index>`] })
```

#### Polygon (filled region, minimum 3 vertices)
```gram
(:Polygon:<TypeName> { geometry: [h3`<v0>`, h3`<v1>`, h3`<v2>`] })
```
Interior cells derived by consumer via `h3.polygonToCells`. Override tiles in the same region are separate `Tile` elements, typically in a higher-priority layer.

#### Portal (directed connection)
```gram
(:Portal { geometry: [h3`<from>`, h3`<to>`], mode: "<mode>" })
```
`mode` suggested values: `"Door"`, `"Elevator"`, `"Stairs"`, `"Teleporter"`.  
`geometry[0]` is the source cell, `geometry[1]` is the target cell.

#### Item (placed item instance)
```gram
(:Item:<TypeName> { geometry: [h3`<h3index>`] })
```

### Layer kinds

- `"polygon"` layers hold `Polygon` elements defining filled regions.
- `"tile"` layers hold explicit `Tile` overrides and `Portal` connections.
- `"items"` layers hold `Item` instances.

Multiple layers of the same kind are allowed. Layer ordering (see §4) determines rendering priority: **the topmost layer that defines a cell is the effective tile at that location**.

---

## 4. Layer Stack (zero or one)

```gram
[layers:LayerStack | <layer-id-1>, <layer-id-2>, ...]
```

- Identity MUST be `layers`
- Elements are references to Layer walk identities, ordered **bottom to top**
- The topmost layer (last in the list) has the highest rendering priority
- Consumers use this ordering to resolve `resolveTileAt(h3)` queries
- This ordering is **normative for graph construction**, not just a rendering hint — the world server applies the same rule when expanding polygons into cell nodes and assigning tile types before pathfinding

---

## Full Example

```gram
{ kind: "matrix-map", name: "example", elevation: 0 }

(floor:TileType:Floor { name: "Floor", style: css`background: #c8b89a` })
(carpet:TileType:Carpet { name: "Carpet", style: css`background: #8b4513` })
(brassKey:ItemType:BrassKey { name: "Brass Key", glyph: char`🔑`, takeable: true })

[ground:Layer {kind: "polygon"} | (:Polygon:Floor { geometry: [h3`8f283082aa20c00`, h3`8f283082aa20c01`, h3`8f283082aa20c02`] })]
[carpet:Layer {kind: "polygon"} | (:Polygon:Carpet { geometry: [h3`8f283082aa20c01`, h3`8f283082aa20c02`, h3`8f283082aa20c03`] })]
[tiles:Layer {kind: "tile"} | (:Portal { geometry: [h3`8f283082aa20c00`, h3`8f283082aa20c01`], mode: "Door" })]
[collectibles:Layer {kind: "items"} | (:Item:BrassKey { geometry: [h3`8f283082aa20c00`] })]

[layers:LayerStack | ground, carpet, tiles, collectibles]
```

In this example, cells `8f283082aa20c01` and `8f283082aa20c02` appear in both `ground` and `carpet`. Because `carpet` is higher in the LayerStack, those cells render as Carpet.

---

## Tagged String Literals

| Tag | Meaning | Example |
|---|---|---|
| `h3\`...\`` | H3 cell index (resolution 15) | `h3\`8f283082aa20c00\`` |
| `css\`...\`` | CSS expression | `css\`background: #c8b89a\`` |
| `char\`...\`` | Single Unicode character | `char\`🔑\`` |
| `url\`...\`` | Resource path | `url\`maps/moscone/west.map.gram\`` |
