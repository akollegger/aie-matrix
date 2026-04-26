# `@aie-matrix/tmj-to-gram`

Build-time CLI that converts Tiled **`.tmj`** maps (plus referenced **`.tsx`** tilesets and optional **`<stem>.items.json`** sidecars) into committed **`.map.gram`** artifacts per [RFC-0009](../../proposals/rfc/0009-map-format-pipeline.md) and [ADR-0005](../../proposals/adr/0005-h3-native-map-format.md).

## Requirements

- Node.js 24+, pnpm 10+
- From repo root: `pnpm install`

## CLI usage

From the repo root (workspace script):

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj
```

Writes `maps/sandbox/freeplay.map.gram` next to the source unless `--out` is set:

```bash
pnpm tmj-to-gram convert maps/sandbox/freeplay.tmj --out /tmp/out.map.gram
```

Help:

```bash
pnpm tmj-to-gram --help
```

## Inputs and outputs

| Input | Role |
|-------|------|
| `.tmj` | Map JSON; must define `h3_anchor` and `h3_resolution` **15** on map properties |
| Referenced `.tsx` files | Tile types, GIDs, optional tile properties (e.g. `color`) |
| `<same-stem>.items.json` | Optional; item definitions and metadata for `item-placement` layers |

| Output | Role |
|--------|------|
| `.map.gram` | UTF-8 gram text: header, `TileType` / `ItemType` defs, optional `Polygon` lines, cell nodes, item instances (canonical order per spec) |

Portal `objectgroup` entries are logged as **`[warn]`** and skipped. Unknown layout GIDs are warned and skipped.

## Exit codes (IC-003)

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Map / H3 configuration error (e.g. missing anchor, wrong resolution) |
| 2 | Tile-area geometry error (ellipse, gutter vertex, overlap, …) |
| 3 | I/O error (unreadable TMJ/tileset, bad `--out` path) |

## Tests

| Layer | Command | What it checks |
|-------|---------|----------------|
| 1 — Structure | `pnpm test` | H3 validity, tile/item references, polygon invariants, CLI negatives |
| 2 — Golden bytes | `pnpm ci:golden` | Re-converts every `maps/sandbox/*.tmj` and diffs against committed `.map.gram` |
| 3 — Visual parity | `pnpm test:visual` | TMJ vs gram rasterized to PNG; `pixelmatch` must be zero |

Regenerate **visual** reference PNGs after intentional renderer or fixture changes:

```bash
pnpm golden:regen
git add test/render/golden/
```

## Adding a sandbox fixture

1. Author `maps/sandbox/<name>.tmj` in Tiled with **`layout`** (and optionally **`item-placement`**, **`tile-area`**) layer classes; set **`h3_anchor`**, **`h3_resolution`: 15** (see `maps/sandbox/README.md`).
2. Add sidecar `maps/sandbox/<name>.items.json` if you use item layers.
3. `pnpm tmj-to-gram convert maps/sandbox/<name>.tmj` and commit **`<name>.map.gram`**.
4. If Layer 3 fails on unknown colors, extend `test/render/fallbacks.ts` for new tile type labels.
5. `pnpm golden:regen` and commit **`test/render/golden/<name>.png`**.
6. `pnpm ci:golden` must pass in CI.

## Package layout

| Path | Purpose |
|------|---------|
| `src/cli.ts` | `@effect/cli` entry |
| `src/convert.ts` | Pipeline orchestration |
| `src/converter/` | TMJ/TSX parse, tile-area, cell/item emission, gram serialize |
| `test/unit/` | Layer 1 & CLI tests |
| `test/render/` | Layer 3 renderer + `parity.test.ts` |
| `scripts/ci-golden-check.sh` | Layer 2 CI script |

More context: [specs/010-tmj-to-gram/quickstart.md](../../specs/010-tmj-to-gram/quickstart.md).
