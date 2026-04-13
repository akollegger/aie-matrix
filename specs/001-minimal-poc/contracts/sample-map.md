# Contract: Sample hex map (Tiled → server → Phaser)

**IC-005**

## Files

- Root under `maps/` (paths to be listed in root README when assets land).
- Formats: `.tmj` / `.tsx` / referenced `.png` as needed.

## Tile requirements (map only)

The map **does not** embed movement policy. It **MUST** supply geometry plus per-tile metadata the world loads so a **separate movement ruleset** in `world-api` can evaluate proposed steps (see RFC-0001 and [ghost-mcp.md](./ghost-mcp.md)).

Each navigable tile definition **MUST** expose:

- Stable **cell identity** consistent between server graph and client rendering (grid coordinates plus any exported local tile id / GID needed for drawing).
- **`tileClass` string**: authoritative value is Tiled’s **tile `type`** on each `<tile>` in the tileset (`.tsx`). Loaders **MUST** treat `type` as the class label passed to the ruleset and tools.

**Optional metadata (PoC):** Maps MAY attach any custom properties (for example **`capacity`**) for authoring continuity or future rules. **Nothing in the PoC requires `capacity` on every tile, startup validation of `capacity`, or move rejection based on `capacity`.**

**Ruleset reminder:** venue behavior comes from **tile placement + configured rules**, not from special-casing individual properties on the map file. The reference sandbox may use arbitrary labels (for example color tiers) while the PoC ships a permissive default ruleset.

## Neighbor semantics

Adjacency matches **flat-top** hex connectivity decided in [research.md](../research.md); diagonal edges forbidden unless explicitly authored as neighbors.

## Failure modes

Missing **required** metadata for the PoC (currently: **`type`** / class on tiles that appear on navigable layers) → **hard fail at server startup** with actionable error (spec edge cases). Missing optional custom properties (including `capacity`) is **not** a startup failure.
