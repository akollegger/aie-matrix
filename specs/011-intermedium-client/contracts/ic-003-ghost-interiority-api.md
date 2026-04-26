# IC-003: Ghost Interiority Read API

**Contract ID**: IC-003  
**Feature**: `011-intermedium-client`  
**Status**: Placeholder — Ghost scale content stubbed in MVP  
**Related**: [RFC-0008 §Open Question 4](../../../proposals/rfc/0008-human-spectator-client.md), [RFC-0007](../../../proposals/rfc/0007-ghost-house-architecture.md)  
**Consumers**: `clients/intermedium/src/components/GhostInteriority/`

## Purpose

Documents the interface the intermedium needs from the ghost house to display a ghost's inner state at Ghost scale: inventory, active quest, and memory log. This is a **placeholder contract** — the data model for ghost interiority is not yet defined in RFC-0007. This document records the expected shape so the ghost house team can design to it.

## Context

RFC-0008 §Design: "The Ghost scale is the only scale with no hex grid. It presents the ghost's inner state as a structured document: what it carries, what it is trying to do, what it remembers. The data source is the ghost's MCP state, surfaced via the ghost house API."

RFC-0008 §Open Question 4: "This is not yet defined in RFC-0007. Ghost scale is in scope for this RFC as a navigation destination but its content is blocked on a follow-up contract with the ghost house."

## Expected Contract Shape (target)

The ghost house MUST expose either an HTTP endpoint or an MCP tool for reading ghost interiority.

### Option A: HTTP endpoint (preferred for browser clients)

```
GET /ghost/:ghostId/state
```

**Response `200 OK`**:

```json
{
  "ghostId": "ghost-uuid",
  "inventory": [
    { "itemId": "artefact-001", "name": "Mysterious Artefact", "quantity": 1 },
    { "itemId": "key-card-b12", "name": "B12 Access Card", "quantity": 1 }
  ],
  "activeQuest": {
    "questId": "quest-001",
    "title": "Find the Hidden Cache",
    "description": "Locate the artefact cache near the sponsor hall.",
    "status": "active"
  },
  "memoryLog": [
    {
      "entryId": "mem-001",
      "content": "Encountered ghost-b at H3 cell 8f2830828052d25. They mentioned a cache nearby.",
      "timestamp": "2026-06-10T13:45:00Z"
    }
  ]
}
```

### Option B: MCP tool call

```
read_ghost_state({ ghostId: "ghost-uuid" })
→ { inventory, activeQuest, memoryLog }
```

If MCP is chosen, the intermedium would require an MCP client dependency — explicitly undesirable per RFC-0008 ("No MCP tool is introduced for map topology; … keeps the intermedium free of an MCP client dependency"). HTTP is strongly preferred.

## MVP Stub Behaviour

Until the ghost house team implements this API:

1. `GhostInteriority.isAvailable` is set to `false` for all ghosts.
2. The Ghost scale panel renders a structured placeholder showing the data categories (inventory, quest, memories) with "loading…" states.
3. No network call is made in MVP.

## Live Updates

Ghost interiority changes (inventory acquired, quest updated, memory added) during a session:

- **Polling**: `GET /ghost/:ghostId/state` every 5 seconds while Ghost scale is active. Simple; acceptable for MVP.
- **Push (preferred)**: SSE or WebSocket event stream at `GET /ghost/:ghostId/state/stream`. More efficient; consistent with conversation stream pattern.

## Authentication

Same bearer token mechanism as IC-002. Only the paired human may read their ghost's interiority.

## Invariants

- The intermedium MUST only read interiority for its own paired ghost.
- Ghost interiority at Ghost scale is read-only; the intermedium MUST NOT modify ghost state.
