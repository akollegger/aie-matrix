# Contract: Sample hex map (Tiled → server → Phaser)

**IC-005**

## Files

- Root under `maps/` (paths to be listed in root README when assets land).
- Formats: `.tmj` / `.tsx` / referenced `.png` as needed.

## Tile requirements

Each navigable tile **MUST** expose:

- Stable **tile id** consistent between server graph and client rendering
- `tileClass` custom property with one of: `hallway`, `session-room`, `vendor-booth` (PoC)
- **Capacity** semantics for `session-room` per movement rules in RFC

## Neighbor semantics

Adjacency matches **flat-top** hex connectivity decided in [research.md](../research.md); diagonal edges forbidden unless explicitly authored as neighbors.

## Failure modes

Missing required metadata → **hard fail at server startup** with actionable error (spec edge cases).
