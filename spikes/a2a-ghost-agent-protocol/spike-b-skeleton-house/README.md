# Spike B — skeleton ghost house (catalog + spawn + synthetic event)

## Primary registration path (FR-005)

**`POST /v1/catalog/register`** — JSON body:

```json
{ "agentId": "demo", "baseUrl": "http://127.0.0.1:4731" }
```

The house fetches `/.well-known/agent-card.json` from `baseUrl` to verify the agent is reachable, then stores the catalog entry. For this spike, **`baseUrl` must be `http(s)://127.0.0.1:…` or `http(s)://localhost:…`** (loopback only); outbound fetches use a **15s** timeout.

## Other endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/catalog` | List registered agents |
| `POST` | `/v1/catalog/spawn/:agentId` | Spawn handshake (`house:spawn` A2A message); logs `[SESSION_START]` |
| `POST` | `/v1/sessions/:sessionId/synthetic-event` | Sends IC-008-shaped `data` message to the agent |

## Run (two terminals)

**Terminal 1 — sample agent** (default `PORT=4731`):

```bash
cd spikes/a2a-ghost-agent-protocol/spike-b-sample-agent
npm install
npm run dev
```

**Terminal 2 — house** (`HOUSE_PORT` default `4730`; invalid values fall back to `4730`):

```bash
cd spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house
npm install
npm run dev
```

**Register → spawn → synthetic event:**

```bash
curl -sS -X POST http://127.0.0.1:4730/v1/catalog/register \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"demo","baseUrl":"http://127.0.0.1:4731"}'

SID=$(curl -sS -X POST http://127.0.0.1:4730/v1/catalog/spawn/demo | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).sessionId))")
curl -sS -X POST "http://127.0.0.1:4730/v1/sessions/${SID}/synthetic-event"
```

## Auth

None (local). Production authentication remains an **open question** for ADR-0004.
