# Contract: Health Endpoint (IC-001)

**Feature**: 016-staging-deployment  
**Applies to**: `server` (combined), `ghosts/agent-host`  
**Used by**: Docker Compose `depends_on: condition: service_healthy`; Kubernetes readiness probes (Tier 3)

## Route

```
GET /health
```

No authentication required. Must be reachable before any other route is served.

## Response Schema

```json
{
  "status": "ok" | "starting" | "degraded",
  "checks": {
    "<dependency-name>": true | false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok"` \| `"starting"` \| `"degraded"` | `"ok"` only when all checks pass; `"starting"` during initialisation; `"degraded"` if any check fails but the process is still running |
| `checks` | `Record<string, boolean>` | Named dependency checks; `true` = reachable/healthy |

## HTTP Status Codes

| Code | Meaning | Compose behaviour |
|------|---------|------------------|
| 200 | All checks pass (`"ok"`) | Marks container `healthy` |
| 503 | Any check fails or still starting | Compose retries up to `retries` limit |
| Any other / connection refused | Process not ready | Compose retries |

## Per-Service Check Map

### `server` (combined)

```json
{
  "status": "ok",
  "checks": {
    "neo4j": true
  }
}
```

Neo4j must be reachable via the configured `NEO4J_URI` before `/health` returns 200. The existing `spectatorMetaReady` gate is preserved but the check map is added.

### `agent-host`

```json
{
  "status": "ok",
  "checks": {
    "world-api": true
  }
}
```

The combined server's HTTP endpoint must respond before agent-host returns 200. (In compose, this is already enforced by `depends_on: condition: service_healthy` on the `server` service, but the check confirms runtime connectivity.)

## Compose Health Check Config

```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:<PORT>/health"]
  interval: 10s
  timeout: 5s
  retries: 12
  start_period: 30s
```

`wget` is present in the default Node.js Docker images; `curl` may not be. Adjust `<PORT>` per service.

## Compatibility Note

This contract is intentionally minimal so it can be implemented as a raw Node.js `prependListener` (matching the existing pattern in `server/src/index.ts`) without introducing a new HTTP framework dependency. Kubernetes readiness probes hit the same endpoint; the JSON body is optional for probes but aids debugging.
