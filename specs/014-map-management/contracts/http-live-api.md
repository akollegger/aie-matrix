# IC-002 / IC-003: HTTP `/live/` API Contract

**Owner**: `server/world-api/src/live/LiveSessionRoutes.ts`  
**Consumers**: Operator tooling; server processes (startup binding); browser clients (Intermedium session discovery)

All write endpoints (`POST`, `PATCH`, `DELETE`) require `Authorization: Bearer {ADMIN_TOKEN}`.  
Read endpoints (`GET`) are public (no auth required — session list is needed by browser clients).

---

## Session Object Shape

```json
{
  "id": "01JVXYZ...",
  "name": "AIEWF 2026 Main",
  "status": "active",
  "startedAt": "2026-06-29T09:00:00Z",
  "endedAt": null,
  "world": { "name": "AIEWF 2026 Main" },
  "maps": [
    { "mapId": "moscone-west-l2", "role": "primary", "gcsPath": "gs://..." }
  ]
}
```

The `world` key is present for API forward-compatibility; it mirrors `name` in v1 (no separate `(:World)` node).

---

## `POST /live` (IC-002)

Start a live session. Lightweight — cells already in Neo4j from publish time.

**Request**
```json
{ "name": "AIEWF 2026 Main", "maps": [{ "mapId": "moscone-west-l2", "role": "primary" }] }
```

**Server steps**:
1. Resolve each `mapId` to a `(:Map { status: "published" })`. Reject with `422` if unknown or archived.
2. Create `(:LiveSession { id: ulid(), name, status: "active", startedAt: now() })`.
3. Create `[:USES { role }]` edges.
4. Publish `world.session-started` to `aie-matrix:world-events`.
5. Return session object.

**Response** `201 Created` — full session object.

**Error responses**
| Status | Condition |
|---|---|
| `422` | Any `mapId` unknown, archived, or cells not yet synced |
| `400` | Malformed JSON or missing required fields |

---

## `GET /live`

List sessions. **Public endpoint** (no auth).

**Query params**: `?status=active` (default) or `?status=ended`

**Response** `200 OK` — array of session objects.

---

## `GET /live/:id`

Return detail for one session. **Public endpoint**.

**Response** `200 OK` — session object.  
**Error** `404` if not found.

---

## `PATCH /live/:id/maps` (IC-003)

Switch map(s) on a running session. Admin-only.

**Request**
```json
{ "maps": [{ "mapId": "moscone-west-l3", "role": "primary" }] }
```

**Server steps**:
1. Resolve new `mapId` values (same `422` rules as `POST /live`).
2. Query Neo4j for `removedCells` (old primary cells not in new set) and `addedCells` (new cells not in old set). No GCS download.
3. Delete old `[:USES]` edges, create new ones.
4. Publish `world.map-changed` to `aie-matrix:world-events` (see `redis-events.md`).
5. Return updated session object.

**Response** `200 OK` — updated session object.

---

## `DELETE /live/:id`

End a live session. Admin-only. Does not archive maps.

**Server steps**:
1. Set `status = "ended"`, `endedAt = now()`.
2. Publish `world.session-ended` to `aie-matrix:world-events`.
3. Return `204`.

**Response** `204 No Content`.  
**Error** `404` if session not found or already ended.
