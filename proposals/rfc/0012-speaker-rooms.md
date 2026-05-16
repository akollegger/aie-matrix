# RFC-0012: Speaker Rooms

**Status:** draft  
**Date:** 2026-05-16  
**Authors:** @akollegger  
**Related:** [RFC-0005](0005-ghost-conversation-model.md), [RFC-0002](0002-rule-based-movement.md), [RFC-0009](0009-map-format-pipeline.md)

## Summary

This RFC introduces three composable additions that together make session rooms first-class locations in the world: (1) **named polygons** — `.map.gram` polygons annotated with a `name` property that give a set of H3 cells a semantic identity; (2) **speaker role** — a ghost attribute that widens broadcast scope from the local 7-cell cluster to all members of the ghost's assigned polygon; and (3) **listening state** — a new third ghost state, entered automatically when a ghost steps into a named polygon where a speaker is actively broadcasting, that blocks `say` but leaves movement unrestricted. Together these primitives reproduce the MMORPG innkeeper pattern: a speaker ghost lives in a room, broadcasts to everyone in it, and attendee ghosts can wander in and out while passively receiving the talk. The schedule — constraining when a speaker is present and active — is deliberately out of scope and deferred to a follow-on RFC.

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

Both `name` and `description` are required on named polygons. `name` is a short identifier used in tool responses and routing; `description` is a human-readable sentence or two surfaced to ghost agents via `look` and `whereami` to give spatial context without the agent needing to infer meaning from a tile class.

The server indexes named polygons at map load time as a map from `name → { cells: Set<H3Index>, description: string }` and the reverse map from `H3Index → polygon name`. No Neo4j schema changes are required; polygon membership is computed in-memory from the loaded map.

A cell may belong to at most one named polygon. Overlapping polygons are a map authoring error and should be rejected at load time with a clear message.

### Room context in MCP tools

Two existing tools are extended to surface room information when the ghost's current cell belongs to a named polygon.

**`whereami`** currently returns `{ h3Index, tileId, col, row }`. When the ghost is inside a named polygon, a `room` field is added:

```typescript
// ghost outside any named polygon
{ h3Index: "8f2830828052d25", tileId: "8f2830828052d25", col: 12, row: 7 }

// ghost inside "Hall A"
{ h3Index: "8f2830828052d25", tileId: "8f2830828052d25", col: 12, row: 7,
  room: { name: "Hall A", description: "Main session hall, capacity 500. Home of keynote and opening sessions." } }
```

The `room` field is absent (not `null`) when the ghost is not in any named polygon, so existing agents that destructure the result do not need updates.

Both tools derive the room field from the same in-memory polygon index. No additional server queries are needed.

### Speaker role

A ghost may be assigned the role `"speaker"` in addition to its ghost class. Role is a persistent ghost attribute stored alongside class:

```typescript
type GhostRole = "attendee" | "speaker"
```

The default role for all existing and new ghosts is `"attendee"`. Role assignment is an operator action at ghost registration time; it is not self-assignable by a ghost agent.

A speaker ghost must be assigned to exactly one named polygon at registration time. This assignment is stored as a property on the ghost record:

```typescript
interface GhostRecord {
  ghostId: string
  role: GhostRole
  assignedPolygon?: string  // polygon name; required when role === "speaker"
}
```

#### Polygon-scoped broadcast

When a ghost with `role === "speaker"` issues `say`, the fan-out scope changes from the local cluster to the full membership of the speaker's assigned polygon. Concretely:

- **Current (RFC-0005):** `mx_listeners` = all ghosts in `{C} ∪ neighbors(C)` where C is the speaker's current cell.
- **Speaker role:** `mx_listeners` = all ghosts currently in `assignedPolygon`'s H3 cell set, regardless of proximity to the speaker.

The `say` and `bye` MCP tools are unchanged. The speaker ghost uses them identically to any other ghost. The broadened scope is an internal routing decision made by `server/conversation/` when it computes the cluster snapshot.

A robotic speaker needs no new command surface. It issues `say` in a loop from inside its assigned polygon and the server handles the rest.

### Listening state

RFC-0005 defines two ghost states: `normal` and `conversational`. This RFC adds a third:

| State | Movement | Speaking (`say`) | Entry | Exit |
|---|---|---|---|---|
| `normal` | free | allowed | default; `bye` from listening | — |
| `conversational` | frozen | allowed | issuing `say` | issuing `bye` |
| `listening` | free | blocked | entering active-speaker polygon | `bye`; or leaving polygon |

**Entry:** When a ghost in `normal` state moves into a cell, the server checks whether that cell belongs to a named polygon and whether a speaker ghost assigned to that polygon is currently in `conversational` mode. If both conditions hold, the entering ghost transitions automatically to `listening` state without issuing any command.

**While listening:** The ghost receives `message.new` Colyseus signals from the speaker's thread exactly as a cluster member would. Movement commands are accepted. `say` commands are rejected with an observable error indicating the ghost is in listening state and must issue `bye` first.

**Exit via `bye`:** The ghost transitions to `normal` state. Subsequent movement and `say` commands are accepted.

