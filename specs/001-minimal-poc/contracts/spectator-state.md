# Contract: Spectator state (Phaser / Colyseus)

**IC-004** — Read-only browser clients consume Colyseus room state via WebSocket sync.

## Minimum payload

Sufficient for Phaser to render:

- Hex (or offset) coordinates per tile id mapping
- List or map of **ghost id → tile id** (or equivalent positions)
- Optional tile class for styling (if not inferred client-side from static map)

## Rules

- No write or move RPC from Phaser to world in PoC.
- Updates arrive as authoritative patches after accepted moves only.

Exact room schema: document in `server/colyseus/` README and mirror here when stabilized.
