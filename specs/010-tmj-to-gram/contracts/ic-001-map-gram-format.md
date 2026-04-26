# IC-001: `.map.gram` Format Contract

**Contract ID**: IC-001  
**Feature**: `010-tmj-to-gram`  
**Related RFC**: `proposals/rfc/0009-map-format-pipeline.md`  
**Related ADR**: `proposals/adr/0005-h3-native-map-format.md`

## Purpose

Defines the gram structure produced by `tools/tmj-to-gram` and consumed by `MapService` (validation), the HTTP endpoint (serving), and the intermedium (rendering). A gram that conforms to this contract can be parsed with `@relateby/pattern` and round-tripped through the conversion pipeline.

## Document Structure

A `.map.gram` file is a valid gram document. Nodes and edges appear in the following order, separated by blank lines for readability. The order within each section is deterministic (see Determinism below).

### 1. Document Header Record

A single property record at the top of the file:

```
{ kind: "matrix-map", name: "<mapId>", elevation: <number> }
```

| Field | Type | Description |
|---|---|---|
| `kind` | `"matrix-map"` | Fixed discriminant. Always this value. |
| `name` | string | The `mapId`. MUST match the filename stem (e.g. `freeplay` for `freeplay.map.gram`). |
| `elevation` | number | Map elevation layer. Defaults to 0 when not set in the `.tmj`. |

### 2. TileType Definitions

One node per unique tile type encountered in the source map (from `layout` layer or `tile-area` objects):

```
(<typeId>:TileType:<TileTypeLabel> { name: "<name>", color: "<hex>" })
```

| Field | Present when | Description |
|---|---|---|
| `name` | always | Human-readable tile type name. Equals the Tiled tile `type` value. |
| `color` | only if present in `.tsx` | Hex color string (e.g. `"#4a7c59"`). Omitted when not authored. |

`<typeId>` is derived from the tile type label by lower-casing and replacing spaces/special characters with hyphens. `<TileTypeLabel>` is the tile `type` value verbatim (CamelCase as authored in Tiled).

### 3. ItemType Definitions

One node per entry in the `*.items.json` sidecar:

```
(<itemRef>:ItemType:<ItemTypeLabel> { name: "<name>", color: "<hex>", glyph: "<char>" })
```

| Field | Present when | Description |
|---|---|---|
| `name` | always | Human-readable item name from sidecar. |
| `color` | only if in sidecar | Hex color string. |
| `glyph` | only if in sidecar | Single display character. |

`<ItemTypeLabel>` is the sidecar `itemClass` field (CamelCase).

### 4. Polygon Area Nodes

One node per `tile-area` object from the source map (sorted by Tiled object `id`):

```
[<id>:Polygon:<TileTypeLabel> | <vertexRef1>, <vertexRef2>, ..., <vertexRefN>]
```

- `<id>` is derived from the Tiled object `id` with a `poly-` prefix (e.g. `poly-42`).
- `<TileTypeLabel>` matches the object's Tiled `type` field.
- Each `<vertexRefK>` is a **Gram identifier** that resolves to a tile instance defined elsewhere in the same file (typically `cell-<h3Index>` when that cell is emitted on the `layout` layer, or `poly-<id>-v<i>` for a vertex-only stub when the layout cell is suppressed by compression).
- Vertex order follows Tiled vertex order (clockwise for rectangles).
- A rectangle shape produces exactly 4 vertex references; a polygon shape produces N.

### 5. Individual Tile Cell Nodes

One node per painted cell on the `layout` layer, excluding cells suppressed by the compression rule, **plus** optional `poly-<id>-v<i>` vertex stubs so every polygon vertex reference has a definition:

```
(<id>:<TileTypeLabel> { location: h3`<hex>` })
```

- `<id>` is `cell-<h3Index>` for layout cells, or `poly-<tile-area-object-id>-v<vertexIndex>` for vertex-only stubs.
- `location` uses the **`h3` tagged string** form: `h3` followed by backticks around the lowercase H3 index string (no `0x` prefix inside the tag content; optional `0x` is stripped by consumers for compatibility).
- Cells whose H3 lies in a tile-area’s **shape cover** (`h3.polygonToCells` on the vertex ring, **plus** every vertex hex) and whose tile type matches that area’s type are **not** emitted as redundant `cell-*` (the polygon is authoritative). Cells whose tile type differs from an enclosing tile-area's type **are** emitted (override).

### 6. Item Instance Nodes

One node per painted cell on any `item-placement` layer:

```
(<id>:<ItemTypeLabel> { location: h3`<hex>` })
```

- `<id>` is `item-<h3Index>-<itemRef>`.
- `<ItemTypeLabel>` is derived from the sidecar entry for this `itemRef`.

## Determinism

Output MUST be byte-stable for the same input across runs and machines:

- Individual tile cell nodes are emitted in ascending lexical H3-index order.
- Item instance nodes are emitted in ascending lexical `itemRef` order, then ascending lexical H3-index order within the same `itemRef`.
- `TileType` definitions are emitted in the order their type label is first encountered (layout layer cells in H3 lexical order, then tile-area objects in id order).
- `ItemType` definitions are emitted in ascending lexical `itemRef` order matching the sidecar key order.
- `Polygon` nodes are emitted in ascending Tiled object `id` order.

## Validation Rules

`MapService.validate()` checks these invariants at startup:

1. The document parses without error using `@relateby/pattern`.
2. The `name` field in the header record matches the filename stem.
3. Every `location` in cell and item nodes is an `h3\`…\`` tagged string (or legacy quoted string) whose content decodes to a valid H3 cell index at resolution 15 (`h3.isValidCell` returns true and `h3.getResolution` returns 15).
4. Every `<TileTypeLabel>` referenced in a cell or polygon node has a corresponding `TileType` definition in the same document.
5. Every `<ItemTypeLabel>` referenced in an item instance node has a corresponding `ItemType` definition in the same document.

## Example Fragment

```
{ kind: "matrix-map", name: "freeplay", elevation: 0 }

(grass:TileType:Grass { name: "Grass" })
(path:TileType:Path { name: "Path", color: "#c8b46a" })
(pillar:TileType:Pillar { name: "Pillar", color: "#888888" })

(sign-welcome:ItemType:SignWelcome { name: "Welcome Board", glyph: "📋" })

[poly-42:Polygon:Grass | cell-8f2830828047d9f, cell-8f2830828047c9f, cell-8f28308280455af, cell-8f28308280456af]

(cell-8f2830828047d9f:Path { location: h3`8f2830828047d9f` })
(cell-8f2830828047c9f:Grass { location: h3`8f2830828047c9f` })
(cell-8f28308280455af:Pillar { location: h3`8f28308280455af` })
(cell-8f28308280456af:Grass { location: h3`8f28308280456af` })

(item-8f2830828047d9f-sign-welcome:SignWelcome { location: h3`8f2830828047d9f` })
```

## Consumers

| Consumer | Format access | Notes |
|---|---|---|
| `MapService.validate()` | Parse at startup | Structural integrity check only; no `LoadedMap` produced |
| `GET /maps/:mapId?format=gram` | Byte stream (no parse) | Served as `text/plain; charset=utf-8` |
| Intermedium (RFC-0008) | HTTP + `@relateby/pattern` | Parses gram, expands polygons via `h3.polygonToCells` |
| `tools/tmj-to-gram` tests | Parse after conversion | Layer 1 structural invariant checks |
| CI byte-equality step | Raw bytes | Compared against committed file |
