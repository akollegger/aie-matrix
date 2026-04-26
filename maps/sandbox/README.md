# Sandbox maps

## H3 anchor (`h3_anchor`)

Hex maps in this repo use [H3](https://h3geo.org/) resolution **15** as the canonical cell identity. Each `.tmj` map must declare where the Tiled grid sits on the globe.

### In Tiled

1. Open the `.tmj` map.
2. **Map → Map Properties → Custom Properties**.
3. Add:
   - **`h3_anchor`** (string): an H3 index at resolution 15 for the cell that corresponds to **column 0, row 0** of the map’s tile layer (the IJ origin used by `h3-js`’s `localIjToCell`).
   - **`h3_resolution`** (int): must be **`15`**. (Other resolutions are rejected at load time.)

Save the `.tmj` file. If `h3_anchor` is missing, invalid, or not a res-15 index, the server throws `MapLoadError` with the map file name and fix hints.

### Generate an anchor from lat/lng

From the repo root (after `pnpm install`):

```bash
node -e "const {latLngToCell} = require('h3-js'); console.log(latLngToCell(37.7749, -122.4194, 15));"
```

Use coordinates for the real-world position that should align with tile (0, 0). See `specs/005-h3-coordinate-system/quickstart.md` for the full smoke-test flow.

### What `h3_resolution` means

It documents the H3 resolution used for this map. Only **15** is supported: cell IDs in the runtime and registry are res-15 index strings.

## World item authoring

Startup items come from an `*.items.json` **sidecar** plus optional tile layer(s) whose Tiled **class** is **`item-placement`**. The live server can still hold **multiple** items per H3 cell (e.g. after `take`/`drop`); the map authors **one item per painted cell** per layer (multiple layers stack in file order).

### `*.items.json` sidecar

`freeplay.items.json` is a JSON object keyed by `itemRef`:

```json
{
  "sign-welcome": {
    "name": "Welcome Board",
    "itemClass": "Sign",
    "carriable": false,
    "capacityCost": 0
  }
}
```

The server loads this file automatically when it sits next to the active `.tmj` map, or from `AIE_MATRIX_ITEMS` when that env var is set.

### Layer classes (Tiled): `layout` and `item-placement`

Layers are picked by **Tiled layer class**, not layer order or free-form names:

1. **Exactly one** tile layer must have class **`layout`** — the navigable hex grid (`color-set.tsx` tiles, `capacity`, etc.).
2. **Zero or more** tile layers may have class **`item-placement`**. If you use several, they are read **in `.tmj` layer array order** (first layer’s items appended before the next); each non-empty cell appends that tile’s `itemRef` to the cell’s startup list.

For map-defined items:

1. Add a **second external tileset** (e.g. `common-item-set.tsx`) whose tiles exist only to represent items: each tile’s **type** in the tileset must **equal** the `itemRef` string in the sidecar (`key-brass`, `info-sign`, …). See `maps/sandbox/common-item-set.tsx` and the companion `common.items.json` when you want one shared definition set for several maps (override with `AIE_MATRIX_ITEMS` or a co-located `<map-name>.items.json`).
2. Reference both tilesets in the `.tmj` (`color-set` for terrain, item tileset with the next `firstgid`, typically `33` when the first tileset has `tilecount` `32`).
3. Give each item layer class **`item-placement`**, same width and height as the map. Paint one **item** tile per cell that should start with that item. Empty cells use tile `0` / eraser.

Terrain tiles (`color-set.tsx`) carry only gameplay fields such as **`capacity`**; item refs live on the item tileset used in `item-placement` layers.

## Tile-area polygons (compression + overrides)

`tile-area` **object layers** feed the `tmj-to-gram` converter (see [RFC-0009](../../proposals/rfc/0009-map-format-pipeline.md)). Conventions:

1. **Layer class** — use Tiled layer **class** `tile-area` (objects are rectangles or closed polygons; **ellipses are rejected** with exit code 2).
2. **Object `type`** — must match a **tile type label** from your `.tsx` (e.g. `Red`, `Blue`). Unknown types log `[warn]` but do not fail conversion.
3. **Vertex rule** — each vertex pixel must land inside a hex cell of the **`layout`** grid (same `h3_anchor`, `staggeraxis`, `staggerindex`, `tilewidth` / `tileheight` / `hexsidelength` as the map). Vertices in the gutter between hexes fail conversion.
4. **Non-overlap** — interiors of two `tile-area` objects must not share any H3 cell; overlap fails with both object ids.
5. **Compression** — interior cells whose `layout` tile **type matches** the area’s type are omitted as individual gram cell nodes (the polygon carries them). **Overrides** — if `layout` paints a **different** type inside the interior, that cell is still emitted as its own node.

Only **`staggeraxis: "x"`** is supported for tile-area math today (matches sandbox hex maps).

## Gram artifact regeneration

After editing a `.tmj` (or tilesets / sidecar):

```bash
pnpm tmj-to-gram convert maps/sandbox/<name>.tmj
```

Commit the updated `<name>.map.gram`. CI enforces byte equality:

```bash
pnpm --filter @aie-matrix/tmj-to-gram ci:golden
```
