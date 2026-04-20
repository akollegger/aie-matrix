# Data Model: Ghost Conversation Mechanics

**Feature**: specs/006-ghost-conversation  
**Date**: 2026-04-20

---

## Ghost State

A ghost is always in one of two states. The state is owned by `ConversationService` and mirrored into the Colyseus room schema for debug visibility.

```
normal ──── say ────► conversational
  ▲                        │
  └────────── bye ──────────┘
```

| State | Allowed actions | Precluded actions |
|---|---|---|
| `normal` | all (move, look, exits, say, whoami, etc.) | — |
| `conversational` | `say`, `bye` | `go`, `traverse` |

`bye` issued from `normal` state: accepted as a no-op.

---

## MessageRecord

Stored as one JSONL line per message. Extends the OpenAI chat completions message shape. Matrix-specific fields carry the `mx_` prefix.

```typescript
interface MessageRecord {
  // --- OpenAI chat completions base fields ---
  thread_id:    string;   // always the speaker's ghost_id
  message_id:   string;   // ULID — lexicographically sortable
  timestamp:    string;   // ISO 8601 wall time
  role:         "user";   // fixed for ghost messages in PoC
  name:         string;   // speaker's ghost_id
  content:      string;   // message text

  // --- Matrix extension fields ---
  mx_tile:      string;   // H3 res-15 index of speaker at time of message
  mx_listeners: string[]; // ghost_ids in speaker's cluster at write time (snapshot)
}
```

**Notes**:
- `thread_id` is always identical to `name` (speaker's ghost_id). Both fields are present to satisfy the OpenAI message shape while making thread ownership explicit.
- `mx_listeners` is captured once at write time. It does not update as ghosts move.
- `role: "user"` for all ghost messages in the PoC. The `mx_ghost_type` field (attendee/speaker/vendor_npc) is deferred — see RFC-0005 open question 1.
- `message_id` is a ULID. Its lexicographic order equals its temporal order, which enables cursor-based pagination without database offsets.

---

## ConversationStore Interface

Public extension point for third-party ghost houses. No Effect-ts required.

```typescript
interface ConversationStore {
  append(record: MessageRecord): Promise<void>;
  get(thread_id: string, message_id: string): Promise<MessageRecord | null>;
  list(
    thread_id: string,
    options?: { after?: string; limit?: number }
  ): Promise<MessageRecord[]>;
}
```

Initial implementation: JSONL on disk, one file per ghost: `{data_dir}/{ghost_id}.jsonl`.

---

## PendingNotification (PoC inbox queue)

Internal to `ConversationService`. Not part of the public store contract.

```typescript
interface PendingNotification {
  thread_id:  string;   // broadcasting ghost's ghost_id
  message_id: string;   // ULID of the new message
}
```

Each ghost has a queue of `PendingNotification[]`. When `say` is processed:
1. `mx_listeners` is computed from the current cluster snapshot.
2. For each listener, a `PendingNotification` is enqueued.
3. The listener's next `inbox` call drains the queue and returns all pending items.

The queue is in-memory only. Notifications not consumed before server restart are lost. This is acceptable for the PoC.

---

## Colyseus Schema Additions

New field on `WorldSpectatorState` (in `server/colyseus/src/room-schema.ts`):

```typescript
@type({ map: "string" })
ghostModes = new MapSchema<string>();  // ghostId → "normal" | "conversational"
```

`MatrixRoom` gains two new methods:

```typescript
setGhostMode(ghostId: string, mode: "normal" | "conversational"): void
getGhostMode(ghostId: string): "normal" | "conversational"
```

Default (absent from map) = `"normal"`.

---

## Shared Type Additions (`shared/types/src/`)

### `conversation.ts` (new file)

```typescript
export type { MessageRecord, ConversationStore, PendingNotification };
```

### `ghostMcp.ts` additions

```typescript
// say tool
interface SayArgs    { content: string }
interface SayResult  { message_id: string; mx_listeners: string[] }

// bye tool
interface ByeArgs    {}   // no args
interface ByeResult  { previous_mode: "normal" | "conversational" }

// inbox tool
interface InboxArgs   {}  // no args
interface InboxResult { notifications: PendingNotification[] }
```

---

## File Layout (server/conversation/)

```
server/conversation/
├── package.json
└── src/
    ├── index.ts               — re-exports: MessageRecord, ConversationStore,
    │                            ConversationService, ConversationRouter
    ├── store.ts               — MessageRecord interface + JsonlStore implementation
    ├── ConversationService.ts — Effect service: say(), bye(), inbox(), ghost state
    └── router.ts              — Express/Hono router: GET /threads/:id, /:id/:msgId
```
