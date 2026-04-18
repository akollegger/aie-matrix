# IC-005: CellRecord Schema — H3 Index Addition

**Contract ID**: IC-005  
**Feature**: 005-h3-coordinate-system  
**Status**: Draft  
**Consumers**: `server/world-api` (movement, exits, look), `server/colyseus` (MatrixRoom, broadcast), `ghosts/tck`

---

## Summary

`CellRecord` gains a required `h3Index` field. The `neighbors` values change from `"col,row"` strings to H3 res-15 index strings. `col` and `row` are retained as metadata. `CellId` is no longer a template-literal type.

---

## Schema

```typescript
// In: server/colyseus/src/mapTypes.ts

/** H3 resolution-15 index string, e.g. "8f2830828052d25" */
export type CellId = string;

export interface CellRecord {
  col: number;       // Tiled column (retained for authoring/diagnostics)
  row: number;       // Tiled row (retained for authoring/diagnostics)
  h3Index: string;   // Canonical cell identity — H3 res-15 index
  tileClass: string; // Tiled tile type attribute value
  neighbors: Partial<Record<Compass, string>>;  // values are h3Index strings; 5 entries for pentagon cells
}

export interface LoadedMap {
  width: number;
  height: number;
  cells: Map<string, CellRecord>;  // key = h3Index
  anchorH3: string;                // H3 index of Tiled (col=0, row=0)
}
```

---

## Invariants

1. `CellRecord.h3Index` is a valid H3 string at resolution 15: `h3.isValidCell(h3Index) && h3.getResolution(h3Index) === 15`.
2. Every entry in `CellRecord.neighbors` is the `h3Index` of a valid H3 cell at resolution 15.
3. `LoadedMap.cells` keys are identical to the `h3Index` field of their value.
4. Pentagon cells have at most 5 entries in `neighbors`; all other cells have at most 6.
5. `col` and `row` are read-only after map load; they MUST NOT be used for graph traversal.

---

## Migration Impact

| Consumer | Change Required |
|---|---|
| `mapLoader.ts` | Derive `h3Index` from anchor; build `cells` map keyed by `h3Index` |
| `hexCompass.ts` | Replace `neighborOddq` with bearing-based compass assignment |
| `movement.ts` (`evaluateGo`) | Cell lookup changes from `"col,row"` key to `h3Index` key; neighbor values are now H3 strings |
| `MatrixRoom.ts` | `ghostCellByGhostId` values change to H3 index strings |
| `mcp-server.ts` (`whereami`) | Return `h3Index` instead of `tileId`; retain `col`/`row` as supplemental fields |
| `ghosts/tck` | Update expected cell ID format in contract tests |
| `client/phaser` | `tileCoords` map remains populated from `col`/`row`; no immediate change required |
