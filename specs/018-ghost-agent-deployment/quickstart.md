# Quickstart: Ghost Agent Deployment (018)

## Prerequisites

- Local stack running: `pnpm dev` from repo root (starts world-api, Colyseus, Neo4j via `docker compose -f deploy/staging/docker-compose.dev.yml up -d`)
- Agent-host running: `pnpm dev` in `server/agent-host/` with `GHOST_HOUSE_DEV_TOKEN` set
- `random-agent` built: `pnpm build` in `ghosts/random-agent/`

## Tier 1 — Local run

### 1. Set env vars

```bash
# in ghosts/random-agent/.env (copy from .env.example)
AGENT_HOST_URL=http://127.0.0.1:4000
RANDOM_AGENT_PUBLIC_BASE_URL=http://127.0.0.1:4001
AGENT_HOST_TOKEN=dev-secret-change-me   # must match agent-host GHOST_HOUSE_DEV_TOKEN
AGENT_PORT=4001
```

### 2. Start the agent

```bash
pnpm dev   # in ghosts/random-agent/
```

Expected output:
```json
{"kind":"random-agent.start","publicBase":"http://127.0.0.1:4001","port":4001}
{"kind":"random-agent.registered","agentId":"random-agent-<hostname>"}
```

### 3. Verify registration

```bash
curl http://localhost:4000/v1/catalog | jq '.agents[] | {agentId, tier}'
# → {"agentId":"random-agent-<hostname>","tier":"wanderer"}
```

### 4. Spawn a ghost

```bash
# First adopt a ghost from the registry
CARETAKER=$(curl -sX POST http://localhost:8787/registry/caretakers \
  -H "Content-Type: application/json" \
  -d '{"label":"dev-walker"}' | jq -r .caretakerId)

HOUSE=$(curl -sX POST http://localhost:8787/registry/houses \
  -H "Content-Type: application/json" \
  -d '{"displayName":"local-house"}' | jq -r .agentHostId)

ADOPTED=$(curl -sX POST http://localhost:8787/registry/adopt \
  -H "Content-Type: application/json" \
  -d "{\"caretakerId\":\"$CARETAKER\",\"agentHostId\":\"$HOUSE\"}")

GHOST_ID=$(echo $ADOPTED | jq -r .ghostId)
CRED_TOKEN=$(echo $ADOPTED | jq -r .credential.token)
WORLD_URL=$(echo $ADOPTED | jq -r .credential.worldApiBaseUrl)

# Spawn via agent-host
curl -sX POST http://localhost:4000/v1/sessions/spawn/random-agent-$(hostname) \
  -H "Authorization: Bearer dev-secret-change-me" \
  -H "Content-Type: application/json" \
  -d "{\"ghostId\":\"$GHOST_ID\",\"credential\":{\"token\":\"$CRED_TOKEN\",\"worldApiBaseUrl\":\"$WORLD_URL\"}}"
# → {"sessionId":"...","agentId":"random-agent-<hostname>","ghostId":"..."}
```

The ghost begins moving within a few seconds. Verify in Neo4j browser or the Intermedium client.

---

## Tier 2 — Compose

### 1. Populate env file

```bash
cp deploy/staging/.env.staging.example deploy/staging/.env.staging
# Edit: set NEO4J_AUTH, NEO4J_PASSWORD, GHOST_HOUSE_DEV_TOKEN, RANDOM_AGENT_PUBLIC_BASE_URL
```

`RANDOM_AGENT_PUBLIC_BASE_URL` in compose is the URL the agent-host container uses to reach `random-agent`. Since they share the `aie-matrix` network, use: `http://random-agent:4001`.

### 2. Build and start

```bash
docker compose -f deploy/staging/docker-compose.yml up --build
```

All services should reach `healthy` within 5 minutes. `random-agent` appears last (depends on `agent-host`).

### 3. Verify

```bash
# Check catalog
curl http://localhost:4000/v1/catalog | jq '.agents'

# Check health
curl http://localhost:4001/health
# → {"status":"ok"}
```

### 4. Restart single service

```bash
docker compose -f deploy/staging/docker-compose.yml restart random-agent
# Should re-register within 30s
```

---

## Tier 3 — Kubernetes (GKE staging)

### 1. Push image

```bash
docker build -f ghosts/random-agent/Dockerfile -t gcr.io/<PROJECT>/random-agent:$(git rev-parse --short HEAD) .
docker push gcr.io/<PROJECT>/random-agent:$(git rev-parse --short HEAD)
```

### 2. Create secret (first time only)

```bash
kubectl create secret generic agent-host-token \
  --from-literal=AGENT_HOST_TOKEN="<strong-random-token>"
```

### 3. Apply manifests

```bash
kubectl apply -f deploy/k8s/ghosts/random-agent.yaml
kubectl rollout status deployment/random-agent
```

### 4. Verify

```bash
# Port-forward to agent-host
kubectl port-forward svc/agent-host 4000:4000 &

curl http://localhost:4000/v1/catalog | jq '.agents'
# → includes random-agent-<pod-name> entries

# Scale
kubectl scale deployment/random-agent --replicas=3
# → three distinct catalog entries appear
```

---

## Environment variable reference

| Variable | Used by | Required |
|---|---|---|
| `AGENT_HOST_URL` | random-agent | yes |
| `AGENT_HOST_TOKEN` | random-agent, agent-host | yes |
| `RANDOM_AGENT_PUBLIC_BASE_URL` | random-agent | yes (Tier 2/3) |
| `AGENT_PORT` | random-agent | no (default 4001) |
| `AGENT_REGISTER_TIMEOUT` | random-agent | no (default 120s) |
| `GHOST_HOUSE_DEV_TOKEN` | agent-host | yes (same value as `AGENT_HOST_TOKEN`) |

**Note**: `GHOST_HOUSE_DEV_TOKEN` (agent-host) and `AGENT_HOST_TOKEN` (ghosts) must match. They are the same credential; the name difference is a pending rename tracked separately.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `random-agent.registration-timeout` in logs | Agent-host not ready or wrong `AGENT_HOST_URL` | Check agent-host health: `curl $AGENT_HOST_URL/health` |
| 409 on `DELETE /v1/catalog/:agentId` at startup | Active sessions from previous instance | Wait for supervisor health-check timeout (30s), then restart again |
| Ghost registered but not moving | No spawn triggered | Call `POST /v1/sessions/spawn/:agentId` manually |
| `curl: (7) Failed to connect` on health check | Wrong port or container not started | Confirm `AGENT_PORT` matches the mapped container port |
