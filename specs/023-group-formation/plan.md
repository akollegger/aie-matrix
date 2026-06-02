# Implementation Plan: Group Formation and Group Chat

**Branch**: `023-group-formation` | **Date**: 2026-06-02 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/023-group-formation/spec.md`

## Summary

Introduce groups as a first-class disembodied world actor: persistent collectives of ghosts with a shared resource bag and a location-independent group chat thread. Group formation extends the existing `ProposalService` offer/accept handshake with a `shared: true` flag that routes contributions to a newly minted group bag. Admission votes live in-memory with a TTL; outcomes are durably committed to the ledger. Group chat reuses the existing JSONL store and Colyseus `message.new` signal infrastructure, replacing spatial fan-out with a membership fan-out. Five new MCP tools (`group.offer`, `group.vote`, `group.leave`, `group.say`, `group.list`) are registered in `mcp-server.ts`.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `neo4j-driver` v5, `ulid`, `unique-names-generator` (new dep in `server/world-api`)  
**Storage**: Neo4j (`(:Group)` nodes, `MEMBER_OF`/`PARTICIPANT_IN`/`OWNS` edges in session subgraph); JSONL on disk (`{group_id}.jsonl` group chat threads in `CONVERSATION_DATA_DIR`); in-memory `Map` caches for group state and vote windows  
**Testing**: Vitest unit tests (`GroupServiceInMemory`); Vitest integration tests (`GroupServiceLive`, skipped when `NEO4J_URI` unset)  
**Target Platform**: `server/world-api` (Node.js server)  
**Performance Goals**: `group.say` fan-out O(members + participants) in-memory; `group.list` O(1) from in-memory cache; vote resolution O(votes cast) — all <10ms p95 at AIEWF scale  
**Constraints**: Single writer per session (existing `LiveSessionService` mutex); group bag uses existing `LedgerService.commit` — no new storage primitives  
**Scale/Scope**: ~3000 concurrent ghosts; groups typically 2–6 members per RFC-0022 guidance; target hundreds of concurrent groups maximum

## Constitution Check

- [x] **Proposal linkage**: RFC-0024 (`proposals/rfc/0024-group-formation-and-chat.md`) — scope matches exactly. RFC-0023 addendum documented in IC-001 (shared transaction variant).
- [x] **Boundary-preserving**: New `GroupService` lives in `server/world-api`. Shared types in `shared/types/src/group.ts`. `ConversationService` is not modified — a new `GroupChatService`-style method sits inside `GroupService`. `ProposalService` is extended with the `shared` flag (same package, same pattern).
- [x] **Contract artifacts**: Three contract docs in `contracts/` covering `GroupService` interface, group chat message format, and MCP tool schemas. All cross-package touchpoints documented.
- [x] **Verifiable increments**: Each user story is independently demonstrable per the demo scenario in RFC-0024. `quickstart.md` provides runnable smoke tests. Unit tests ship in same change.
- [x] **Documentation impact**: `proposals/rfc/0023-in-world-resource-ledger.md` addendum; `docs/architecture.md` (Group actor type, group chat fan-out model); MCP tool reference; `server/world-api/README.md`.
- [x] **MCP-first**: All five ghost-facing operations are MCP tools. No bespoke HTTP endpoints for domain operations.
- [x] **Service testing**: `GroupServiceInMemory` unit tests in same change. `GroupServiceLive` integration tests planned in same change; may land separately if Neo4j unavailable in CI (documented here per constitution).

## Project Structure

### Documentation (this feature)

```text
specs/023-group-formation/
├── plan.md              ← this file
├── research.md          ← Phase 0 ✅
├── data-model.md        ← Phase 1 ✅
├── quickstart.md        ← Phase 1 ✅
├── contracts/
│   ├── ic-group-service.md        ← Phase 1 ✅
│   ├── ic-group-chat-message.md   ← Phase 1 ✅
│   └── ic-mcp-group-tools.md      ← Phase 1 ✅
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 (/speckit.tasks — not yet created)
```

### Source Code

```text
shared/types/src/
└── group.ts                        # NEW: GroupId, AdmissionOffer, AdmissionVote,
                                    #      VoteWindow, GroupSummary, GroupMessage

server/world-api/src/
├── GroupService.ts                 # NEW: Context.Tag + GroupServiceOps interface
├── GroupServiceInMemory.ts         # NEW: In-memory Layer (unit tests + PoC)
├── GroupServiceLive.ts             # NEW: Neo4j-backed Layer (production)
├── group-errors.ts                 # NEW: Data.TaggedError types for group operations
├── neo4j-graph-init.ts             # MODIFIED: add (:Group) constraint on startup
├── ProposalService.ts              # MODIFIED: add shared flag to ProposeParams + agree path
├── mcp-server.ts                   # MODIFIED: add group.offer, group.vote, group.leave,
                                    #           group.say, group.list handlers
└── index.ts                        # MODIFIED: export GroupService + errors

server/world-api/test/
├── GroupService.test.ts            # NEW: Unit tests (GroupServiceInMemory)
└── GroupService.integration.test.ts # NEW: Integration tests (Neo4j; skipped when URI unset)

shared/types/src/
└── index.ts                        # MODIFIED: re-export group types

server/src/
└── errors.ts                       # MODIFIED: add group errors to HttpMappingError union
```

**Structure Decision**: All new code extends the existing `server/world-api` package and `shared/types` package. No new top-level directories. The pattern mirrors how `LedgerService` was introduced in spec-022 — service tag, in-memory impl, live impl, errors, and tests all co-located in `server/world-api`.

## Phase 0: Research ✅

See [research.md](research.md). All unknowns resolved:
- Group actor representation: `(:Group)` Neo4j node, no new package needed
- Shared formation offer: `shared` flag extension to `ProposalService.ProposeParams`
- Admission vote: in-memory `VoteWindow` with TTL (mirrors `ProposalService` pending proposals)
- Group chat fan-out: new `groupSay` method inside `GroupService` — reuses `JsonlStore` + Colyseus bridge signal
- Group naming: `unique-names-generator` added to `server/world-api` deps
- MCP tool placement: `mcp-server.ts` following existing tool registration pattern

## Phase 1: Design & Contracts ✅

- [data-model.md](data-model.md): `(:Group)` schema, `MEMBER_OF`/`PARTICIPANT_IN`/`OWNS` edges, in-memory `GroupRecord`, ledger transaction shapes for form/join/leave
- [contracts/ic-group-service.md](contracts/ic-group-service.md): Full `GroupServiceOps` interface + error types + dual-impl requirement
- [contracts/ic-group-chat-message.md](contracts/ic-group-chat-message.md): `GroupMessageRecord` JSONL shape, Colyseus signal format, system message examples
- [contracts/ic-mcp-group-tools.md](contracts/ic-mcp-group-tools.md): All five MCP tool schemas, success/error outputs, TCK expectations
- [quickstart.md](quickstart.md): Smoke tests for form, join, leave, group.say, group.list
