# Phaser spectator (`@aie-matrix/client-phaser`)

Read-only hex map view driven by Colyseus `WorldSpectatorState` (IC-004).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_SERVER_HTTP` | *(dev: same-origin via Vite proxy for spectator requests; prod build: `http://127.0.0.1:8787`)* | HTTP root for `/spectator/room` and for server-hosted `/maps/*` when the client hits `:8787` directly (not the usual Vite dev path for maps) |
| `VITE_SERVER_WS` | *(derived from `VITE_SERVER_HTTP`)* | Colyseus WebSocket URL (always hits the game server port, e.g. `ws://127.0.0.1:8787`) |
| `VITE_DEV_PROXY_TARGET` | `http://127.0.0.1:8787` | Vite dev proxy target for `/spectator` only (see `vite.config.ts`); `/maps/*` in dev are served from the Vite origin after `copy-map-assets` |

## Commands

```bash
pnpm --filter @aie-matrix/client-phaser dev
```

### cmux browser (optional)

If you use [cmux](https://cmux.app), open a browser pane split below the current terminal, pointed at the Vite dev URL (default port **5174**):

```bash
pnpm --filter @aie-matrix/client-phaser cmux-browser
```

From another workspace (or outside the client workspace), set the target workspace ref (shown by `cmux list-workspaces`):

```bash
CMUX_CLIENT_WORKSPACE=workspace:3 pnpm --filter @aie-matrix/client-phaser cmux-browser
```

If Vite picked another port (e.g. 5175 when 5174 is busy), match the printed “Local” URL:

```bash
VITE_DEV_BROWSER_URL=http://127.0.0.1:5175/ pnpm --filter @aie-matrix/client-phaser cmux-browser
```

Build static assets:

```bash
pnpm --filter @aie-matrix/client-phaser build
```

The production build writes to `client/phaser/dist/`; serve that folder with any static host while the game server remains reachable at `VITE_SERVER_HTTP` (or rebuild with the correct value baked in).
