# server/world-api

MCP `world-api` (ghost tools) lives here. For the PoC it calls Colyseus **in-process** via `colyseus-bridge.ts` (see `specs/001-minimal-poc/research.md`).

## Movement rules (Gram + @relateby/pattern)

Rule-based adjacent `go` is specified in [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md) with the implementation plan in [specs/003-rule-based-movement/plan.md](../../specs/003-rule-based-movement/plan.md).

| Env | Values | Purpose |
|-----|--------|---------|
| `AIE_MATRIX_RULES` | Absolute or repo-relative path to a `.gram` file, or unset | When set, authored mode is active and the file is loaded at startup. When absent, permissive mode (all geometrically valid steps allowed). Example: `maps/sandbox/green0trap.rules.gram` |

**Gram shape (v1):** one relationship per top-level line. Every node must carry its full label set — back-references (alias without labels) silently drop label information and will fail to match.

```
(from:Red)-[:GO]->(to:Blue)
(from:Hallway:VIP)-[:GO]->(to:Lobby)
(from:Blue)-[:GO {toward: "n"}]->(to:Blue)
(from:Red)-[:GO {ghostClass: "VIP"}]->(to:Blue)
(tile:Hallway)-[:PICK_UP]->(tile:Hallway)
```

Aliases (`from`, `to`, `tile`) are readability conventions; only labels matter for matching. Multi-label nodes like `(from:Hallway:VIP)` require the tile to carry **all** listed labels (AND semantics). Ghost and directional constraints belong on the relationship, not on tile nodes. See [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md) for the full rule file format spec.

**Parse failures** when `AIE_MATRIX_RULES` is set fail server startup (logged to stderr).

**Tests:** from repo root, `pnpm --filter @aie-matrix/server-world-api test`.

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
