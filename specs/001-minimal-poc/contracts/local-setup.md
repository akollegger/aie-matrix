# Contract: Local developer setup and demo

**IC-007** — Minimum documented flow for a clean clone (align with spec SC-001 and FR-014).

## Prerequisites

- Supported Node.js version (pin in root `package.json` / `.nvmrc` when added)
- Python 3.11+ only when exercising `ghosts/python-client/` beyond stub
- Browser for `http://localhost:3000` (or documented port)

## Ordered steps (normative for docs)

1. Install dependencies from the repository root: `pnpm install` (workspace packages are listed in `pnpm-workspace.yaml`).
2. Build packages if required by toolchain.
3. Start combined server from `server/` (`pnpm run dev` per RFC — exact script name to match implementation).
4. Open spectator URL; confirm empty map renders.
5. Run **developer adoption flow** (script + `curl` or CLI per [research.md](../research.md)) targeting **`ghosts/random-house/`** so it registers, adopts, and starts the embedded walker.
6. Observe ghost motion in browser within SC-003 timing expectations.
7. Run `pnpm test` (or documented command) from **`/Users/akollegger/Developer/akollegger/aie-matrix/ghosts/tck/`** — all TCK steps pass.

## Two-ghost scenario

Second terminal: second `random-house` instance with distinct adoption path (document constraints if registry limits require second caretaker).
