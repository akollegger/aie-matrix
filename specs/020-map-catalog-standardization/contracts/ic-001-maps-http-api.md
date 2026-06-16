# IC-001: Maps HTTP API (Gram-Only)

**Spec**: `specs/020-map-catalog-standardization`  
**Supersedes**: `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`  
**Status**: Proposed  
**Date**: 2026-05-25

## Summary

The `/maps` HTTP endpoints serve `.map.gram` content only. The `?format=tmj` query parameter and the `_links.tmj` response field are removed. All TMJ-format paths return `400 Bad Request`.

## Endpoints

### `GET /maps` — List All Maps

**Response** `200 application/json`:

```json
[
  {
    "mapId": "freeplay",
    "name": "Freeplay",
    "_links": {
      "self": "/maps/freeplay",
      "gram": "/maps/freeplay?format=gram"
    }
  }
]
```

**Removed from prior IC-002**: `_links.tmj` field is absent.

---

### `GET /maps/:mapId` — Get Map Metadata

**Response** `200 application/json`:

```json
{
  "mapId": "moscone-west",
  "name": "Moscone West",
  "_links": {
    "self": "/maps/moscone-west",
    "gram": "/maps/moscone-west?format=gram"
  }
}
```

**Response** `404 application/json` if `mapId` is not in the catalog:

```json
{ "error": "map not found", "mapId": "unknown-map" }
```

---

### `GET /maps/:mapId?format=gram` — Download Gram File

**Response** `200 text/plain; charset=utf-8`: raw `.map.gram` bytes  
**Response** `404` if map not found

---

### `GET /maps/:mapId?format=tmj` — **Removed**

**Response** `400 application/json`:

```json
{ "error": "unsupported format", "message": "Only 'gram' is supported. TMJ format is no longer served." }
```

---

## TypeScript Interface Changes

### `MapIndexEntry` (was in `server/world-api/src/map/MapService.ts`)

**Before (IC-002)**:
```typescript
interface MapIndexEntry {
  readonly mapId: string;
  readonly tmjPath?: string;   // ← removed
  readonly gramPath: string;
}
```

**After (this contract)**:
```typescript
interface MapIndexEntry {
  readonly mapId: string;
  readonly gramPath: string;
}
```

### `MapServiceOps.raw()` signature

**Before**:
```typescript
raw(mapId: string, format: "gram" | "tmj"): Effect.Effect<Buffer, MapNotFoundError | MapFileReadError>
```

**After**:
```typescript
raw(mapId: string): Effect.Effect<Buffer, MapNotFoundError | MapFileReadError>
```

---

## Downstream Consumers

| Consumer | Current usage | Action required |
|----------|--------------|-----------------|
| `clients/intermedium` | `GET /maps` then `?format=gram` | No change — already gram-only |
| CI health check | `GET /maps/freeplay?format=gram` | No change |
| Admin UI | `GET /maps` listing | Remove any `tmj` link rendering |
| Phaser debugger (AIEWF legacy) | `?format=tmj` (noted in IC-002) | Accept breaking change — tool is retired |

---

## Validation

The server MUST validate each `.map.gram` file on startup via the existing `MapService.validate()` path. No TMJ validation is needed or performed.
