# IC-005 / IC-006: Session Binding and Health Endpoint Contract

---

## IC-005: `LIVE_SESSION_ID` — Server Process Session Binding

**Consumers**: `server/world-api/`, `server/colyseus/`, `ghosts/ghost-house/`  
**Set by**: Kubernetes `Deployment` env (Tier 3) or `docker-compose.yml` env (Tier 2)

### Startup resolution order

```
if AIE_MATRIX_MAP is set:
  → Tier 1 local dev; load from local file; no session binding needed
elif LIVE_SESSION_ID is set:
  → fetch GET /live/{LIVE_SESSION_ID}
  → find maps[role="primary"].gcsPath
  → download and load from GCS
  → if session not found or status != "active": FATAL — log and exit(1)
else:
  → fetch GET /live?status=active
  → if result.length == 1: proceed as above
  → if result.length != 1: FATAL — log "LIVE_SESSION_ID required when multiple sessions exist" and exit(1)
```

### Env var definition

| Variable | Type | Notes |
|---|---|---|
| `LIVE_SESSION_ID` | string (ULID) | The session this process instance serves. Must be set in multi-session deployments. |

Added to `@aie-matrix/root-env` alongside `GCS_BUCKET` and `ADMIN_TOKEN`.

---

## IC-006: `/health` — Readiness Endpoint

**Owners**: `server/world-api/`, `server/colyseus/`, `ghosts/ghost-house/`  
**Consumer**: Kubernetes `readinessProbe` (and docker-compose `healthcheck`)

### Contract

| State | Response | Notes |
|---|---|---|
| Service starting (pre-session binding) | `503 Service Unavailable` | `{ "status": "starting" }` |
| Session binding in progress | `503 Service Unavailable` | `{ "status": "binding" }` |
| Session bound, map context loaded | `200 OK` | `{ "status": "ok", "sessionId": "..." }` |
| Session ended (received `world.session-ended`) | `503 Service Unavailable` | `{ "status": "session-ended" }` |

Kubernetes withholds traffic until `/health` returns `200`. No traffic is routed to a process that has not yet established its session binding.

### Existing `/spectator/room` precedent

`server/src/index.ts` already implements a `503 → 200` pattern for `/spectator/room` using a `spectatorMetaReady` flag (lines 145–165). The `/health` endpoint follows the same pattern: a module-level `sessionReady` flag flips to `true` after the startup session-binding sequence completes.
