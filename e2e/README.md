# End-to-end tests (`@aie-matrix/e2e`)

Playwright guards the Phaser spectator **Colyseus `ghostTiles` sync** (regression for passing `WorldSpectatorState` into `joinById`). The test spawns **random-house** and waits for `window.__aieSpectatorE2e.ghostTilesSize()` (only when `?debug=1`; see `client/phaser/src/scenes/WorldScene.ts`).

## One-time setup

```bash
pnpm --filter @aie-matrix/e2e exec playwright install chromium
```

## Run (against dev servers you already started)

Default `baseURL` is `http://127.0.0.1:5174` (Vite’s default port). Start the combined server (`8787`) and Phaser dev client first (e.g. cmux **aie-server** + **aie-client**), then:

```bash
pnpm run test:e2e
```

If Vite is on another port:

```bash
E2E_BASE_URL=http://127.0.0.1:5175 pnpm run test:e2e
```

## Run (Playwright starts the stack)

Opt-in — starts the combined server + Vite on **5179** via `e2e/dev-stack.mjs` (reuses `:8787` / `:5179` if they already respond):

```bash
pnpm --filter @aie-matrix/e2e run test:autostart
```

In CI, set `CI=1` so `reuseExistingServer` is disabled and ports are not accidentally reused.

## `global-setup`

Builds `ghosts/random-house` and runs `copy-map-assets` for the Phaser client before tests.
