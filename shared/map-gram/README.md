# @aie-matrix/map-gram

Canonical parser for the layered `.map.gram` format used by the aie-matrix world.

**Owner**: aie-matrix core team

## Setup

```bash
pnpm install   # from repo root
```

## Smoke test

```bash
pnpm --filter @aie-matrix/map-gram test
```

## Usage

```typescript
import { parseMapGram } from "@aie-matrix/map-gram";

const gramText = await readFile("my-map.map.gram", "utf8");
const map = await parseMapGram(gramText);

for (const [h3Index, cell] of map.cells) {
  console.log(h3Index, cell.tileType, cell.items);
}
```

## Parse algorithm

1. Gram AST is walked to extract TileType/ItemType declarations, Layers, LayerStack, Rules, Grants, and Leaderboards.
2. Polygon layers expand vertex H3 cells to fill sets using `h3.polygonToCellsExperimental` with `containmentOverlapping`.
3. Tile layers override individual cells.
4. Items layers attach item names to cells.
5. Layers are applied in the order declared by `LayerStack`.

Files without a `LayerStack` walk are rejected with `MapGramParseError("missing-layer-stack")`.

## Item placements

Item placements in gram syntax support an optional `qty` attribute (default `1`):

```gram
[collectibles:Layer {kind: "items"} |
  (:Item:BrassKey { geometry: [h3`8f2800000000015`], qty: 3 })
]
```

The parsed `itemPlacements` array contains `ParsedItemPlacement` entries:
```typescript
{ itemRef: string; qty: number; h3Index: string; layerIdentity: string }
```
`h3Index` is always present (placements are always cell-located). The server aggregates these into `ItemSeed[]` for ledger initialisation.

`[resources:Resources]` blocks are **forbidden** in 027+ maps. Use `ItemType` placements instead.

## Spawn grants

`[:Grants { role: qty, ... } | (itemRef)]` blocks declare starting items awarded to ghosts of a given role on first connect. Each block is **per-item** — the props are role→qty pairs and the element is a reference to a bound ItemType identifier:

```gram
(brassKey:ItemType:BrassKey { name: "Brass Key", takeable: true, capacityCost: 1 })
(goldCoin:ItemType:GoldCoin { name: "Gold Coin", takeable: true, capacityCost: 0 })

[:Grants { attendee: 1, explorer: 2, vendor: 5 } | (brassKey)]
[:Grants { attendee: 10, vendor: 50 }             | (goldCoin)]
```

Multiple `Grants` blocks referencing different items are merged by role. The parsed result is `SpawnGrant[]` where each entry has `{ role: string; grants: Array<{ itemRef: string; qty: number }> }`.

**Important**: `Grants` blocks must appear *after* the ItemType declarations they reference, since the parser resolves bound identifiers in a single pass.

The server matches a ghost's `role` (from A2A agent card metadata) on first MCP connect and commits one ledger transfer (`world → ghostId`) per grant item. Reconnects are idempotent — the transaction ID is deterministically derived from `SHA-256(ghostId:role:itemRef)`.
