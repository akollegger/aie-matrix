# Research: Ghost Conversation Mechanics

**Feature**: specs/006-ghost-conversation  
**Date**: 2026-04-20

## Decision 1: Ghost Conversational State Storage

**Decision**: Dual-track state — `ConversationService` (Effect-ts service in `server/conversation/`) owns the authoritative in-memory state; `MatrixRoom` reflects it in a new `ghostModes: MapSchema<string>` Colyseus schema field for spectator and debug panel visibility.

**Rationale**: `ConversationService` is the package boundary established by ADR-0003. Movement enforcement in `go`/`traverse` must check this service. Mirroring into Colyseus schema costs one extra write per state transition but gives the debug panel and spectators real-time visibility at zero additional polling cost.

**Alternatives considered**:
- Store only in MatrixRoom: couples conversation concerns into the Colyseus package, violates ADR-0003.
- Store only in ConversationService: debug panel cannot observe state without a separate polling endpoint.

---

## Decision 2: Message Notification Delivery (PoC)

**Decision**: For the PoC, add an `inbox` MCP tool that returns pending `message.new` notifications for the calling ghost. `random-house` and `ghost-cli` poll this tool to discover incoming messages. The Colyseus push model described in RFC-0005 is deferred.

**Rationale**: Ghost agents connect via MCP over HTTP (stateless per request). They do not have a persistent Colyseus WebSocket connection. Implementing a full ghost-side Colyseus client for the PoC would require substantial new infrastructure (ghost house Colyseus connection lifecycle, auth, reconnection). Polling via `inbox` achieves the same behavioral outcome — random-house responds to messages, ghost-cli shows them in the log — with far less complexity. The `inbox` tool is additive; when ghost houses get real Colyseus connections, it can be deprecated without changing `say`, `bye`, or the store.

**Alternatives considered**:
- Server-sent events (SSE) from world-api: requires persistent HTTP connections and changes to ghost HTTP client.
- Ghost-side Colyseus client: correct target architecture but too large a scope for PoC — deferred to a future RFC.
- Embed message notifications in `look` response: conflates presence with conversation, complicates `look` semantics.

**PoC deviation note**: `inbox` does not appear in RFC-0005. It is an implementation bridge that satisfies the user-observable behavior (ghost house responds to messages) without requiring the Colyseus push infrastructure the RFC describes. The `inbox` tool and its server-side notification queue are `server/conversation/` internals — they do not appear in any public contract.

---

## Decision 3: Message ID Format

**Decision**: ULID via the `ulid` npm package (`npm:ulid`). Apply project-wide.

**Rationale**: ULID is lexicographically sortable (load-bearing for `list(after: message_id)` pagination), collision-resistant, and requires no coordination. The RFC explicitly recommends ULID. The `ulid` package is zero-dependency and ESM-compatible.

**Alternatives considered**:
- UUID v4: not sortable by time, breaks cursor-based pagination.
- UUID v7: sortable, but ULID is simpler and already named in RFC-0005.
- Incrementing integer: requires coordination, breaks across restarts.

---

## Decision 4: `role` Field Value (PoC)

**Decision**: Use `role: "user"` for all ghost-originated messages in the PoC. The `mx_ghost_type` open question from RFC-0005 is deferred — the field is omitted from the PoC message record schema.

**Rationale**: RFC-0005 explicitly flags the `role`/`mx_ghost_type` question as unresolved and gates the conversation store on it. Using `role: "user"` for all ghost messages is the simplest valid OpenAI-compatible shape. Adding `mx_ghost_type` later is a non-breaking schema addition.

---

## Decision 5: Cluster Computation

**Decision**: Use `h3-js` `gridDisk(h3Index, 1)` to get the 7-cell set, then call `MatrixRoom.listOccupantsOnCell(cellId)` for each cell. Exclude the speaker. This runs synchronously in the `say` handler inside `ConversationService`.

**Rationale**: `h3-js` is already a workspace dependency (added in 005-h3-coordinate-system). `gridDisk(k=1)` returns exactly the speaker's cell plus its six immediate neighbors, matching the cluster definition in RFC-0005. `MatrixRoom.listOccupantsOnCell` already exists. No new infrastructure required.

---

## Decision 6: TranscriptHubService

**Decision**: `TranscriptHubService` (currently a stub in `server/src/services/`) is superseded by `ConversationService`. The stub's `notifyGhost()` function is replaced by the `inbox` queue mechanism in `ConversationService`. The existing `PubSub` wiring in `server/src/index.ts` is removed.

**Rationale**: The transcript hub was scaffolded before the conversation model was designed. `ConversationService` covers its intended purpose (ghost-to-ghost notification bridge) with a cleaner interface derived from RFC-0005 and ADR-0003.

---

## Decision 7: HTTP Endpoint Placement

**Decision**: Conversation HTTP routes (`GET /threads/:ghostId`, `GET /threads/:ghostId/:messageId`) are registered in `server/src/index.ts` by mounting the `ConversationRouter` from `server/conversation/`. Auth middleware (JWT ghost house key verification) reuses the existing `server/auth/` service.

**Rationale**: The combined server entry point already mounts `server/registry/` and `server/world-api/` routes. Mounting `server/conversation/` routes follows the same pattern without requiring a separate deployable.

---

## Decision 8: random-house Conversation Behavior

**Decision**: random-house conversation loop:
1. **Initiate**: After `look`, if `occupants.length > 0` and not in conversational mode, 20% chance to issue `say` with a canned greeting.
2. **Respond**: After each successful `inbox` poll that returns messages, always issue `say` with a canned response.
3. **Depart**: While in conversational mode, 15% chance per polling tick to issue `bye`.
4. **Resume walking**: After `bye`, return to the standard movement loop.

`inbox` is polled on the same interval as the walk loop (`AIE_MATRIX_WALK_INTERVAL_MS`, default 1500ms). When in conversational mode, the walk step is skipped and only `inbox` + possible `say`/`bye` is executed.

**Rationale**: Simple probabilistic behavior produces observable and varied conversation patterns. Canned messages are sufficient for the PoC; the ghost house is not expected to generate natural language at this stage.
