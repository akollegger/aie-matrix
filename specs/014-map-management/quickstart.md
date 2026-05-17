# Quickstart: Map Management (Local Verification)

**Branch**: `015-map-management` | **Date**: 2026-05-17

This guide covers **Tier 1 local dev** only. Tier 2 (staging) and Tier 3 (production) deployment are deferred to the ADR-0007 follow-on.

**Three operating modes:**
- `AIE_MATRIX_MAP` set, no DBs → existing file-based path; `/maps/` and `/live/` return `503` (map management not available)
- `NEO4J_URI` set, `GCS_BUCKET` + `REDIS_URL` unset → **this guide's mode**; GCS stub + Redis no-op; full map management available
- All vars set → Tier 2/3 (out of scope here)

---

## Prerequisites

- `pnpm install` completed
- Neo4j running locally (Docker Desktop one-liner or native install):
  ```
  docker run -d --name neo4j-dev \
    -p 7474:7474 -p 7687:7687 \
    -e NEO4J_AUTH=neo4j/devpassword \
    neo4j:5
  ```
- `.env` file in repo root with:
  ```
  NEO4J_URI=bolt://localhost:7687
  NEO4J_USER=neo4j
  NEO4J_PASSWORD=devpassword
  ADMIN_TOKEN=dev-admin-secret
  # GCS_BUCKET omitted → local file stub
  # REDIS_URL omitted → no-op pub/sub
  ```
- Server started: `pnpm dev`

---

## Story 1: Publish a Map

```bash
curl -s -X POST http://localhost:8787/maps \
  -H "Authorization: Bearer dev-admin-secret" \
  -F "mapId=sandbox-freeplay" \
  -F "file=@maps/sandbox/freeplay.map.gram"
```

**Expected**:
```json
{ "mapId": "sandbox-freeplay", "gcsPath": "...", "status": "published" }
```

Verify cells in Neo4j (Cypher in Neo4j Browser at http://localhost:7474):
```cypher
MATCH (c:Tile { sourceMapId: "sandbox-freeplay" }) RETURN count(c)
```
Should return a non-zero count.

---

## Story 2: Start a Live Session

```bash
SESSION=$(curl -s -X POST http://localhost:8787/live \
  -H "Authorization: Bearer dev-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Dev Session","maps":[{"mapId":"sandbox-freeplay","role":"primary"}]}' \
  | jq -r '.id')
echo "Session ID: $SESSION"
```

**Expected**: response with `"status": "active"`.

Confirm it appears in the active list:
```bash
curl -s http://localhost:8787/live?status=active | jq '.[] | .id'
```

---

## Story 3: Switch Map on a Running Session

Publish a second map first:
```bash
curl -s -X POST http://localhost:8787/maps \
  -H "Authorization: Bearer dev-admin-secret" \
  -F "mapId=sandbox-canonical" \
  -F "file=@maps/sandbox/canonical.map.gram"
```

Switch the session:
```bash
curl -s -X PATCH "http://localhost:8787/live/$SESSION/maps" \
  -H "Authorization: Bearer dev-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"maps":[{"mapId":"sandbox-canonical","role":"primary"}]}'
```

**Expected**: response has `maps[0].mapId == "sandbox-canonical"`.

Register a ghost and move to a cell that only existed in `sandbox-freeplay`:
```bash
# attempt go to a removed cell — should return CELL_NOT_IN_MAP
```

---

## Story 4: Archive a Map and End a Session

End the session:
```bash
curl -s -X DELETE "http://localhost:8787/live/$SESSION" \
  -H "Authorization: Bearer dev-admin-secret"
```
**Expected**: `204 No Content`.

Verify session is gone from active list:
```bash
curl -s "http://localhost:8787/live?status=active" | jq 'length'
# → 0
```

Archive the map:
```bash
curl -s -X DELETE http://localhost:8787/maps/sandbox-freeplay \
  -H "Authorization: Bearer dev-admin-secret"
```
**Expected**: `204 No Content`.

Attempt to archive a map still in use (should fail):
```bash
# Start a fresh session with sandbox-canonical, then try to archive it
NEW_SESSION=$(curl -s -X POST http://localhost:8787/live \
  -H "Authorization: Bearer dev-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","maps":[{"mapId":"sandbox-canonical","role":"primary"}]}' \
  | jq -r '.id')

curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE http://localhost:8787/maps/sandbox-canonical \
  -H "Authorization: Bearer dev-admin-secret"
# → 409
```

---

## Health Endpoint

```bash
curl -s http://localhost:8787/health
# Before session binding: {"status":"starting"} with 503
# After session binding:  {"status":"ok","sessionId":"..."} with 200
```

---

## Expected completion time

~20 minutes for a contributor familiar with the codebase who has Neo4j running.
