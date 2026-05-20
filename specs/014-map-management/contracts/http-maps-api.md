# IC-001: HTTP `/maps/` API Contract

**Owner**: `server/world-api/src/map/MapManagementRoutes.ts`  
**Consumers**: Operator tooling (curl / admin scripts); downstream: `/live/` activation

All endpoints require `Authorization: Bearer {ADMIN_TOKEN}`. Missing or invalid token → `401`.

---

## `POST /maps`

Publish or replace a map artifact. Validates, uploads to GCS, syncs cells to Neo4j.

**Request**
```
Content-Type: multipart/form-data
  mapId  string   required — logical name; GCS key; alphanumeric + hyphens
  file   .map.gram  required — artifact bytes
```
No `itemsSidecar` parameter. Items, tile types, and rules are encoded in the `.map.gram`.

**Success response** `201 Created`
```json
{ "mapId": "sandbox-freeplay", "gcsPath": "gs://aie-matrix-maps/maps/sandbox-freeplay.map.gram", "status": "published" }
```

**Idempotent re-publish (same content, already published)** `200 OK` — same body, no writes.

**Re-publish of archived map** `200 OK` — status reverts to `"published"`; cells re-synced if content changed.

**Error responses**
| Status | Condition |
|---|---|
| `400` | Missing `mapId` or `file` field |
| `422` | Gram validation fails (bad header, missing LayerStack, cells without h3Index) |
| `500` | GCS upload or Neo4j sync failure |

---

## `GET /maps`

List maps.

**Query params**: `?status=published` (default) or `?status=archived`

**Response** `200 OK`
```json
[
  { "mapId": "sandbox-freeplay", "status": "published", "publishedAt": "2026-05-17T10:00:00Z", "gcsPath": "gs://..." },
  ...
]
```

---

## `GET /maps/:mapId`

Fetch metadata for one map.

**Response** `200 OK` — same shape as one element from `GET /maps`.  
**Error** `404` if map not found.

---

## `DELETE /maps/:mapId`

Archive a map. Retains GCS object.

**Response** `204 No Content` on success.

**Error responses**
| Status | Condition |
|---|---|
| `404` | Map not found |
| `409 Conflict` | Map is referenced by an active `LiveSession` |
