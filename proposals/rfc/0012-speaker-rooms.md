# RFC-0012: Speaker Rooms

**Status:** draft  
**Date:** 2026-05-16  
**Authors:** @akollegger  
**Related:** [RFC-0005](0005-ghost-conversation-model.md), [RFC-0002](0002-rule-based-movement.md), [RFC-0009](0009-map-format-pipeline.md)

## Summary

This RFC introduces three composable additions that together make session rooms first-class locations in the world: (1) **named polygons** — `.map.gram` polygons annotated with a `name` property that give a set of H3 cells a semantic identity; (2) **speaker role** — acquired by any ghost that issues `claim` from inside a named room, widening broadcast scope from the local 7-cell cluster to all members of that room; and (3) **listening state** — a new third ghost state, entered automatically when a ghost steps into a named polygon where a speaker is actively broadcasting, that blocks `say` but leaves movement unrestricted. Together these primitives reproduce the MMORPG innkeeper pattern: a speaker ghost claims a room, broadcasts to everyone in it, and attendee ghosts can wander in and out while passively receiving the talk. The schedule — constraining when a speaker is present and active — is deliberately out of scope and deferred to a follow-on RFC.

## Motivation

The foundational conference experience requires ghosts to hear session content, but the current conversation model (RFC-0005) scopes all broadcasts to a 7-cell local cluster and has no concept of rooms or roles. A speaker standing at the front of Hall A cannot reach a ghost seated twenty cells away. Ghosts have no way to distinguish a vendor NPC from a fellow attendee. And there is no mechanic that reflects the asymmetry of a talk: many people listening to one person speaking.

This RFC addresses the minimum set of missing primitives:

- A ghost enters a session room and automatically hears what the speaker is saying, without issuing any command.
- A speaker ghost broadcasts to the entire room, not just the seven cells around it.
- Listening ghosts retain mobility — they can shift position, arrive late, or leave early — but cannot interrupt the speaker.
- Robotic speaker agents can loop `say` calls indefinitely without any new command surface.
- The same polygon primitive that defines a session room also defines vendor booths and BoF zones, making it reusable across all named areas.

## Design

### Named polygons

The `.map.gram` format already supports `Polygon` nodes with a `geometry` array of H3 cell indices. This RFC establishes the convention that a `name` property on a polygon designates it as a **named room**:

```gram
[session-rooms:Layer {kind: "polygon", name: "Session Rooms"} |
  (:Polygon:SessionRoom { name: "Hall A", description: "Main session hall, capacity 500. Home of keynote and opening sessions.", geometry: [h3`...`, h3`...`, ...] }),
  (:Polygon:SessionRoom { name: "Hall B", description: "Breakout room for the Agents track.", geometry: [h3`...`, h3`...`, ...] })
]
```

Both `name` and `description` are required on named polygons. `name` is a short identifier used in tool responses and routing; `description` is a human-readable sentence or two surfaced to ghost agents via `whereami` to give spatial context without the agent needing to infer meaning from a tile class.

The server maintains two categories of room data in-memory. Static data — cell membership and description per room, plus a reverse index from H3 cell to room name (SessionRoom layer only) — is built at map load time and does not change. Runtime state — the current speaker (if any) and the set of ghosts currently in listening state per room — is mutated by `claim`, `yield`, and movement events. No Neo4j schema changes are required.

A cell may belong to at most one named polygon **within a layer**. Polygons on different layers may share cells — a carpet inside a session room occupies the same H3 cells as the room polygon without conflict. Overlapping polygons within the same layer are a map authoring error and should be rejected at load time with a clear message.

Room mechanics — `claim`, auto-yield on departure, and listening state entry/exit — consult only polygons with the `SessionRoom` label. A ghost stepping onto a carpet that shares cells with a session room remains inside the room; the carpet layer has no effect on room membership.

### Room context in MCP tools

One existing tool is extended to surface room information when the ghost's current cell belongs to a named polygon.

**`whereami`** currently returns `{ h3Index, tileId, col, row }`. When the ghost is inside a named polygon, a `room` field is added:

```typescript
// ghost outside any named polygon
{ h3Index: "8f2830828052d25", tileId: "8f2830828052d25", col: 12, row: 7 }

// ghost inside "Hall A"
{ h3Index: "8f2830828052d25", tileId: "8f2830828052d25", col: 12, row: 7,
  room: { name: "Hall A", description: "Main session hall, capacity 500. Home of keynote and opening sessions." } }
```

The `room` field is absent (not `null`) when the ghost is not in any named polygon, so existing agents that destructure the result do not need updates.

The tool derives the room field from the same in-memory room index. No additional server queries are needed.

### Speaker role and the `claim` command

Any ghost may become a speaker by claiming a named room. The ghost issues the `claim` tool from inside the room's polygon boundary:

```typescript
claim({ room: "Hall A" })
```

The server evaluates the request against a `ClaimRule` before accepting it. The initial rule requires two conditions:

```
ClaimRule(ghost, room) =>
  room.currentSpeaker == null            // room is unoccupied
  AND ghost.currentCell IN room.cells    // ghost is physically inside the room
```

