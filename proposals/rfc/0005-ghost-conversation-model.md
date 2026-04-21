# RFC-0005: Ghost Conversation Model

**Status:** accepted  
**Date:** 2026-04-20  
**Authors:** @aie-matrix  
**Related:** [RFC-0001](0001-minimal-poc.md), [RFC-0002](0002-rule-based-movement.md), [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md), [ADR-0003](../adr/0003-conversation-server.md)

## Summary

Each ghost owns a single persistent broadcast thread. Ghosts within a 7-cell cluster (the speaker's cell plus its six immediate neighbors) auto-subscribe to that thread and auto-unsubscribe when they leave range — position always determines membership, no explicit leave command required. Conversation is emergent and opt-in: a ghost that says something may get a response from nearby ghosts who choose to engage; ghosts that don't wish to converse simply ignore incoming messages. Messages are delivered as Colyseus notifications (signal) and persisted to a per-ghost JSONL file (record). The record format extends the OpenAI chat completions message shape with `mx_`-prefixed fields carrying spatial context. Third-party ghost houses receive both the real-time signal stream and access to the full conversation store.

## Motivation

The foundational conference experience requires ghosts to speak and listen. Without a conversation model, ghosts cannot attend sessions, exchange information, or network — the core goals of every ghost class. This RFC establishes the minimal primitives that make those interactions possible:

- A speaker agent addressing an audience in a session room
- Two ghosts stopping in a hallway to exchange information
- A vendor NPC greeting a ghost that enters a booth
- A ghost house reading what their ghost heard and said

The model is intentionally minimal. It defines *how messages flow*, not what they contain. Memory modules, information decay, and social graph recording are built on top of this layer.

## Design

### Thread ownership

Every ghost has exactly one broadcast thread, identified by `thread_id = ghost_id`. The thread is created when the ghost is registered and persists for the ghost's lifetime. A ghost cannot have multiple threads.

### Cluster definition

The **local cluster** of a ghost at cell `C` is the set of cells `{C} ∪ neighbors(C)` — a total of 7 cells at full H3 resolution (6 at a pentagon). Any ghost whose current position falls within this set is a **cluster member** of the broadcasting ghost.

Cluster membership is computed continuously from ghost positions. It is not stored as explicit state — it is derived on demand from the world graph.

### Conversational mode

Issuing `say` is an explicit state transition. The ghost moves from **normal state** to **conversational mode**:

- Movement is suspended for the duration of the conversation. A ghost in conversational mode cannot issue movement commands.
- On each `say` call, the cluster snapshot is computed from the speaker's (fixed) current position to determine `mx_listeners` and fan out `message.new` signals.
- Subsequent `say` calls within the same conversational mode are valid — the ghost continues speaking to whoever is currently in range.

Issuing `bye` ends the conversation and returns the ghost to **normal state**, re-enabling movement and all other actions.

This design eliminates the walk-and-talk flicker problem: a ghost in conversational mode cannot drift in or out of its own cluster, so the speaker's cluster is stable across the lifetime of a conversation. Cluster calculation is triggered by `say`, not by every position update.

**Ghost agents discover who is nearby by issuing `look`.** Signal delivery of `message.new` is an internal Colyseus fan-out operation on each `say` call, invisible to the agent — there is no persistent subscription lifecycle to manage.

### Emergent conversation

Conversation is opt-in and spatially bounded. A ghost navigates to a location, issues a `look` to observe nearby ghosts, and may choose to `say` something. Any cluster member that receives the `message.new` signal can respond by saying something on their own thread — which enters *that* ghost into its own conversational mode. Ghosts that don't wish to engage simply don't respond.

The engine enforces two lightweight constraints that make conversation coherent without requiring explicit invite/accept semantics:

1. **Conversational mode suspends movement.** A ghost that issues `say` cannot move until it issues `bye`. This eliminates the walk-and-talk flicker problem and removes any need to guard against a speaker's position changing mid-conversation.
2. **`bye` is the only exit.** A ghost must explicitly end the conversation to resume normal actions including movement. There is no timeout or implicit exit.

Bystanders within a ghost's cluster hear that ghost's broadcasts. Whether they also hear the other side of a dialogue depends on whether they are also within the responding ghost's cluster. One-sided eavesdropping is a natural consequence of the spatial model.

### Colyseus as notification bus

Colyseus delivers the following signals to subscribed ghosts:

| Signal | Payload | Trigger |
|---|---|---|
| `message.new` | `{ thread_id, message_id }` | New message available on a subscribed thread |

Colyseus does **not** carry message content. It carries only the signal that content exists and where to fetch it. This keeps the notification bus lightweight and the content store independently queryable.

Proximity events (`ghost.entered_cluster`, `ghost.left_cluster`) are not signals — ghosts discover nearby ghosts by issuing a `look` command. Request throttling on `look` is sufficient to manage polling frequency.

### Conversation store

Messages are persisted to disk as JSONL, one file per ghost thread: `{ghost_id}.jsonl`. Each line is one message record.

#### Record format

The record extends the OpenAI chat completions message format. Base fields are valid chat completions as-is. Matrix-specific fields use the `mx_` prefix.

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

Field definitions:

| Field | Type | Description |
|---|---|---|
| `thread_id` | string | Always the speaker's `ghost_id` |
| `message_id` | string | Unique ID (ULID recommended) |
| `timestamp` | ISO 8601 | Wall time of message |
| `role` | `"user"` | Fixed for ghost messages; reserved for future NPC/system roles |
| `name` | string | Speaker's `ghost_id` |
| `content` | string | Message text |
| `mx_tile` | string | H3 res-15 index of speaker at time of message |
| `mx_listeners` | string[] | All ghosts in speaker's cluster at time of message (who could hear) |

`mx_listeners` is captured at write time from the current cluster snapshot. It is not recomputed from later state.

### MCP interface

Ghost agents interact via one new MCP tool:

| Tool | Description |
|---|---|
| `say { content }` | Enter conversational mode (if not already in it) and broadcast a message on the ghost's own thread to all current cluster members |
| `bye` | End the conversation and return to normal state, re-enabling movement and all other actions |

`listen` is passive — ghosts receive messages via Colyseus `message.new` signals and fetch content from the conversation store. No explicit `listen` tool is needed.

### Third-party ghost house access

Ghost houses receive an API key scoped to their ghost(s) at registration time. This key grants:

- **Colyseus subscription** — real-time delivery of all signals for their ghost(s)
- **Conversation store read** — HTTP or direct access to fetch message records by `thread_id` and `message_id`

The conversation store exposes two endpoints:

```
GET /threads/{ghost_id}                        # list messages (paginated)
GET /threads/{ghost_id}/{message_id}           # fetch single message
```

Auth is handled via the ghost house API key. The store implementation is pluggable; the interface above is the contract.

### Pluggable store backend

The conversation store is defined by its interface, not its implementation. The initial implementation is JSONL on disk. Future implementations (Postgres, columnar store, object storage) replace the implementation without changing the MCP contract or the HTTP endpoints.

The interface requires:

- `append(record: MessageRecord): Promise<void>`
- `get(thread_id: string, message_id: string): Promise<MessageRecord>`
- `list(thread_id: string, options: { after?: string, limit?: number }): Promise<MessageRecord[]>`

`Promise<T>` return types are intentional. The project uses Effect-ts for server orchestration (ADR-0002), but the store interface is a public extension point consumed by third-party ghost houses. Requiring Effect-ts knowledge would raise the barrier for contributors providing alternative store implementations. The Effect wrapping is an internal concern for `server/conversation/` and does not belong in this contract.

## Open Questions

**`role` field values and `mx_ghost_type`** — OpenAI uses `user` / `assistant` / `system`. The current proposal uses `role: "user"` for all ghost messages and `role: "system"` for world engine events (session starting, ghost entered room). Speaker agents and vendor NPCs are candidates for `role: "assistant"`. However, LLM role semantics and ghost world identity are different concerns. A dedicated `mx_ghost_type` field (e.g. `"attendee"`, `"speaker"`, `"vendor_npc"`, `"system"`) may be cleaner — it preserves OpenAI role semantics for LLM consumption while carrying ghost world identity independently. This must be resolved before the first messages are written; implementation of the conversation store is gated on this decision.

**Message ID format** — ULID is the recommended format. It is lexicographically sortable, collision-resistant, and requires no coordination. Sortability is load-bearing for the `list(after: message_id)` endpoint: it enables "fetch since last seen" pagination without database offsets or timestamp collisions. Adopt ULID project-wide unless there is a strong existing preference.

**Conversation store volume and SQLite migration threshold** — JSONL on disk is appropriate up to approximately 100k messages. Beyond that, `GET /threads/{ghost_id}` latency will degrade as files grow. SQLite is the natural second implementation: it preserves the "file on disk" operational simplicity of JSONL while providing indexed reads. The pluggable store interface is designed to make this swap a contained implementation change. A load estimate per ghost per conference day would help set the trigger point for the migration task.

**Colyseus bridge architecture** — when `say` is issued, `server/conversation/` must compute the current cluster snapshot to determine `mx_listeners` and fan out `message.new` signals. When `bye` is issued, the ghost's conversational state must be cleared in the world graph so that movement commands are accepted again. The exact bridge between the MCP tool calls and the Colyseus presence layer is not fully specified here. [ADR-0003](../adr/0003-conversation-server.md) defines the service boundary; ADR-0003 must be accepted before implementation of this RFC begins.

## Alternatives

**Room-owned channels instead of ghost-owned threads** — a session room or tile zone owns the broadcast channel; all ghosts in the room subscribe to it. Simpler in some ways, but ownership becomes ambiguous when ghosts move, rooms have no natural identity outside the map, and post-conference replay by ghost is not possible. Ghost-owned threads preserve a clean audit trail per ghost.

**Full content in Colyseus** — message text delivered directly in the Colyseus signal, no separate store. Works for low volume but Colyseus is not a system of record; content is lost on restart and not queryable. Not appropriate for ghost houses that need async access.

**Full content in Neo4j** — messages as nodes in the world graph. Highly queryable and graph-traversable, but adds write latency to every message and may not scale to conference volume without dedicated tuning. Deferred as a potential future store implementation behind the pluggable interface.

**Variable cluster radius ("shouting")** — a ghost could temporarily expand its broadcast cluster to 2 rings (19 cells) at some cost. This is intentionally out of scope for this RFC. It is a game mechanic that can be layered on top of the cluster model without changing any primitives defined here — the conversation store, signal format, and MCP tool are all radius-agnostic. A future RFC can introduce it as a ghost capability.
