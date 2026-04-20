# MCP Tool Contracts: Conversation

**Package**: `server/world-api/`  
**Protocol**: Model Context Protocol (MCP) over HTTP  
**Auth**: JWT bearer token (ghost claims: `ghostId`, `caretakerId`)

---

## `say`

Enter conversational mode (if not already in it) and broadcast a message to all ghosts currently within the speaker's 7-cell H3 cluster.

### Input schema

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "description": "The message text to broadcast.",
      "minLength": 1,
      "maxLength": 2000
    }
  },
  "required": ["content"]
}
```

### Success response

```json
{
  "message_id": "01J4K2M8XYZABCDEF",
  "mx_listeners": ["ghost_def", "ghost_xyz"]
}
```

| Field | Type | Description |
|---|---|---|
| `message_id` | ULID string | Stable ID for the persisted message |
| `mx_listeners` | `string[]` | Ghost IDs that received the `message.new` notification |

### Error responses

| Code | When |
|---|---|
| `STORE_UNAVAILABLE` | Conversation store failed to persist the message. State transition does NOT occur. |
| `AUTH_REQUIRED` | Missing or invalid JWT. |

### Side effects

1. Ghost transitions to `conversational` mode (if not already).
2. Message record appended to `{ghost_id}.jsonl` store.
3. `PendingNotification` enqueued for each ghost in `mx_listeners`.
4. `ghostModes[ghost_id]` set to `"conversational"` in Colyseus schema.

---

## `bye`

End the conversation and return the ghost to normal state.

### Input schema

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

No input fields.

### Success response

```json
{
  "previous_mode": "conversational"
}
```

`previous_mode` is `"conversational"` if the ghost was in conversation, `"normal"` if already in normal state (no-op case).

### Side effects

1. Ghost transitions to `normal` mode.
2. `ghostModes[ghost_id]` set to `"normal"` in Colyseus schema.

---

## `inbox`

Return and drain all pending `message.new` notifications for the calling ghost. Used by ghost agents to discover messages sent to them while in or approaching conversation. (PoC polling model — see research.md Decision 2.)

### Input schema

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

No input fields.

### Success response

```json
{
  "notifications": [
    { "thread_id": "ghost_abc", "message_id": "01J4K2M8XYZABCDEF" },
    { "thread_id": "ghost_xyz", "message_id": "01J4K2M9ABCDEFGHI" }
  ]
}
```

Empty array if no pending notifications.

### Side effects

1. Pending notification queue for the calling ghost is drained (each notification returned exactly once).

### Notes

- `inbox` does not appear in RFC-0005. It is a PoC bridge enabling pull-based message discovery until ghost houses have persistent Colyseus connections.
- The result gives `thread_id` + `message_id`. The caller fetches full content via `GET /threads/{ghost_id}/{message_id}`.

---

## Modified tool: `go`

**Change**: Before executing movement, check calling ghost's conversational state. If `conversational`, reject immediately.

### New error response

```json
{
  "ok": false,
  "code": "IN_CONVERSATION",
  "reason": "Ghost is in conversational mode. Issue 'bye' to end the conversation before moving."
}
```

Same change applies to `traverse`.
