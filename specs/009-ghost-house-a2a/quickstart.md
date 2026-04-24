# Quickstart: Ghost House A2A Coordination

**Branch**: `009-ghost-house-a2a`  
**Prerequisite**: World server running — `pnpm dev` from repo root (starts Colyseus + world-api + registry)

This guide walks through Phase 1 verification: start the ghost house, register the `random-agent` reference implementation, spawn it for a ghost, and run the Wanderer TCK.

---

## 1. Configure environment

```bash
# ghost-house
cp ghosts/ghost-house/.env.example ghosts/ghost-house/.env
# Required fields in .env:
#   GHOST_HOUSE_DEV_TOKEN=dev-secret-change-me
#   WORLD_API_BASE_URL=http://localhost:8787
#   GHOST_HOUSE_PORT=4000         (default)
#   CATALOG_FILE_PATH=./catalog.json  (default)

# random-agent
cp ghosts/random-agent/.env.example ghosts/random-agent/.env
# Required fields:
#   GHOST_HOUSE_URL=http://localhost:4000
#   GHOST_HOUSE_DEV_TOKEN=dev-secret-change-me
#   AGENT_PORT=4001               (default)
```

---

## 2. Install workspace dependencies

```bash
pnpm install
```

---

## 3. Start the ghost house

```bash
pnpm --filter @aie-matrix/ghost-house dev
# Ghost house listening at http://localhost:4000
```

Verify it's up:

```bash
curl http://localhost:4000/v1/catalog
# → { "agents": [] }   (empty catalog on first run)
```

---

## 4. Start the random-agent

```bash
pnpm --filter @aie-matrix/random-agent dev
# random-agent listening at http://localhost:4001
```

Verify its agent card:

```bash
curl http://localhost:4001/.well-known/agent-card.json
# → { "name": "random-agent", "matrix": { "tier": "wanderer", ... } }
```

---

## 5. Register random-agent with the house

```bash
curl -X POST http://localhost:4000/v1/catalog/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-secret-change-me" \
  -d '{ "agentId": "random-agent", "baseUrl": "http://localhost:4001" }'
# → { "ok": true, "agentId": "random-agent" }
```

Confirm it appears in the catalog:

```bash
curl http://localhost:4000/v1/catalog
# → { "agents": [{ "agentId": "random-agent", "tier": "wanderer", ... }] }
```

---

## 6. Adopt a ghost via the world registry

```bash
# Create a caretaker
CARETAKER_ID=$(curl -sX POST http://localhost:8787/registry/caretakers \
  -H "Content-Type: application/json" \
  -d '{ "label": "quickstart" }' | jq -r .caretakerId)

# Register ghost house
GHOST_HOUSE_ID=$(curl -sX POST http://localhost:8787/registry/houses \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "quickstart-house" }' | jq -r .ghostHouseId)

# Adopt a ghost
ADOPT=$(curl -sX POST http://localhost:8787/registry/adopt \
  -H "Content-Type: application/json" \
  -d "{\"caretakerId\": \"$CARETAKER_ID\", \"ghostHouseId\": \"$GHOST_HOUSE_ID\"}")
GHOST_ID=$(echo $ADOPT | jq -r .ghostId)

echo "Ghost ID: $GHOST_ID"
```

---

## 7. Spawn random-agent for the ghost

```bash
SESSION=$(curl -sX POST "http://localhost:4000/v1/sessions/spawn/random-agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-secret-change-me" \
  -d "{\"ghostId\": \"$GHOST_ID\"}")
SESSION_ID=$(echo $SESSION | jq -r .sessionId)

echo "Session ID: $SESSION_ID"
# The ghost is now moving randomly in the world.
```

---

## 8. Run the Wanderer TCK

```bash
pnpm --filter @aie-matrix/tck run tck:wanderer
# [tck] wanderer PASS
```

---

## 9. Shut down the session

```bash
curl -X DELETE "http://localhost:4000/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer dev-secret-change-me"
# → { "ok": true, "sessionId": "..." }
```

---

## Environment Variables Reference

| Variable | Package | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `GHOST_HOUSE_DEV_TOKEN` | ghost-house, random-agent | yes | — | Static bearer token for Phase 1 auth (localhost only) |
| `WORLD_API_BASE_URL` | ghost-house | yes | — | World server base URL for MCP proxy forwarding |
| `GHOST_HOUSE_PORT` | ghost-house | no | `4000` | HTTP port |
| `CATALOG_FILE_PATH` | ghost-house | no | `./catalog.json` | Agent catalog persistence file |
| `AGENT_PORT` | random-agent | no | `4001` | HTTP port for agent A2A endpoint |
| `GHOST_HOUSE_URL` | random-agent | yes | — | Ghost house URL for registration and health checks |

---

## Troubleshooting

**Ghost house fails to start**: Check `WORLD_API_BASE_URL` is reachable — the MCP proxy needs a live world server.

**Registration returns 502**: The house cannot fetch the agent card from `baseUrl/.well-known/agent-card.json`. Confirm the agent is running and `AGENT_PORT` matches the URL used in registration.

**Spawn returns 503**: The agent is unreachable from the house. Confirm both are on localhost with correct ports.

**TCK fails at `wanderer` step**: Check that the session is active (`GET /v1/catalog`) and the ghost has a valid starting position in the world.