The physical-presence requirement preserves the spatial invariant that underpins the whole design: you cannot interact with a space you are not in. The unoccupied condition gives each room a single speaker at a time.

On a successful claim:
- The ghost's `role` transitions to `"speaker"` and `assignedRoom` is set to the claimed room name.
- The room records the ghost as its current speaker.
- The ghost may now issue `say` with room-scoped broadcast (see below).

On rejection, `claim` returns a structured error:

| Error | Condition |
|---|---|
| `ROOM_ALREADY_CLAIMED` | Another ghost currently holds the room |
| `GHOST_NOT_IN_ROOM` | Ghost's current cell is not inside the named polygon |
| `ROOM_NOT_FOUND` | No named polygon with that name exists |

Role is runtime state, not registration config. All ghosts start as `"attendee"`; `claim` is the only path to `"speaker"`. The claim is released in two ways, mirroring how listeners exit listening state:

| Ghost | Leaves polygon | Explicit command |
|---|---|---|
| Listener | auto-exits `listening` | `bye` |
| Speaker | auto-yields claim | `yield` |

On release — whether via `yield` or room departure — `role` reverts to `"attendee"`, `assignedRoom` is cleared, the room becomes claimable again, and all ghosts currently in `listening` state for that room receive a `session.ended` signal.

```typescript
type GhostRole = "attendee" | "speaker"

interface GhostRecord {
  ghostId: string
  role: GhostRole        // "attendee" by default; "speaker" while a claim is held
  assignedRoom?: string  // set on successful claim; cleared on yield or room departure
}
```

The `ClaimRule` is an explicit extension point. Future iterations can add conjuncts — an allowlist check, a secret token, a time window — without changing the `claim` command surface or the listening state mechanic.

#### Room-scoped broadcast

When a ghost with `role === "speaker"` issues `say`, the fan-out scope changes from the local cluster to the full membership of the speaker's assigned room. Concretely:

- **Current (RFC-0005):** `mx_listeners` = all ghosts in `{C} ∪ neighbors(C)` where C is the speaker's current cell.
- **Speaker role:** `mx_listeners` = all ghosts currently in `assignedRoom`'s H3 cell set, regardless of proximity to the speaker.

The `say` and `bye` MCP tools are unchanged. The speaker ghost uses them identically to any other ghost. The broadened scope is an internal routing decision made by `server/conversation/` when it computes the cluster snapshot.

A robotic speaker issues `claim` once on startup, `say` in a loop, and `yield` when done. No further command surface is needed.

### Listening state

RFC-0005 defines two ghost states: `normal` and `conversational`. This RFC adds a third:

| State | Movement | Speaking (`say`) | Entry | Exit |
|---|---|---|---|---|
| `normal` | free | allowed | default; `bye` from listening | — |
| `conversational` | frozen | allowed | issuing `say` | issuing `bye` |
| `listening` | free | blocked | entering active-speaker room | `bye`; or leaving room |

**Entry:** Listening state is entered in two cases, both without issuing any command:
- A ghost in `normal` state moves into a cell that belongs to a named room where the current speaker is in `conversational` mode.
- A speaker in a claimed room transitions into `conversational` mode (issues `say`); all ghosts currently in `normal` state within that room transition automatically to `listening` state.

**While listening:** The ghost receives `message.new` Colyseus signals from the speaker's thread exactly as a cluster member would. Movement commands are accepted. `say` commands are rejected with an observable error indicating the ghost is in listening state and must issue `bye` first.

**Exit via `bye`:** The ghost transitions to `normal` state. Subsequent movement and `say` commands are accepted.

**Exit via room departure:** When a ghost in `listening` state moves to a cell outside the room, the server automatically transitions the ghost to `normal` state. No `bye` is required.

**Speaker ends the talk:** When a speaker ghost issues `yield` or moves outside their claimed room, all ghosts currently in `listening` state for that room transition automatically to `normal` state and receive a `session.ended` Colyseus signal.

**Reconnect:** A ghost that reconnects always returns to `normal` state, matching RFC-0005 behavior for `conversational` mode. Normal state transition logic then re-applies: if the ghost's current cell is inside an active speaker's room, it will immediately auto-enter `listening` state. If the speaker has left or the session has ended in the interim, the ghost simply stays in `normal`.

### Ghost state machine (updated)

```
          ┌─────────────────────────────────────────┐
          │              normal                      │
          │  movement: free  |  say: allowed         │
          └──────┬──────────────────────┬────────────┘
                 │ issue say            │ enter active room
                 ▼                      ▼
    ┌─────────────────────┐   ┌──────────────────────┐
    │   conversational    │   │      listening        │
    │  movement: frozen   │   │  movement: free       │
    │  say: allowed       │   │  say: blocked         │
    └──────┬──────────────┘   └──────┬───────────────┘
           │ issue bye               │ issue bye OR leave room
           └──────────┬──────────────┘
                      ▼
                   normal
```

A ghost in `conversational` mode cannot enter a new polygon because it cannot move. The state collision between `conversational` and `listening` is structurally impossible.

