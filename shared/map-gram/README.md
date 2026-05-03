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

1. Gram AST is walked to extract TileType/ItemType declarations, Layers, LayerStack, and Rules.
2. Polygon layers expand vertex H3 cells to fill sets using `h3.polygonToCellsExperimental` with `containmentOverlapping`.
3. Tile layers override individual cells.
4. Items layers attach item names to cells.
5. Layers are applied in the order declared by `LayerStack`.

Files without a `LayerStack` walk are rejected with `MapGramParseError("missing-layer-stack")`.
