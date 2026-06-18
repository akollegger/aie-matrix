# Contract: Agent Heartbeat Endpoint

**IC-001** | Owner: `server/agent-host` | Consumers: `ghosts/npc-agent`, `ghosts/random-agent`, any future registered agent

## Endpoint

```
POST /v1/catalog/:agentId/heartbeat
```

Cluster-internal only. Not exposed via ingress or load balancer. Callers must be co-located in the `aie-matrix` Kubernetes namespace.

## Authentication

```
Authorization: Bearer <AGENT_HOST_TOKEN>
```

Same bearer token as `POST /v1/catalog/register`. Requests without a valid token receive `401 Unauthorized`.

## Request

```
Content-Type: application/json

{
  "ts": "<ISO 8601 timestamp>"   // required; agent's current clock time
}
```

`ts` is recorded for observability only; agent-host does not validate clock skew.

## Responses

### 200 OK — agent registered, session active

```json
{
  "sessionActive": true,
  "sessionId": "01KVDBB8A67TQW6GEM5DYS18MH"
}
```

### 200 OK — agent registered, no active session

```json
{
  "sessionActive": false
}
```

### 404 Not Found — agent not in catalog

```json
{
  "error": "agent not registered"
}
```

The agent must call `POST /v1/catalog/register` before using the heartbeat endpoint.

### 401 Unauthorized — missing or invalid token

```json
{
  "error": "unauthorized"
}
```

### 503 Service Unavailable — agent-host cannot reach world-api to determine session state

```json
{
  "error": "session state unavailable"
}
```

Agents SHOULD treat 503 as a transient error and retry at the next heartbeat interval. Do not trigger roster reconciliation on a 503.

## Side Effects

1. Updates `CatalogEntry.lastSeenAt` to the current server time (not the `ts` from the request)
2. Sets `CatalogEntry.healthStatus` to `"active"`
3. **Does not** trigger `spawnRosterForAgent` — spawn decisions are delegated to the calling agent

## Session State Caching

Agent-host caches the world-api session query (`GET /live?status=active`) for up to 10 seconds. Heartbeat responses may reflect session state up to 10 seconds stale. This is acceptable given the 30-second heartbeat interval.

## Consumer Behavior

Agents MUST:
- Call this endpoint every 30 seconds (±5s jitter) after successful registration
- Compare the returned `sessionId` with their last-known session ID
- Trigger roster reconciliation when `sessionId` differs from the stored value
- Treat `sessionActive: false` as "no action" — do not despawn existing ghosts
- Treat 5xx responses as transient — retry at next interval without triggering reconciliation

Agents MUST NOT:
- Use this endpoint as a substitute for initial registration
- Spawn ghosts directly in response to a heartbeat — always query the world API for existing ghost state first (roster reconciliation)

## Downstream Consumers

| Consumer | File | Behavior on session change |
|---|---|---|
| `random-agent` | `ghosts/random-agent/src/heartbeat.ts` | Calls `reconcileRoster()` → spawns delta |
| `npc-agent` | `ghosts/npc-agent/src/agent.ts` | No roster action needed (agent-host manages NPC sessions) |

## Versioning

This is an internal cluster endpoint. No versioning policy applies. Breaking changes require updating all consumers in the same PR.
