# Combined server (`@aie-matrix/server`)

Single dev process: Colyseus authoritative room, REST registry, MCP `world-api`, and static map assets for the Phaser spectator.

## Ports

| Surface | Default URL |
|---------|-------------|
| HTTP (registry, MCP, maps, spectator meta) | `http://127.0.0.1:8787` |
| Colyseus WebSocket | `ws://127.0.0.1:8787` |

Override the HTTP port with `AIE_MATRIX_HTTP_PORT`.

## Spectator (Phaser)

1. Start this server (`pnpm --filter @aie-matrix/server start` or `dev` from the repo root `README.md`).
2. Start the Phaser dev client: `pnpm --filter @aie-matrix/client-phaser dev`.
3. Open the Vite URL printed in the terminal (default **`http://127.0.0.1:5174`**).

The browser client resolves the Colyseus room with:

`GET http://127.0.0.1:8787/spectator/room` → `{ "roomId", "roomName" }`

then connects read-only with `colyseus.js` (`joinById`). There is **no** move RPC from the browser.

Map tiles and the tileset image are loaded from the same server via `GET /maps/...` (served from the repository `maps/` directory). PoC responses include permissive `Access-Control-Allow-*` headers for browser dev; the Phaser dev server also proxies `/spectator` and `/maps` to avoid cross-origin fetches when using `pnpm dev`.

**Colyseus matchmake + credentials:** the official browser client always sends cookies (`withCredentials`), so `Access-Control-Allow-Origin` cannot be `*` on `/matchmake/*`. The combined server patches `matchMaker.controller.getCorsHeaders` to echo the request `Origin` and set `Access-Control-Allow-Credentials: true` (see `server/src/colyseus-cors-patch.ts`).

Configure the Phaser dev server target with `VITE_SERVER_HTTP` (see `client/phaser/README.md`).