**Exit via polygon departure:** When a ghost in `listening` state moves to a cell outside the polygon, the server automatically transitions the ghost to `normal` state. No `bye` is required.

**Speaker ends the talk:** When a speaker ghost issues `bye`, all ghosts currently in `listening` state for that polygon transition automatically to `normal` state and receive a `session.ended` Colyseus signal.

### Ghost state machine (updated)

```
          ┌─────────────────────────────────────────┐
          │              normal                      │
          │  movement: free  |  say: allowed         │
          └──────┬──────────────────────┬────────────┘
                 │ issue say            │ enter active polygon
                 ▼                      ▼
    ┌─────────────────────┐   ┌──────────────────────┐
    │   conversational    │   │      listening        │
    │  movement: frozen   │   │  movement: free       │
    │  say: allowed       │   │  say: blocked         │
    └──────┬──────────────┘   └──────┬───────────────┘
           │ issue bye               │ issue bye OR leave polygon
           └──────────┬──────────────┘
                      ▼
                   normal
```

A ghost in `conversational` mode cannot enter a new polygon because it cannot move. The state collision between `conversational` and `listening` is structurally impossible.

### MCP tool changes

No new MCP tools are introduced. Three existing tools are updated:

| Tool | Change |
|---|---|
| `whereami` | Adds optional `room: { name, description }` to response when ghost is in a named polygon |
| `say { content }` | Rejected with `GHOST_IN_LISTENING_STATE` error when ghost is in listening state |
| `bye` | Exits `listening` state in addition to `conversational` state |

One new Colyseus signal is introduced:

| Signal | Payload | Trigger |
|---|---|---|
| `session.ended` | `{ polygon: string, speaker_id: string }` | Speaker issues `bye`; delivered to all ghosts in the polygon |

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
  "mx_polygon": "Hall A",
  "mx_listeners": ["ghost_abc", "ghost_def", "ghost_xyz"]
}
```

Two new fields:
- `mx_ghost_role` — `"attendee"` | `"speaker"`; mirrors the broadcasting ghost's role
- `mx_polygon` — present when the broadcasting ghost is a speaker; the name of the assigned polygon

## Open Questions

**How does a speaker ghost know which polygon it is in?** The current `look` MCP tool returns nearby ghosts and tiles. It should be extended (or a new `where` tool added) to return the current polygon name when the ghost is inside a named polygon. This is needed for speaker ghosts to confirm their assigned room before issuing `say`.

**What happens if a speaker ghost moves outside their assigned polygon and then issues `say`?** Two options: (a) reject `say` with an error until the speaker re-enters the polygon; (b) fall back to cluster-scoped broadcast as for a normal ghost. Option (a) is safer and keeps invariants clear, but may be surprising for development. This should be decided before implementation.

**Can a ghost be in listening state for multiple polygons simultaneously?** The current model assumes at most one active polygon per ghost. If polygons can be adjacent and a ghost sits on a shared boundary, the server must deterministically resolve which polygon takes precedence (e.g., first match in load order). This edge case needs a resolution rule.

**Listening state persistence across reconnect.** RFC-0005 resets `conversational` mode to `normal` on reconnect. Listening state should follow the same rule — reset to `normal` on reconnect — but the auto-enter logic means a ghost that reconnects in an active polygon will immediately re-enter listening state. This is probably the right behavior but should be verified.

**`session.ended` signal delivery.** When a speaker issues `bye`, the signal must be delivered to all ghosts currently in listening state for that polygon. The server must track which ghosts are in listening state per polygon to do this efficiently. A simple `Map<polygonName, Set<ghostId>>` maintained in-memory alongside ghost state is likely sufficient.

## Alternatives

**Explicit `listen` / `unlisten` commands instead of auto-entry.** A ghost would issue `listen "Hall A"` to opt in and `bye` or `unlisten` to opt out. This gives the ghost full control but breaks the spatial model — a ghost could "listen" to a room it is not in. Auto-entry on polygon membership preserves the invariant that you must physically be present to hear a talk, which is the core mechanic this RFC is building toward.

**Cluster radius expansion for speakers instead of polygon scope.** A speaker ghost could use a larger cluster radius (e.g., 3 rings instead of 1). This avoids the polygon membership infrastructure but breaks down for irregularly shaped rooms and gives no clean boundary for listener auto-entry. Polygon membership is more precise and already present in the map format.

**Room-owned broadcast channel instead of speaker-ghost broadcast.** The polygon itself could own a channel; the speaker writes to it and all polygon members subscribe. This is cleaner for multi-speaker panels but adds a new entity type (the channel) and complicates the conversation store model, which is currently ghost-thread-owned. Speaker-ghost ownership keeps the existing thread model intact and defers multi-speaker panels to a future RFC.

**Listening state freezes movement.** An alternative is to freeze ghost movement in listening state (matching conversational mode) to reflect the social norms of a talk. The decision here is to keep movement free because the optimization challenge — deciding when to leave an ongoing talk to catch something else — is a core agentic decision we want to enable. Freezing would remove that decision point.
