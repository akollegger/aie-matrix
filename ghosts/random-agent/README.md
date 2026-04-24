# @aie-matrix/random-agent

**Wanderer**-tier reference agent: A2A **agent card** at `/.well-known/agent-card.json` and a JSON-RPC A2A endpoint; on spawn (IC-006) it runs a random `whereami` / `exits` / `go` loop through the house **MCP** proxy. Agent card shape: [IC-001](../../specs/009-ghost-house-a2a/contracts/ic-001-agent-card-schema.md).

## Environment

Use the **monorepo root** `.env` (via `@aie-matrix/root-env`), same as the house. See [`../ghost-house/.env.example`](../ghost-house/.env.example) and [quickstart](../../specs/009-ghost-house-a2a/quickstart.md).

| Variable | Required | Default | Role |
|----------|----------|---------|------|
| `GHOST_HOUSE_DEV_TOKEN` | yes | — | Must match the house; used for A2A auth |
| `GHOST_HOUSE_URL` | yes | — | e.g. `http://127.0.0.1:4000` |
| `AGENT_PORT` | no | `4001` | This agent’s HTTP port |

## Develop

```bash
pnpm --filter @aie-matrix/random-agent dev
# Default: http://127.0.0.1:4001
```

## Register with the house

1. With both **world server** and **ghost house** running, `POST` to the house (bearer = `GHOST_HOUSE_DEV_TOKEN`):

   ```bash
   curl -X POST http://127.0.0.1:4000/v1/catalog/register \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <GHOST_HOUSE_DEV_TOKEN>" \
     -d '{"agentId": "random-agent", "baseUrl": "http://127.0.0.1:4001"}'
   ```

2. Adopt a ghost and spawn via the house as in [quickstart](../../specs/009-ghost-house-a2a/quickstart.md) (`POST /v1/sessions/spawn/random-agent`).

## Wanderer TCK

With server + house + this agent + an active session:

```bash
export GHOST_HOUSE_URL=http://127.0.0.1:4000
export RANDOM_AGENT_BASE_URL=http://127.0.0.1:4001
pnpm --filter @aie-matrix/ghost-tck run tck:wanderer
```

## Tests

```bash
pnpm --filter @aie-matrix/random-agent test
```
