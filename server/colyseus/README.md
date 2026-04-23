# server/colyseus

Authoritative `MatrixRoom` for the Minimal PoC hex sandbox.

## Spectator room schema (IC-004)

Defined in [`src/room-schema.ts`](./src/room-schema.ts) and described in [`specs/001-minimal-poc/contracts/spectator-state.md`](../../specs/001-minimal-poc/contracts/spectator-state.md).

| Field | Meaning |
|-------|---------|
| `ghostTiles` | `MapSchema<string>` — ghost id → occupied tile id (`col,row`). Mutated only after an accepted `world-api` move. |
| `tileCoords` | `MapSchema<TileCoord>` — tile id → offset column/row (static; filled at room creation from the Tiled-derived graph). |
| `tileClasses` | `MapSchema<string>` — tile id → Tiled tile **`type`** string (static; optional styling for Phaser). |
| `tileItemRefs` | `MapSchema<string>` — H3 cell → comma-separated `itemRef` list on the ground (IC-012). |
| `itemGlyphs` | `MapSchema<string>` — `itemRef` → short spectator label from optional `ItemDefinition.glyph` in the items sidecar (filled at room creation). |

Phaser spectators join the room read-only over WebSocket; they must not send move RPCs.
