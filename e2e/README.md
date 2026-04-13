# End-to-end tests (`@aie-matrix/e2e`)

Playwright guards the Phaser spectator **Colyseus `ghostTiles` sync** (regression for passing `WorldSpectatorState` into `joinById`). The test spawns **random-house** and waits for `window.__aieSpectatorE2e.ghostTilesSize()` (only when `?debug=1`; see `client/phaser/src/scenes/WorldScene.ts`).

## One-time setup

```bash
pnpm --filter @aie-matrix/e2e exec playwright install chromium
```

## Run (default: Playwright starts the stack)

`pnpm run test:e2e` (repo root) and `pnpm --filter @aie-matrix/e2e test` set `E2E_AUTOSTART=1`: the combined server plus Vite **preview** on **5179** via `e2e/dev-stack.mjs` (reuses `:8787` / `:5179` if they already respond). Same behavior as `pnpm run test:e2e:autostart`.

In CI, set `CI=1` so `reuseExistingServer` is disabled and ports are not accidentally reused.

## Run (against dev servers you already started)

Start the combined server (`8787`) and Phaser Vite dev client (default **5174**), then:

```bash
pnpm --filter @aie-matrix/e2e run test:manual
```

If Vite is on another port:

```bash
E2E_BASE_URL=http://127.0.0.1:5175 pnpm --filter @aie-matrix/e2e run test:manual
```

## `global-setup`

Builds `ghosts/random-house` and runs `copy-map-assets` for the Phaser client before tests.
