# IC-009: `.tmj` Map File Schema Extension

**Contract ID**: IC-009  
**Feature**: 005-h3-coordinate-system  
**Status**: Draft  
**Consumers**: `server/colyseus` (mapLoader.ts), Map authors (Tiled editor)

---

## Summary

Tiled `.tmj` map files gain two custom map-level properties that anchor the Tiled grid to the H3 geospatial coordinate system. Existing properties and layers are unchanged.

---

## New Map-Level Custom Properties

Tiled stores custom map properties in the `properties` array at the root of the `.tmj` JSON:

```json
{
  "width": 13,
  "height": 9,
  "tilesets": [...],
  "layers": [...],
  "properties": [
    {
      "name": "h3_anchor",
      "type": "string",
      "value": "8f2830828052d25"
    },
    {
      "name": "h3_resolution",
      "type": "int",
      "value": 15
    }
  ]
}
```

---

## Property Definitions

| Property | Tiled Type | Required | Default | Constraints |
|---|---|---|---|---|
| `h3_anchor` | string | **Yes** | — | Valid H3 index; resolution must be 15 |
| `h3_resolution` | int | No | `15` | If present, must equal `15` |

---

## Validation Rules (enforced by `mapLoader.ts`)

1. `properties` array exists in the `.tmj` file.
2. An entry with `name: "h3_anchor"` and `type: "string"` exists.
3. `h3.isValidCell(h3_anchor)` returns `true`.
4. `h3.getResolution(h3_anchor) === 15`.
5. If `h3_resolution` is present, its integer value equals `15`.

Failure of any rule causes `loadHexMap` to throw a `MapLoadError` with a message indicating which validation failed.

---

## Author Workflow

To set the anchor for a map:

1. Find the real-world lat/lng for the physical location that corresponds to Tiled column 0, row 0 (typically the northwest corner of the venue floor being mapped).
2. Convert to H3 res-15 index:
   ```javascript
   const { latLngToCell } = require("h3-js");
   const anchor = latLngToCell(lat, lng, 15);
   // e.g. "8f2830828052d25"
   ```
3. In Tiled: open the map's Properties panel → Custom Properties → add string property `h3_anchor` with that value.
4. Optionally add int property `h3_resolution` with value `15` for documentation clarity.

---

## Example: `maps/sandbox/freeplay.tmj`

The existing sandbox map at `maps/sandbox/freeplay.tmj` (13×9 grid) must have `h3_anchor` added before the server can load it in H3 mode. A synthetic anchor value suitable for testing can be generated from any valid lat/lng (e.g., the AI Engineer World's Fair venue coordinates).

---

## Downstream: `maps/` Directory Policy

All `.tmj` maps in the `maps/` directory MUST have a valid `h3_anchor` property after this feature is merged. Maps without an anchor will fail to load. A CI check or pre-commit hook should validate `h3_anchor` presence in all `.tmj` files.
