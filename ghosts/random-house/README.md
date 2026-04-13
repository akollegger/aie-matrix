# random-house

Reference GhostHouse process for the Minimal PoC: it registers with the REST registry, adopts a ghost for a dev caretaker, then drives movement **only** through `@aie-matrix/ghost-ts-client` (Streamable HTTP MCP to `world-api`).

## Prerequisites

- Combined server running from `server/` (see repository root `README.md`).
- Default registry/MCP base: `http://127.0.0.1:8787` unless overridden.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `AIE_MATRIX_REGISTRY_BASE` | `http://127.0.0.1:8787` | HTTP root for `/registry/*` routes |
| `AIE_MATRIX_HTTP_PORT` | _(set on server)_ | Must match the server’s HTTP port if you change it from `8787` |
| `AIE_MATRIX_GHOST_COUNT` | `1` | Number of caretakers + adoptions from this house (each ghost needs its own caretaker per IC-002). Overridden by `--ghosts=N` / `-n N` on the command line. |

The adoption response includes `credential.worldApiBaseUrl`; this house uses that URL as-is for MCP (no separate override).

## Run

From the repository root after a workspace build:

```bash
pnpm --filter @aie-matrix/server build
pnpm --filter @aie-matrix/server start
```

In another shell:

```bash
pnpm --filter @aie-matrix/ghost-random-house build
pnpm --filter @aie-matrix/ghost-random-house start
```

For the combined server with auto-reload while you work on server code, use `pnpm --filter @aie-matrix/server dev` instead of `build` + `start` above.

This package does not ship a watch mode: after you change `ghosts/random-house/src/`, run `pnpm --filter @aie-matrix/ghost-random-house build` again, then `start`.

Two ghosts in one process (one house, two caretakers, two walkers):

```bash
pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2
```

Same effect without CLI args: `AIE_MATRIX_GHOST_COUNT=2 pnpm --filter @aie-matrix/ghost-random-house start`.

## What it does

1. `POST /registry/houses` — register this process as a GhostHouse (once per run).
2. For each ghost (default 1, up to 32): `POST /registry/caretakers`, then `POST /registry/adopt` with the same `ghostHouseId` — obtain `ghostId` + JWT + MCP base URL per ghost (IC-002: one active ghost per caretaker).
3. MCP per ghost: `whoami`, `whereami`, then a loop of `exits` + random valid `go` until SIGINT/SIGTERM.

Alternatively, run two separate `pnpm --filter @aie-matrix/ghost-random-house start` commands in two shells: each run registers its own house and one ghost (fine for quick checks; one process with `start -- --ghosts 2` avoids duplicate house rows).
