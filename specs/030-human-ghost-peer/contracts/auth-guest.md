# Contract: POST /auth/guest

**Package**: `server/world-api`
**Route**: `POST /auth/guest`
**Auth**: None (endpoint is open within the Google IAP perimeter)

## Request

```json
{ "ghostId": "01JXYZ..." }
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `ghostId` | string | yes | Non-empty, ≤128 chars |

## Response (200 OK)

```json
{ "token": "<signed-jwt>" }
```

The token is a JWT signed with `AIE_MATRIX_DEV_JWT_SECRET`, TTL 8h, claims:

```json
{
  "sub": "<ghostId>",
  "ghostId": "<ghostId>",
  "role": "human",
  "iat": 1234567890,
  "exp": 1234567890
}
```

## Error Responses

| Status | Condition |
|--------|-----------|
| 400 | `ghostId` missing or exceeds 128 chars |

## Downstream Consumers

- `clients/intermedium` — calls on first load, stores token in memory, passes as `Authorization: Bearer <token>` on all MCP requests
- `server/world-api/src/auth-context.ts` — verifies the token; `role: "human"` flows into `auth.extra.role`
- `server/world-api/src/mcp-server.ts` spawn-grant — reads `auth.extra.role` to look up `:Grants { human: N }` in map gram
