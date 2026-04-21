# HTTP API Contract: Conversation Store

**Base path**: `/threads`  
**Auth**: `Authorization: Bearer <ghost_house_api_key>`  
**Content-Type**: `application/json`

One API key is scoped to a ghost house and grants read access to all ghost instances registered under that house. The key is issued by `server/registry/` at ghost house registration time.

---

## GET /threads/:ghostId

List messages on a ghost's thread, newest-last, with optional cursor-based pagination.

### Query parameters

| Parameter | Type | Description |
|---|---|---|
| `after` | ULID string | Return only records with `message_id > after` (exclusive). Enables "fetch since last seen." |
| `limit` | integer | Maximum records to return. Default: 50. Max: 200. |

### Success response — 200

```json
{
  "thread_id": "ghost_abc",
  "messages": [
    {
      "thread_id": "ghost_abc",
      "message_id": "01J4K2M8XYZABCDEF",
      "timestamp": "2026-06-29T14:23:11Z",
      "role": "user",
      "name": "ghost_abc",
      "content": "Has anyone been to the Neo4j booth?",
      "mx_tile": "8f2830828052d25",
      "mx_listeners": ["ghost_def", "ghost_xyz"]
    }
  ],
  "next_cursor": "01J4K2M8XYZABCDEF"
}
```

`next_cursor` is the `message_id` of the last returned record. Pass it as `after` in the next request to page forward. Absent if no further records exist.

### Error responses

| Status | When |
|---|---|
| 401 | Missing or invalid API key |
| 403 | Ghost not registered under this ghost house |
| 404 | Ghost not found |

---

## GET /threads/:ghostId/:messageId

Fetch a single message record by ID.

### Success response — 200

```json
{
  "thread_id": "ghost_abc",
  "message_id": "01J4K2M8XYZABCDEF",
  "timestamp": "2026-06-29T14:23:11Z",
  "role": "user",
  "name": "ghost_abc",
  "content": "Has anyone been to the Neo4j booth?",
  "mx_tile": "8f2830828052d25",
  "mx_listeners": ["ghost_def", "ghost_xyz"]
}
```

### Error responses

| Status | When |
|---|---|
| 401 | Missing or invalid API key |
| 403 | Ghost not registered under this ghost house |
| 404 | Ghost or message not found |
