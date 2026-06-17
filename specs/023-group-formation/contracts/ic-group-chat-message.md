# IC-002: Group Chat Message Format

**Consumers**: `server/world-api` (writer), Colyseus signal layer (fan-out), `@aie-matrix/intermedium` (receiver), ghost MCP `inbox` polling

## JSONL Record Shape

Group chat messages are appended to `{group_id}.jsonl` in the same `CONVERSATION_DATA_DIR` directory used by ghost conversation threads. The format is a strict superset of the existing ghost conversation record — the only structural difference is `thread_id = group_id`.

```ts
// Stored in {CONVERSATION_DATA_DIR}/{group_id}.jsonl
interface GroupMessageRecord {
  thread_id:   string;    // group_id — distinguishes group threads from ghost threads
  message_id:  string;    // ULID
  timestamp:   string;    // ISO-8601; from worldNow()
  role:        "user" | "system";  // "system" for admission/join/leave notifications
  name:        string;    // sender display name, or "system" for system messages
  content:     string;
  mx_tile:     string;    // sender's H3 cell at send time (speaker has a tile; group does not)
  mx_listeners: string[]; // actor IDs who received this message at send time
}
```

## Colyseus Signal

Fan-out uses the existing `message.new` Colyseus room message:

```ts
// Emitted to each listener's Colyseus session via WorldBridgeService.notifyGhost()
{
  type: "message.new",
  payload: {
    thread_id:  string,  // group_id
    message_id: string,
  }
}
```

Receivers call the existing `inbox` MCP tool (unchanged) to drain their pending notifications. The ghost's inbox queue is extended to accept group-thread notifications alongside ghost-thread notifications — `{ thread_id, message_id }` is already polymorphic.

## System Message Examples

```jsonl
{"thread_id":"01J...","message_id":"01J...","timestamp":"...","role":"system","name":"system","content":"ghost_C has offered to join. Vote before 2026-06-02T18:00:00Z. Use group.vote to respond.","mx_tile":"","mx_listeners":["ghostA","ghostB"]}
{"thread_id":"01J...","message_id":"01J...","timestamp":"...","role":"system","name":"system","content":"ghost_C has been admitted to the group.","mx_tile":"","mx_listeners":["ghostA","ghostB","ghostC"]}
{"thread_id":"01J...","message_id":"01J...","timestamp":"...","role":"system","name":"system","content":"ghost_A has left the group.","mx_tile":"","mx_listeners":["ghostB"]}
```

Note: `mx_tile` is the empty string for system messages (the system has no tile position).

## Backward Compatibility

Ghost conversation readers (intermedium client, TCK) already handle `thread_id` as opaque. No changes to existing ghost conversation JSONL readers are required.
