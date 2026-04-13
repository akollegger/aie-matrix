# Contract: Local developer setup and demo

**IC-007** — Minimum documented flow for a clean clone (align with spec SC-001 and FR-014).

## Prerequisites

- Supported Node.js version (pin in root `package.json` / `.nvmrc` when added)
- Python 3.11+ only when exercising `ghosts/python-client/` beyond stub
- Browser for the Phaser Vite dev URL (default `http://127.0.0.1:5174/`; see root `README.md` / `quickstart.md`)

## Ordered steps (normative for docs)

1. Install dependencies from the repository root: `pnpm install` (workspace packages are listed in `pnpm-workspace.yaml`).
2. Build packages if required by toolchain.
3. Start combined server from the repo root (`pnpm run poc:server` or `pnpm run poc:server:dev`; see [quickstart.md](../quickstart.md)).
4. Start Phaser dev client (`pnpm run poc:client`) and open the printed URL; confirm the map renders (ghosts optional).
5. Run **developer adoption flow** — `pnpm run poc:ghost` and/or the `curl` sequence in [`server/registry/README.md`](../../../server/registry/README.md) targeting **`ghosts/random-house/`** so a house registers, adopts, and the walker runs.
6. Observe ghost motion in the browser within SC-003 timing expectations.
7. Optional: with the server still up, `pnpm --filter @aie-matrix/ghost-tck test` (see [quickstart.md §4](../quickstart.md#4-compatibility-check-user-story-4)).

## Two-ghost scenario

Prefer one process with `pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2` (one house, two caretakers), or two terminals each running `pnpm run poc:ghost` (two houses). IC-002 requires a distinct caretaker per ghost.
