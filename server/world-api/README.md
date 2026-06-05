# server/world-api

MCP `world-api` (ghost tools) lives here. It calls Colyseus **in-process** via `colyseus-bridge.ts` and owns the in-world resource ledger.

## In-World Resource Ledger — RFC-0023 / spec-022

The ledger tracks resource balances (gold, XP, badges) for all actors (ghosts, world, NPCs) using an append-only, hash-chained transaction log.

**Key services:**
- `LedgerService` — Effect service Tag + interface (`src/LedgerService.ts`)
- `LedgerServiceInMemory` — in-memory impl for Tier 1 dev and unit tests
- `LedgerServiceLive` — Neo4j-backed impl for Tier 2/3 (requires `NEO4J_URI`)
- `ProposalService` — in-memory pending trade proposals; TTL 5 minutes
- `mechanics.ts` — `rewardXp`, `awardBadge`, `rewardGold` — authorised minting helpers

**MCP tools added:** `inventory` (extended), `offer`, `request`, `agree`, `decline`, `ledger_verify` (admin-only).

**Local smoke test:**
```bash
pnpm --filter @aie-matrix/server-world-api test
```
All 119+ unit tests run without live services. See `specs/022-in-world-resource-ledger/quickstart.md` for end-to-end verification.

## Map Management API (`/maps/` and `/live/`) — RFC-0013

The map management surface handles the full map lifecycle for Tier 1 local dev (and Tier 2/3 once ADR-0007 deployment work lands).

### Required env vars

| Variable | Purpose |
|---|---|
| `ADMIN_TOKEN` | Bearer token for admin-only endpoints (`POST /maps`, `POST /live`, `PATCH /live/:id/maps`, `DELETE /maps/:mapId`, `DELETE /live/:id`). Never logged. |
| `NEO4J_URI` | Required for map management. When absent, `/maps/` and `/live/` return `503 NEO4J_REQUIRED`. The existing `AIE_MATRIX_MAP` file path still works as a no-DB Tier 1 fallback. |
| `GCS_BUCKET` | GCS bucket for artifact storage. When unset, a local `tmp/gcs/` stub is used (Tier 1 dev without GCS credentials). |

### `/maps/` — artifact lifecycle

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/maps` | Admin | Publish or replace a `.map.gram`. Validates gram, uploads to GCS, seeds `(:Cell)` nodes in Neo4j. Idempotent on unchanged content. |
| `GET` | `/maps` | Public | List maps. `?status=published` (default) or `?status=archived`. |
| `GET` | `/maps/:mapId` | Public | Get one map by logical name. 404 if not found. |
| `DELETE` | `/maps/:mapId` | Admin | Archive a map. 409 if referenced by an active session. |

### `/live/` — live session management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/live` | Admin | Start a session bound to published maps. Lightweight — cells already in Neo4j from publish time. |
| `GET` | `/live` | Public | List sessions. `?status=active` (default). |
| `GET` | `/live/:id` | Public | Get one session. |
| `PATCH` | `/live/:id/maps` | Admin | Switch the primary map. Computes removedCells/addedCells from Neo4j; broadcasts `world.map-changed`. |
| `DELETE` | `/live/:id` | Admin | End a session. Broadcasts `world.session-ended`. |

### `/health`

Returns `503 { "status": "starting" }` during startup, `200 { "status": "ok" }` once ready.

### Session binding at startup

```
AIE_MATRIX_MAP set    → Tier 1 file path; no session binding
LIVE_SESSION_ID set   → bind to that session
(neither set)         → auto-discover single active session; fail loudly if multiple
```

See [RFC-0013](../../proposals/rfc/0013-map-management.md) and [specs/014-map-management/](../../specs/014-map-management/) for full design details, contracts, and quickstart.

---

## Map assets (`GET /maps/:mapId`) — RFC-0009

The world HTTP surface (same process as the PoC server) exposes read-only map bytes for tooling and the RFC-0008 intermedium.

| Route | Default | Notes |
|-------|---------|--------|
| `GET /maps/:mapId` | `?format=gram` | `Content-Type: text/plain; charset=utf-8` — body is the committed `.map.gram` UTF-8 |
| `GET /maps/:mapId?format=gram` | explicit gram | Same as default |
| `GET /maps/:mapId?format=tmj` | TMJ JSON | `Content-Type: application/json` — original `.tmj` bytes |

- **`:mapId`** is the filename stem (e.g. `freeplay` for `maps/sandbox/freeplay.map.gram` paired with `freeplay.tmj`).
- **404** — unknown `mapId` (`MapNotFoundError`).
- **400** — unsupported `format` query (`UnsupportedFormatError`).

### `MapService` (Effect `Layer`)

`server/world-api/src/map/MapService.ts` defines `Context.Tag("aie-matrix/MapService")`. The scoped `Layer`:

1. **Indexes** pairs under `maps/` where a `.tmj` and same-stem `.map.gram` live in the same directory (`mapId` = stem).
2. **Startup validation** — before the HTTP port is considered ready, every indexed gram is parsed with `@relateby/pattern`; the document header `name` must match the stem. Failures use typed errors (`GramParseError`, `MapNameMismatchError`, `MapIdCollisionError`) and abort startup.
3. **`raw(mapId, format)`** — reads the file from disk and returns a `Buffer` (no conversion on the request path).

