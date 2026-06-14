# Quickstart: Human Ghost Peer (local dev)

## Prerequisites

- `pnpm install` from repo root
- Neo4j running (see `docs/guides/neo4j-local.md`)
- `.env` configured with `AIE_MATRIX_DEV_JWT_SECRET`

## Start the server stack

```bash
pnpm dev
```

This starts world-api, Colyseus, and npc-agent in watch mode.

## Verify guest token issuance

```bash
curl -X POST http://localhost:3000/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"ghostId":"01TEST000000000000000000000"}'
# → { "token": "eyJ..." }
```

Decode the token at jwt.io and confirm `role: "human"` is present.

## Verify spawn-grant for human role

Using the token from above:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"inventory","arguments":{}}}'
# → holdings should include broker-credit grant amount
```

## Verify human directed say()

```bash
# First get a broker ghostId from the Colyseus room or NPC agent
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"say","arguments":{"content":"accept","to":"<broker-ghostId>","intent":"agree"}}}'
# → should succeed without ConversationGhostNoPosition error
```

## Start the Intermedium client

```bash
cd clients/intermedium && pnpm dev
```

Open `http://localhost:5173`. On first load:
- Check browser DevTools → Application → Local Storage for `ghostId` and `displayName`
- HUD should show display name and credit balance
- Ghost list should show broker ghosts with a "Broker" badge

## Run unit tests

```bash
# Server conversation service
cd server/conversation && pnpm test

# World-api (includes guest-auth-route tests)
cd server/world-api && pnpm test
```
