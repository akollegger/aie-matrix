# Data Model: .map.gram Format Migration

**Branch**: `013-gram-format-migration` | **Date**: 2026-05-03

## Overview

The shared `@aie-matrix/map-gram` package defines the canonical data model that results from parsing a `.map.gram` file. Downstream consumers (Colyseus, intermedium) adapt this model to their own existing interfaces.

---

## `ParsedMap` — Top-level parse result

Represents the complete state of a single `.map.gram` floor.

| Field | Type | Source in gram | Notes |
|---|---|---|---|
| `name` | `string` | root record `name` property | e.g., `"canonical-example"` |
| `elevation` | `number` | root record `elevation` property | defaults to `0` |
| `tileTypes` | `Map<string, TileTypeDef>` | nodes labelled `:TileType` | keyed by node identity (e.g., `"floor"`) |
| `itemTypes` | `Map<string, ItemTypeDef>` | nodes labelled `:ItemType` | keyed by node identity |
| `cells` | `Map<string, ParsedCell>` | polygon + tile layer contents, expanded | keyed by H3 index (res-15, lowercase hex) |
| `portals` | `ParsedPortal[]` | `:Portal` nodes in tile layers | in declaration order |
| `rules` | `ParsedRule[]` | `:Rules` walk | in declaration order |

**Validation rules**:
- `name` must be non-empty
- A `LayerStack` must exist; its referenced layer IDs must all be resolvable
- Polygon vertex lists must have 3–6 elements
- All H3 indices must pass `h3.isValidCell()`

---

## `ParsedCell` — A single navigable cell

Produced by expanding polygon fills and applying tile overrides. One entry per unique H3 cell in the map.

| Field | Type | Notes |
|---|---|---|
| `h3Index` | `string` | H3 resolution-15 cell, lowercase hex |
| `tileType` | `string` | TypeName label (e.g., `"Floor"`, `"Pillar"`) — preserves case from gram |
| `items` | `string[]` | ItemType names placed at this cell (e.g., `["BrassKey"]`) — empty if none |

**Layer application order** (LayerStack, from bottom to top):
1. Polygon layers — fill all cells within the polygon boundary with the polygon's tile type
2. Tile layers — override individual cells; a tile element at an H3 index replaces whatever the polygon layer assigned
3. Items layers — attach item names to cells; does not change `tileType`

Items placed on an H3 index with no tile or polygon entry create an implicit cell with `tileType: "open"`.

---

## `TileTypeDef` — A declared tile type

| Field | Type | Source |
|---|---|---|
| `identity` | `string` | node identity (e.g., `"floor"`) |
| `name` | `string` | `name` property |
| `description` | `string \| undefined` | `description` property |
| `capacity` | `number \| undefined` | `capacity` property |
| `style` | `string \| undefined` | `style` css-tagged string content |

---

## `ItemTypeDef` — A declared item type

| Field | Type | Source |
|---|---|---|
| `identity` | `string` | node identity (e.g., `"brassKey"`) |
| `name` | `string` | `name` property |
| `description` | `string \| undefined` | `description` property |
| `glyph` | `string \| undefined` | `glyph` char-tagged string content |
| `takeable` | `boolean \| undefined` | `takeable` property |
| `capacityCost` | `number \| undefined` | `capacityCost` property |

---

## `ParsedPortal` — A non-adjacent traversal link

| Field | Type | Notes |
|---|---|---|
| `fromCell` | `string` | first H3 index in the `geometry` array |
| `toCell` | `string` | second H3 index in the `geometry` array |
| `mode` | `string` | e.g., `"Door"`, `"Stairs"`, `"Teleporter"` |

Portals are preserved in `ParsedMap.portals` but not applied to `cells`. Consumers that implement non-adjacent routing or visual indicators should read this list.

---

## `ParsedRule` — A permitted tile-type transition

| Field | Type | Notes |
|---|---|---|
| `fromType` | `string` | source TileType node identity |
| `toType` | `string` | target TileType node identity |

Rules are preserved in `ParsedMap.rules` but not enforced by the parser. Consumers that implement A\* pathfinding or movement validation should read this list.

---

## Consumer Adaptations

### Colyseus `CellRecord` (unchanged interface)

`mapLoader.gram.ts` maps `ParsedCell` → `CellRecord`:

| CellRecord field | Derived from |
|---|---|
| `col` | `0` (Tiled artefact; unused by routing) |
| `row` | `0` (Tiled artefact; unused by routing) |
| `h3Index` | `ParsedCell.h3Index` |
| `tileClass` | `ParsedCell.tileType` |
| `neighbors` | computed by `assignCompassToNeighbors` from `hexCompass.ts` against the set of all cells in `ParsedMap.cells` |
| `capacity` | `ParsedMap.tileTypes.get(tileType)?.capacity` |
| `initialItemRefs` | `ParsedCell.items` |

`LoadedMap.anchorH3` is set to `min(...parsedMap.cells.keys())` (lexicographic minimum H3 index).

### Intermedium `WorldTile` (unchanged interface)

`gramParser.ts` maps `ParsedCell` → `WorldTile`:

| WorldTile field | Derived from |
|---|---|
| `h3Index` | `ParsedCell.h3Index` |
| `tileType` | `ParsedCell.tileType[0].toLowerCase() + tileType.slice(1)` (e.g., `"Floor"` → `"floor"`) |
| `items` | `Object.freeze([...ParsedCell.items])` |
| `neighbors` | `h3.gridDisk(h3Index, 1).filter(c => c !== h3Index)` — all 6 topological neighbors, regardless of map occupancy |

---

## State Transitions

The parser is stateless. There are no mutable state transitions. The LayerStack defines a deterministic application order that is applied once at parse time to produce the final `cells` map.

```
gram text
  │
  ▼
Gram.parse() → Pattern<Subject>[]
  │
  ├─► extract TileType declarations
  ├─► extract ItemType declarations
  ├─► extract Layer contents (polygon / tile / items)
  ├─► resolve LayerStack order
  │
  ▼
apply layers in order:
  1. polygon layers → expand vertices to fill cells
  2. tile layers → override individual cells
  3. items layers → attach items to cells
  │
  ▼
ParsedMap { cells, portals, rules, tileTypes, itemTypes }
```
