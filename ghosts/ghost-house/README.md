# @aie-matrix/ghost-house

Canonical **ghost house**: file-backed **catalog**, **A2A** host, **MCP** proxy to the world server, **Colyseus** bridge, and **agent supervisor** (spawn, health, world events, shutdown). See [`specs/009-ghost-house-a2a/`](../../specs/009-ghost-house-a2a/) and [RFC-0007](../../proposals/rfc/0007-ghost-house-architecture.md).

## Environment

Config is loaded with `@aie-matrix/root-env` from the **monorepo root** `.env` / `.env.local` (not only this folder). Copy from `.env.example` here into the **repository root** if you keep a single shared env file, or set the same keys in the root `.env` used by all packages.

| Variable | Required | Default | Role |
|----------|----------|---------|------|
| `GHOST_HOUSE_DEV_TOKEN` | yes | — | Static bearer for catalog and session HTTP (localhost Phase 1) |
| `AIE_MATRIX_HTTP_BASE_URL` | no | `http://127.0.0.1:8787` | World **HTTP** origin for the Colyseus bridge (`/spectator/room`, WS). Not the Streamable `/mcp` URL. |
| `GHOST_HOUSE_PORT` | no | `4000` | House HTTP + A2A port |
| `CATALOG_FILE_PATH` | no | `./catalog.json` (relative to **process cwd** of the house) | File-backed agent catalog (IC-005) |

The Streamable world MCP URL used to forward tools is **`credential.worldApiBaseUrl`** from each registry **/adopt** response (per session), not a single env var.

`./catalog.json` is typically created under `ghosts/ghost-house/` when you run the house from that filter; use an absolute path if you start from the repo root.

## Develop

```bash
# World server must be up first, e.g. from repo root:
# pnpm dev
pnpm --filter @aie-matrix/ghost-house dev
# Default: http://127.0.0.1:4000 — catalog, sessions, A2A
```

## Relationship to `random-agent` and TCK

- **[`@aie-matrix/random-agent`](../random-agent/)** is the **Wanderer** reference: it serves an A2A card and movement loop. Register its `baseUrl` with the house, adopt a ghost via the world **registry**, then `POST /v1/sessions/spawn/:agentId` on the house.
- **Contract tests** live in `@aie-matrix/ghost-tck` — e.g. `pnpm --filter @aie-matrix/ghost-tck run tck:wanderer` (see [quickstart](../../specs/009-ghost-house-a2a/quickstart.md)).

## Tests

```bash
pnpm --filter @aie-matrix/ghost-house test
```
