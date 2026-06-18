# Quickstart: Resilient Service Components

## Local Development Setup

### Prerequisites

- Node.js 24, pnpm 10
- Podman or Docker (for Redis)
- `kubectl` configured for `gke_aie-matrix_us-central1_aie-matrix-prod` (for chaos testing)

### Start Redis locally

```bash
# Podman
podman run -d --name aie-redis -p 6379:6379 redis:7-alpine

# Docker
docker run -d --name aie-redis -p 6379:6379 redis:7-alpine
```

### Environment variables

Add to `server/agent-host/.env` (or `server/agent-host/.env.local`):

```env
REDIS_URL=redis://localhost:6379
AGENT_HOST_TOKEN=dev-token
CATALOG_FILE_PATH=/tmp/catalog.json
```

Add to `ghosts/random-agent/.env`:

```env
AGENT_HOST_URL=http://localhost:4000
AGENT_HOST_TOKEN=dev-token
```

### Run unit tests

```bash
# agent-host (includes RedisCatalogService unit tests with mock Redis)
cd server/agent-host && pnpm test

# npc-agent (includes reconnect tests)
cd ghosts/npc-agent && pnpm test

# random-agent (includes heartbeat and reconciliation tests)
cd ghosts/random-agent && pnpm test
```

### Run integration tests (requires Redis)

```bash
REDIS_URL=redis://localhost:6379 pnpm test --run integration
```

Integration tests are skipped automatically when `REDIS_URL` is not set.

### Smoke test: heartbeat endpoint

With agent-host running locally:

```bash
# 1. Register an agent
curl -s -X POST http://localhost:4000/v1/catalog/register \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"test-agent","baseUrl":"http://localhost:4999"}'

# 2. Send a heartbeat
curl -s -X POST http://localhost:4000/v1/catalog/test-agent/heartbeat \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"ts":"2026-06-18T12:00:00.000Z"}'
# Expected: { "sessionActive": false }

# 3. Heartbeat for unknown agent
curl -s -X POST http://localhost:4000/v1/catalog/unknown/heartbeat \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"ts":"2026-06-18T12:00:00.000Z"}'
# Expected: 404 { "error": "agent not registered" }
```

### Smoke test: catalog durability

```bash
# 1. Start agent-host with Redis; register an agent (see above)
# 2. Restart agent-host (Ctrl+C, restart)
# 3. Query catalog immediately after startup
curl -s http://localhost:4000/v1/catalog \
  -H "Authorization: Bearer dev-token"
# Expected: test-agent appears with healthStatus "unverified" before first ping
```

---

## Chaos Runbook (Production)

Run these scenarios against `gke_aie-matrix_us-central1_aie-matrix-prod` to validate resilience behavior. Observe the Intermedium client at https://matrix.neo4j.gg.

### Scenario 1: agent-host pod restart

```bash
kubectl rollout restart deployment/agent-host -n aie-matrix
kubectl rollout status deployment/agent-host -n aie-matrix --watch
```

**Expected outcome**:
- agent-host becomes ready in ~30s
- Catalog restored from Redis within 5s of readiness (check: `kubectl logs -n aie-matrix <new-pod> | grep catalog`)
- random-agent heartbeat fires within 30s, detects session, reconciles roster
- Wanderer ghosts visible in Intermedium within 3 minutes of restart

**Failure indicators**:
- `no-roster-agents` log event → Redis restore failed or heartbeat not firing
- `tick-error` spam in npc-agent → unrelated to this scenario (npc-agent unaffected by agent-host restart)

---

### Scenario 2: npc-agent pod restart

```bash
kubectl rollout restart deployment/npc-agent -n aie-matrix
kubectl rollout status deployment/npc-agent -n aie-matrix --watch
```

**Expected outcome**:
- npc-agent re-registers with agent-host within 10s of readiness
- NPC ghosts (be27b74e, 029ec6a7, 0eb9a868) resume ticking within 90s
- No `tick-error` logs after initial connection

---

### Scenario 3: server pod restart (tests npc-agent MCP reconnect)

```bash
kubectl rollout restart deployment/server -n aie-matrix
kubectl rollout status deployment/server -n aie-matrix --watch
```

**Expected outcome**:
- npc-agent logs `npc-agent.mcp.degraded` events for each ghost (one per ghost, not one per tick)
- After server recovers (~30s), npc-agent logs `npc-agent.mcp.recovered` for each ghost
- NPC ghosts resume position updates in Intermedium within 90s of server readiness

**Failure indicators**:
- Continuous `tick-error` stream → reconnect logic not working; check backoff schedule
- `npc-agent.mcp.degraded` never emitted → consecutive failure counter not triggered

---

### Scenario 4: scale agent-host to zero and back

```bash
# Scale down
kubectl scale deployment/agent-host --replicas=0 -n aie-matrix

# Wait 2 minutes (longer than heartbeat interval)
sleep 120

# Scale back up
kubectl scale deployment/agent-host --replicas=1 -n aie-matrix
kubectl rollout status deployment/agent-host -n aie-matrix --watch
```

**Expected outcome**:
- Catalog restored from Redis immediately
- random-agent's next heartbeat (within 30s) triggers roster reconciliation
- Wanderers present in Intermedium within 3 minutes of agent-host becoming ready
- No duplicate ghosts (reconciliation correctly detects existing ghosts)

**Failure indicators**:
- More than `RANDOM_AGENT_COUNT` (default 10) wanderers appear → double-spawn; check reconciliation logic
- Zero wanderers after 3 minutes → world API ghost query failing or heartbeat not firing

---

## Observability

Key structured log events to monitor:

| Event kind | Service | Meaning |
|---|---|---|
| `agent-host.catalog.redis-restore` | agent-host | Catalog loaded from Redis on startup |
| `agent-host.catalog.redis-restore-empty` | agent-host | Redis had no catalog; starting fresh |
| `agent-host.heartbeat.received` | agent-host | Agent sent heartbeat; `lastSeenAt` updated |
| `npc-agent.mcp.degraded` | npc-agent | Ghost entering reconnect backoff |
| `npc-agent.mcp.recovered` | npc-agent | Ghost resumed ticking after reconnect |
| `random-agent.heartbeat.session-change` | random-agent | New session detected; triggering reconciliation |
| `random-agent.reconciliation.spawning` | random-agent | Roster diff computed; spawning N ghosts |
| `random-agent.reconciliation.no-op` | random-agent | All ghosts present; no spawn needed |
