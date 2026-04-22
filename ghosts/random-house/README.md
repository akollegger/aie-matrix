# random-house

Reference GhostHouse process for the Minimal PoC: it registers with the REST registry, adopts a ghost for a dev caretaker, then drives movement **only** through `@aie-matrix/ghost-ts-client` (Streamable HTTP MCP to `world-api`).

## Prerequisites

- Combined server running from `server/` (see repository root `README.md`).
- Default registry HTTP root for this process: `http://127.0.0.1:8787` (override with `--registry-base` / `-r` if the server listens elsewhere). The server’s own HTTP port is configured in the server package; it must match the URL you pass here.

## CLI options

All configuration is via command-line flags; defaults are applied if you omit them. Run `random-house --help` for the full list.

| Flag | Default | Purpose |
|------|---------|---------|
| `-r`, `--registry-base <url>` | `http://127.0.0.1:8787` | HTTP root for `/registry/*` routes |
| `--walk-interval-ms <n>` | `1500` | Delay between walker ticks (ms) |
| `--drop-prob <n>` | `0.3` | After picking up items on a tile, probability (0–1) of dropping one random item from inventory |
| `-n`, `--ghosts <n>` | `1` | Number of caretakers + adoptions from this house (1–32; each ghost needs its own caretaker per IC-002) |

Long options also support `=value` (e.g. `--drop-prob=0.5`).

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
pnpm --filter @aie-matrix/ghost-random-house start --ghosts 2
```

Slower walking and a different registry URL:

```bash
pnpm --filter @aie-matrix/ghost-random-house start -r http://127.0.0.1:9000 --walk-interval-ms=3000 --drop-prob 0.1
```

With **pnpm**, prefer passing flags directly after `start` as above. The form `pnpm run start -- <flags>` inserts a literal `--` into `process.argv`; this CLI ignores that token, but `pnpm … start <flags>` avoids the extra noise.

## What it does

1. `POST /registry/houses` — register this process as a GhostHouse (once per run).
2. For each ghost (default 1, up to 32): `POST /registry/caretakers`, then `POST /registry/adopt` with the same `ghostHouseId` — obtain `ghostId` + JWT + MCP base URL per ghost (IC-002: one active ghost per caretaker).
3. MCP per ghost: `whoami`, `whereami`, then a loop until SIGINT/SIGTERM:
   - `look` at the current tile; sometimes `say` when other ghosts are present (enters conversational mode).
   - `take` every carriable item on the current tile (retries `look` after each successful take).
   - `inventory` + random `drop` of one carried item (configurable via `--drop-prob`).
   - `exits` + random `go`, then `look` / `take` / optional `drop` again on the new tile.

Alternatively, run two separate `pnpm --filter @aie-matrix/ghost-random-house start` commands in two shells: each run registers its own house and one ghost (fine for quick checks; one process with `start --ghosts 2` avoids duplicate house rows).