`claim` and `yield` operate on the speaker's room assignment independently of ghost state. A speaker may hold a claim while in `normal` state (between `say` calls); the claim is not tied to `conversational` mode.

### Demo scenario

A contributor can verify the full mechanic end-to-end in roughly ten minutes:

1. Load a map containing a `SessionRoom` polygon named `"Hall A"`.
2. Register ghost A. Move it into Hall A. Issue `claim { room: "Hall A" }`. Verify the response confirms `role: "speaker"` and `assignedRoom: "Hall A"`.
3. Register ghost B inside Hall A (before any session starts). Verify ghost B is in `normal` state.
4. Ghost A issues `say { content: "Hello from Hall A" }`. Verify only ghosts currently in Hall A receive the `message.new` signal — not ghosts in adjacent clusters outside the room. Verify ghost B (already inside) automatically transitions to `listening` state.
5. Register ghost C outside Hall A. Move it into Hall A. Verify ghost C also automatically transitions to `listening` state.
6. Ghost C issues `say`. Verify it receives a `GHOST_IN_LISTENING_STATE` error.
7. Ghost C issues `bye`. Verify it returns to `normal` and can `say` freely.
8. Ghost A issues `yield`. Verify `yield` exits ghost A's `conversational` mode and releases the room claim. Verify all remaining listeners receive `session.ended` and return to `normal`. Verify the room is now unclaimed and a new ghost can `claim` it.

### MCP tool changes

Two new MCP tools are introduced. Two existing tools are updated:

| Tool | Change |
|---|---|
| `claim { room }` | New tool. Transitions ghost to speaker role for the named room, subject to `ClaimRule`; returns structured errors on rejection |
| `yield` | New tool. Ends the session: exits `conversational` mode if active, releases the room claim, and triggers `session.ended` for all listeners. Claim is also released automatically if the speaker moves outside their room. |
| `whereami` | Adds optional `room: { name, description }` to response when ghost is in a named room |
| `say { content }` | Rejected with `GHOST_IN_LISTENING_STATE` error when ghost is in listening state |

One new Colyseus signal is introduced:

| Signal | Payload | Trigger |
|---|---|---|
| `session.ended` | `{ room: string, speaker_id: string }` | Speaker issues `yield` or leaves their room; delivered to all ghosts in `listening` state for that room |

### New `mx_ghost_role` record field

The open question in RFC-0005 about `role` field values is partially resolved here. Speaker-broadcast messages should be distinguishable from attendee-to-attendee messages in the conversation store. A new `mx_ghost_role` field is added to the message record:

```json
{
  "thread_id": "speaker_hallA",
  "message_id": "01J4K2M8XYZABCDEF",
  "role": "user",
  "mx_ghost_role": "speaker",
  "content": "Welcome to my talk on multi-agent systems.",
  "mx_tile": "8f2830828052d25",
  "mx_room": "Hall A",
  "mx_listeners": ["ghost_abc", "ghost_def", "ghost_xyz"]
}
```

Two new fields:
- `mx_ghost_role` — `"attendee"` | `"speaker"`; mirrors the broadcasting ghost's role
- `mx_room` — present when the broadcasting ghost is a speaker; the name of the assigned room

## Alternatives

**Explicit `listen` / `unlisten` commands instead of auto-entry.** A ghost would issue `listen "Hall A"` to opt in and `bye` or `unlisten` to opt out. This gives the ghost full control but breaks the spatial model — a ghost could "listen" to a room it is not in. Auto-entry on polygon membership preserves the invariant that you must physically be present to hear a talk, which is the core mechanic this RFC is building toward.

**Cluster radius expansion for speakers instead of polygon scope.** A speaker ghost could use a larger cluster radius (e.g., 3 rings instead of 1). This avoids the polygon membership infrastructure but breaks down for irregularly shaped rooms and gives no clean boundary for listener auto-entry. Polygon membership is more precise and already present in the map format.

**Room-owned broadcast channel instead of speaker-ghost broadcast.** The polygon itself could own a channel; the speaker writes to it and all polygon members subscribe. This is cleaner for multi-speaker panels but adds a new entity type (the channel) and complicates the conversation store model, which is currently ghost-thread-owned. Speaker-ghost ownership keeps the existing thread model intact and defers multi-speaker panels to a future RFC.

**Operator-assigned speaker role at registration.** Pre-assigning a ghost as speaker for a specific room before the event avoids the first-come-first-served problem entirely, but requires knowing ghost IDs at map-authoring time — identifiers that are difficult to know that far in advance. The `claim` mechanic defers this problem to `ClaimRule`, which can be tightened (allowlist, token, time window) without changing the command surface. First-come-first-served is a conscious starting tradeoff.

**Listening state freezes movement.** An alternative is to freeze ghost movement in listening state (matching conversational mode) to reflect the social norms of a talk. The decision here is to keep movement free because the optimization challenge — deciding when to leave an ongoing talk to catch something else — is a core agentic decision we want to enable. Freezing would remove that decision point.
