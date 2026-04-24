# @aie-matrix/ghost-house

Canonical ghost house: catalog, A2A client to agents, MCP proxy, agent supervisor. See `specs/009-ghost-house-a2a/`.

## Develop

```bash
pnpm --filter @aie-matrix/ghost-house dev
```

## Environment

Copy `.env.example` to `.env` in this package. Key variables: `GHOST_HOUSE_DEV_TOKEN`, `WORLD_API_BASE_URL` (MCP streamable URL ending in `/mcp`), `CATALOG_FILE_PATH`, `GHOST_HOUSE_PORT`.

## Tests

```bash
pnpm --filter @aie-matrix/ghost-house test
```
