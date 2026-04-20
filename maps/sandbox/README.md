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
