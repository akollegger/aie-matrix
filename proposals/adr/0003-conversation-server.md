# ADR-0003: Conversation Server as a Dedicated Service

**Status:** accepted  
**Date:** 2026-04-20  
**Authors:** @aie-matrix

## Context

RFC-0005 defines the ghost conversation model: each ghost owns a persistent broadcast thread, utterances are delivered as Colyseus signals, and full content is persisted to a pluggable store. This introduces two new responsibilities that do not belong cleanly in any existing server package:

1. **Utterance persistence** — writing and serving JSONL records keyed by `thread_id` and `utterance_id`, accessible to ghost house managers via HTTP.
2. **Cluster subscription management** — tracking which ghosts are within each other's 7-cell cluster and signaling `ghost.entered_cluster`, `ghost.left_cluster`, and `utterance.new` events through Colyseus.

The existing server packages are `server/colyseus/` (world state and spectator sync), `server/world-api/` (MCP tools and movement), and `server/registry/` (ghost registration and adoption). None of these is an appropriate host for conversation concerns without creating cross-cutting dependencies that would be costly to untangle later.

A decision is needed on whether conversation responsibilities belong in an existing package or a new dedicated service, and what the boundaries of that service are.

## Decision

Conversation responsibilities are implemented as a new dedicated package, `server/conversation/`, with two clearly bounded concerns:

- **Notification bridge** — when a ghost issues `say`, computes the current cluster snapshot and emits `message.new` signals through the Colyseus presence layer to all ghosts currently within range.
- **Conversation store** — persists utterance records and exposes them via HTTP endpoints (`GET /threads/{ghost_id}` and `GET /threads/{ghost_id}/{utterance_id}`). The initial store implementation is JSONL on disk; the interface is pluggable.

The `say` MCP tool is added to `server/world-api/` (consistent with where all other ghost MCP tools live) and calls into `server/conversation/` to write the message record and trigger fan-out.

## Rationale

**Colyseus is a notification bus, not a content store.** Colyseus is optimized for real-time state sync across connected clients. Persisting utterance content there would couple content lifetime to room lifecycle, lose content on restart, and make async reads by ghost house managers impossible. Keeping Colyseus as signal-only and routing content to a separate store is the architecturally honest split.

**`server/world-api/` already owns the MCP surface.** Adding `say` alongside `go`, `exits`, and `look` is consistent with the existing pattern. The tool implementation delegates persistence and fan-out to `server/conversation/` rather than handling it inline — this keeps `world-api` focused on the ghost wire protocol (ADR-0001) without absorbing store or notification concerns.

**A dedicated package makes the pluggable store boundary explicit.** The conversation store interface (`append`, `get`, `list`) is the primary extension point for third-party contributors — memory module authors, eval researchers, and vendors who want to analyze message data. A dedicated package gives that interface a clear home, a focused README, and a test surface that doesn't require standing up the full Colyseus stack.

**Avoids premature coupling to Neo4j.** Architecture.md names Neo4j as the world graph backend but explicitly leaves the conversation store as an open question. Routing conversation concerns through a dedicated service means the store implementation can be swapped (JSONL → SQLite → columnar) without touching the world graph, the Colyseus room, or the MCP tool definition.

## Alternatives Considered

**Add conversation logic to `server/colyseus/`** — Colyseus already manages presence and room state, so cluster membership is a natural fit. Rejected because Colyseus is not a system of record; content written to room state is lost on restart and not queryable. Ghost house managers need async HTTP access to conversation history, which Colyseus does not provide.

**Add conversation logic to `server/world-api/`** — world-api already owns the `say` MCP tool, so co-locating persistence there avoids a cross-package call. Rejected because it conflates the ghost wire protocol (ADR-0001) with storage and notification concerns. The pluggable store interface would become an internal detail of world-api rather than a first-class extension point, making it harder for contributors to provide alternative implementations.

**Persist utterances to Neo4j directly** — Neo4j is already the world graph and could store utterances as nodes with spatial and temporal context, making them graph-traversable. Not rejected permanently — this is the natural long-term home for message data that feeds the social graph. Deferred because write latency at conference volume is unproven, and the pluggable store interface in `server/conversation/` means Neo4j can be added as an implementation later without changing any upstream contract.

**Single combined server process** — keep all server concerns in one deployable unit and avoid inter-package calls. The PoC already does this via the combined `server/` entry point. `server/conversation/` is a package within the monorepo, not a separate deployed service — it participates in the same combined process for the PoC and can be split later if scale warrants. This is not a distributed systems decision.

## Consequences

**Easier:**
- The pluggable store interface has a clear home and can be documented, tested, and extended independently of the Colyseus and MCP layers.
- Ghost house managers have a stable HTTP API for message history that is decoupled from Colyseus room lifecycle.
- Swapping the store backend (JSONL → SQLite → columnar) is a contained change within `server/conversation/` with no upstream impact.
- Neo4j can be introduced as a store implementation behind the existing interface when volume warrants, without touching world-api or Colyseus.

**Harder:**
- The `speak` MCP tool in `server/world-api/` now has a runtime dependency on `server/conversation/`. This is a new inter-package coupling that must be wired correctly in the combined server entry point and documented for contributors.
- Cluster snapshot computation runs in the notification bridge on each `say` call. Because `say` also transitions the speaker into conversational mode — where movement is suspended — the speaker's position is guaranteed stable for the conversation's lifetime. Cluster calculation is never triggered by position updates, only by messages. Performance characteristics should still be validated during load testing.
- A third contributor surface is introduced. `server/conversation/` needs its own README, interface documentation, and quickstart — scope that does not exist yet.

**Reversibility:** Moderate cost. The `speak` tool and the HTTP store endpoints will be consumed by ghost house managers from the first implementation. Changing the package boundary or merging conversation concerns back into world-api or Colyseus would require coordination with third-party integrators. The store interface is the most important contract to get right before external consumption begins.
