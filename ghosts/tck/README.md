# ghost-tck (`@aie-matrix/ghost-tck`)

**Minimal** PoC compatibility smoke (IC-006 subset per [`specs/001-minimal-poc/contracts/tck-scenarios.md`](../../specs/001-minimal-poc/contracts/tck-scenarios.md)): **reachability** → **registry adopt** → **MCP `whereami`**.

## Prerequisites

1. Combined server listening on the registry HTTP port (default **8787**), e.g.:

   ```bash
   pnpm run poc:server
   ```

   or a full **`pnpm run demo`** (then the TCK reuses the same server; you do not need a second ghost running).

2. From the repository root, workspace install already done (`pnpm install`).

## Run

```bash
pnpm --filter @aie-matrix/ghost-tck test
```

`pretest` builds `@aie-matrix/ghost-ts-client` so MCP imports resolve on a clean clone (then `build` + `node` run this package).

Equivalent:

```bash
pnpm --filter @aie-matrix/ghost-tck run build && node ghosts/tck/dist/index.js
```

Exit **0** only if all steps pass; otherwise **non-zero** with `[tck] <step> …` on stderr.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AIE_MATRIX_REGISTRY_BASE` | `http://127.0.0.1:8787` | HTTP root for `/spectator/room` and `/registry/*` |

Optional `.env` at repo root is loaded via `@aie-matrix/root-env` (same as server / ghosts).

## Out of scope for PoC Phase 6

- Invalid `go`, `exits` / movement matrix, `tools/list`, shutdown hooks  
- Second-language client (`ghosts/python-client`)  
- Multi-house discovery, spectator auth, or user-initiated adoption flows  
- CLI flags to point at alternate GhostHouse binaries (revisit when multiple houses exist)

Use **Playwright** (`pnpm run test:e2e:autostart`), **`pnpm run poc:ghost`**, and [quickstart §1](../../specs/001-minimal-poc/quickstart.md) for richer regression.
