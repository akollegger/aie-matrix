# IC-002: `GET /maps/:mapId` HTTP API Contract

**Contract ID**: IC-002  
**Feature**: `012-tmj-to-gram`  
**Related RFC**: `proposals/rfc/0009-map-format-pipeline.md`

## Purpose

Defines the HTTP interface for the `MapRoutes` handler mounted in `server/world-api`. Consumers must be able to rely on this contract without inspecting the server source.

## Endpoint

```
GET /maps/:mapId
GET /maps/:mapId?format=gram
GET /maps/:mapId?format=tmj
```

Mounted on the world-api router alongside `/mcp` and `/registry`.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `mapId` | string | The map identifier. Matches the `name` field from the gram document header. Case-sensitive. |

### Query Parameters

| Parameter | Values | Default | Description |
|---|---|---|---|
| `format` | `"gram"` \| `"tmj"` | `"gram"` | The file format to return. Omitting the parameter is equivalent to `?format=gram`. |

## Responses

### 200 OK

Returned when the `mapId` is known and the format is supported.

**When `format=gram` (or omitted):**

```
Content-Type: text/plain; charset=utf-8
```

Body: the raw bytes of `maps/<scene>/<mapId>.map.gram`. No transformation or parsing is applied — the file is streamed as-is. The body is a valid gram document conforming to IC-001.

**When `format=tmj`:**

```
Content-Type: application/json
```

Body: the raw bytes of `maps/<scene>/<mapId>.tmj`. No transformation. The body is the original Tiled map JSON.

### 404 Not Found

Returned when `mapId` is not in the `MapService` index.

```json
{
  "error": "MapNotFoundError",
  "message": "Map 'unknown-map' not found.",
  "mapId": "<mapId>"
}
```

The `MapNotFoundError` tagged error MUST have a `Match.tag` branch in `server/src/errors.ts:errorToResponse()`.

### 400 Bad Request

Returned when `format` is present but its value is neither `"gram"` nor `"tmj"`.

```json
{
  "error": "UnsupportedFormatError",
  "message": "Unsupported format 'xyz'. Supported formats: gram, tmj.",
  "requested": "<value>"
}
```

The `UnsupportedFormatError` tagged error MUST have a `Match.tag` branch in `server/src/errors.ts:errorToResponse()`.

### 500 Internal Server Error

Returned on unexpected file I/O failure after a successful index lookup. Follows the existing world-api error envelope shape.

## Behaviour Notes

- Serving is byte-passthrough (no re-parsing on the request path). The gram is not validated on every request — `MapService.validate()` runs once at startup.
- Request tracing and structured logging follow `docs/guides/effect-ts.md` patterns, consistent with other world-api routes.
- The endpoint is additive. No existing routes are removed or modified.

## Contract Test Expectations

These are the assertions the HTTP contract tests in `tools/tmj-to-gram/test/` and `server/world-api/test/` must verify:

| Test case | Request | Expected status | Expected Content-Type |
|---|---|---|---|
| Gram default | `GET /maps/freeplay` | 200 | `text/plain; charset=utf-8` |
| Gram explicit | `GET /maps/freeplay?format=gram` | 200 | `text/plain; charset=utf-8` |
| TMJ | `GET /maps/freeplay?format=tmj` | 200 | `application/json` |
| Unknown map | `GET /maps/does-not-exist` | 404 | `application/json` |
| Unknown format | `GET /maps/freeplay?format=xml` | 400 | `application/json` |

## Downstream Consumers

| Consumer | Format | Notes |
|---|---|---|
| Intermedium (RFC-0008) | `?format=gram` | Parses gram with `@relateby/pattern` |
| Phaser debugger | `?format=tmj` | Parses JSON as Tiled map; no code change required |
| CI health check | `?format=gram` | Asserts 200 after server startup |
