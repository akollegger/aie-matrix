# server/world-api

MCP `world-api` (ghost tools) lives here. For the PoC it calls Colyseus **in-process** via `colyseus-bridge.ts` (see `specs/001-minimal-poc/research.md`).

## Ghost hex compass (flat-top, `staggeraxis: x`, `staggerindex: odd`)

Ghosts use **local** compass tokens `n`, `s`, `ne`, `nw`, `se`, `sw` — never arbitrary map tile ids.

We model the Tiled staggered grid as **odd-q axial** (column = axial `q`, row derived from `r`):

- `oddqOffsetToAxial(col, row)` → `{ q: col, r: row - (col - (col & 1)) / 2 }`
- `axialToOddqOffset(q, r)` → `{ col: q, row: r + (q - (q & 1)) / 2 }`

Axial neighbor deltas (apply in axial space, then convert back to offset):

| Compass | `Δq` | `Δr` |
|---------|------|------|
| `ne`    | +1   | 0    |
| `n`     | +1   | −1   |
| `nw`    | 0    | −1   |
| `sw`    | −1   | 0    |
| `s`     | −1   | +1   |
| `se`    | 0    | +1   |

`server/colyseus` uses the same table (`COMPASS_AXIAL_DELTA`) so `exits`, `go`, and `look` stay aligned with the loaded graph.