`MapRoutes.ts` wires the handler next to `/mcp` and `/registry` (see `server/world-api/src/index.ts`). Contract tests: `server/world-api/test/map-routes.test.ts`.

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

`look` is also extended: `TileInspectResult` always includes `objects: TileItemSummary[]` for the focal tile slice (empty when no items on that slice).

## World Calendar — RFC-0021

The calendar adds a temporal dimension to the world: wall-clock time anchored to US/Pacific, a `timecheck` MCP tool, and a scheduler that fires enter/exit commands at scheduled times.

| Env | Values | Purpose |
|-----|--------|---------|
| `CALENDAR_TICK_MS` | Integer ms (default: `30000`) | Scheduler poll interval. Use `5000` locally to see events fire quickly. |

### Calendar Gram format

**Current (transitional)**: events are loaded from a standalone `.calendar.gram` file via `AIE_MATRIX_CALENDAR`. **Target**: events will be embedded in the `.map.gram` file as a `[schedule:Schedule | ...]` block (see `maps/sandbox/canonical.map.gram` for an example). A map with no `[schedule:Schedule | ...]` block runs in timeless mode. `src/calendar/fixtures/sample.calendar.gram` is used by unit tests.

### `timecheck` MCP tool

Returns `{ now, timezone }` — the current Pacific time. Agents are expected to be temporally aware; no event schedule is surfaced by this tool. Available to all adopted ghosts, no parameters required.

### Running calendar tests

```bash
pnpm test   # from server/world-api/
# or to run only calendar tests:
pnpm exec node --import tsx --test "src/calendar/*.test.ts"
```

## Group Formation — RFC-0024

Groups are a first-class disembodied world actor: a named collective of ghosts with a shared resource bag and a location-independent group chat thread. See [RFC-0024](../../proposals/rfc/0024-group-formation-and-chat.md) and [spec-023](../../specs/023-group-formation/).

### MCP tools

| Tool | Input | Description |
|------|-------|-------------|
| `group.offer` | `{ to, resource, amount, expires_in? }` | Form a group (ghost→ghost, must be co-located) or join an existing group (ghost→group_id) |
| `group.vote` | `{ group_id, offer_id, decision }` | Cast `accept` or `reject` on a pending admission offer |
| `group.leave` | `{ group_id }` | Leave a group and recover contributed resources |
| `group.say` | `{ group_id, content }` | Post to the group chat (no location required) |
| `group.list` | _(none)_ | List your current group memberships |
| `group.add_participant` | `{ group_id, actor_id, role }` | Add a non-member participant (any member may call) |
| `group.remove_participant` | `{ group_id, actor_id }` | Remove a participant (any member may call) |

### Services

- `GroupService` — Effect Context.Tag for the group operations interface
- `GroupServiceInMemory` — in-memory implementation (unit tests, dev)
- `GroupServiceLive` — Neo4j-backed production implementation (requires `NEO4J_URI`)

The server wires `GroupServiceInMemoryLayer` + `ProposalServiceWithGroupLayer` by default. To use the Neo4j-backed live implementation, inject `makeGroupServiceLiveLayer(driver, conversationDataDir)`.

### Running group unit tests

```bash
pnpm test   # from server/world-api/
# or to run only group tests:
pnpm exec node --import tsx --test "test/GroupService.test.ts"
```

## Eval Contracts — RFC-0022

Eval contracts are peer-to-peer performance agreements between ghosts. A client stakes resources into escrow when opening a contract; the contractor accepts or declines; an independent evaluator issues a verdict in `[0,1]` that triggers automatic settlement. See [RFC-0022](../../proposals/rfc/0022-eval-contract-protocol.md) and [spec-024](../../specs/024-eval-contracts/).

### MCP tools

| Tool | Input | Description |
|------|-------|-------------|
| `eval_contract.open` | `{ contractor_id, evaluator_id, request, stake_resource, stake_amount, deadline_ms }` | Open a contract and stake resources into escrow |
| `eval_contract.accept` | `{ contract_id }` | Contractor accepts the contract (freezes beneficiaries if group contractor) |
| `eval_contract.decline` | `{ contract_id }` | Contractor declines; escrow returned to client |
| `eval_contract.submit` | `{ contract_id, submission }` | Contractor submits a response before the deadline |
| `eval_contract.evaluate` | `{ contract_id, verdict }` | Evaluator issues verdict `0..1`; settlement executes immediately |
| `eval_contract.get` | `{ contract_id }` | Read contract state (parties only) |
| `eval_contract.list` | `{ state? }` | List contracts visible to the caller |

### Services

- `EvalContractService` — Effect Context.Tag for the contract operations interface
- `EvalContractServiceInMemory` — in-memory implementation (unit tests, dev)
- `EvalContractServiceLive` — Neo4j-backed implementation; persists `(:EvalContract)` nodes and delegates ledger movements to `LedgerService`

### Running eval contract unit tests

```bash
pnpm test   # from server/world-api/
# or to run only eval contract tests:
pnpm exec node --import tsx --test "src/EvalContractService.test.ts"
```
