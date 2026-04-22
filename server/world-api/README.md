# server/world-api

MCP `world-api` (ghost tools) lives here. For the PoC it calls Colyseus **in-process** via `colyseus-bridge.ts` (see `specs/001-minimal-poc/research.md`).

## Movement rules (Gram + @relateby/pattern)

Rule-based adjacent `go` is specified in [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md) with the implementation plan in [specs/003-rule-based-movement/plan.md](../../specs/003-rule-based-movement/plan.md).

| Env | Values | Purpose |
|-----|--------|---------|
| `AIE_MATRIX_RULES` | Absolute or repo-relative path to a `.gram` file, or unset | When set, authored mode is active and the file is loaded at startup. When absent, permissive mode (all geometrically valid steps allowed). Example: `maps/sandbox/green-trap.rules.gram` |

**Gram shape (v1):** one relationship per top-level line. Introduce each node with its identity and full label set on first use; subsequent rules may use bare back-references (identity only) which resolve to the labels of the first labelled occurrence. Label-only nodes `(:Red)` — no identity — are **not** supported and will fail to match.

Canonical authoring style (identity mirrors label on first use, bare back-reference thereafter):

```
(red:Red)-[:GO]->(blue:Blue)
(blue)-[:GO]->(blue)           # back-reference: 'blue' resolves to Blue
(from:Hallway:VIP)-[:GO]->(to:Lobby)
(from:Blue)-[:GO {toward: "n"}]->(to:Blue)
(from:Red)-[:GO {ghostClass: "VIP"}]->(to:Blue)
(tile:Hallway)-[:PICK_UP]->(tile:Hallway)
```

Multi-label nodes like `(from:Hallway:VIP)` require the tile to carry **all** listed labels (AND semantics). Ghost and directional constraints belong on the relationship, not on tile nodes. See [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md) for the full rule file format spec.

**Parse failures** when `AIE_MATRIX_RULES` is set fail server startup (logged to stderr).

**Tests:** from repo root, `pnpm --filter @aie-matrix/server-world-api test`.

## Non-adjacent exits (`exits` + `traverse`, IC-006 / IC-007)

When **`NEO4J_URI`** is set, the combined server keeps a long-lived Neo4j driver, ensures the `cell_h3_unique` constraint, and seeds **pentagon** `PORTAL` mesh plus a **`tck-elevator`** `ELEVATOR` edge from the map anchor to one neighbor (for contract tests).

| Tool | Input | Success | Failure (MCP `isError`) |
|------|--------|---------|-------------------------|
| `exits` | _(none)_ | JSON `{ here, exits, nonAdjacent }` — `exits` are compass neighbors; `nonAdjacent` lists `{ kind, name, tileId, tileClass }` for `ELEVATOR` / `PORTAL` | Same auth / cell errors as other tools |
| `traverse` | `{ via: string }` | `{ ok: true, via, from, to, tileClass }` | `WorldApiError.MovementBlocked` with `code: "NO_EXIT"` when the name is absent at the current cell |

Destination `tileClass` comes from the loaded map when the H3 exists there; synthetic graph targets (e.g. pentagon cells) use `Portal` / `Unknown` as a fallback.

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

## World items

World item definitions load from a `*.items.json` sidecar at startup and live in-memory in `ItemService` for the current PoC. Colyseus receives broadcast snapshots of per-tile items and ghost inventories through the world bridge.

| Env | Values | Purpose |
|-----|--------|---------|
| `AIE_MATRIX_ITEMS` | Absolute path, repo-relative path, or unset | Override the `*.items.json` sidecar path. When unset, the loader falls back to `<map-dir>/<map-name>.items.json`. |

### MCP item tools

| Tool | Input | Success | Failure |
|------|-------|---------|---------|
| `inspect` | `{ itemRef }` | `{ ok: true, name, description? }` | `{ ok: false, code: "NOT_HERE" \| "NOT_FOUND", reason }` |
| `take` | `{ itemRef }` | `{ ok: true, name }` | `{ ok: false, code: "NOT_CARRIABLE" \| "NOT_HERE" \| "NOT_FOUND" \| "RULESET_DENY", reason }` |
| `drop` | `{ itemRef }` | `{ ok: true }` | `{ ok: false, code: "NOT_CARRYING" \| "TILE_FULL" \| "RULESET_DENY", reason }` |
| `inventory` | _(none)_ | `{ ok: true, objects: [{ itemRef, name }] }` | Never fails |

`look` is also extended: `TileInspectResult` now includes `objects?: TileItemSummary[]` when items are visible on the focal tile or adjacent tiles.
