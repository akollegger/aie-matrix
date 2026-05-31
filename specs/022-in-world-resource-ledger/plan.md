# Implementation Plan: In-World Resource Ledger

**Branch**: `022-in-world-resource-ledger` | **Date**: 2026-05-31 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/022-in-world-resource-ledger/spec.md`

## Summary

Introduce an append-only, hash-chained, double-entry transaction ledger scoped to a map session. All resource movements between actor-owned bags are recorded as `(:LedgerEntry)` nodes in Neo4j. In-memory bag caches are materialized on startup by replaying the chain. Cost enforcement is wired into the existing `GO` rule check in `movement.ts`. Ghosts read their holdings via a new `inventory` MCP tool. Two resource classes are supported: conserved (fixed total supply) and monotonic (accumulate-only, mint-by-authority).

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `neo4j-driver` v5, `@relateby/pattern` (gram AST), `ulid`, `node:crypto` (SHA-256, no new dep)  
**Storage**: Neo4j (`(:LedgerEntry)` nodes in session subgraph); in-memory `Map` bag caches  
**Testing**: Vitest (unit — in-memory impl, no live services); Vitest (integration — Neo4j-backed, skipped when `NEO4J_URI` unset)  
**Target Platform**: Node.js server (`server/world-api`)  
**Performance Goals**: `inventory` O(1) from memory; `commit` synchronous within single-writer Effect fiber; goal <10ms p95 for commit path at AIEWF scale  
**Constraints**: Single writer per session (enforced by existing `LiveSessionService`); Neo4j round-trip only on write and startup replay  
**Scale/Scope**: ~3000 concurrent ghosts, single long-lived session (Moscone West, AIEWF 2026)

## Constitution Check

- [x] **Proposal linkage**: RFC-0023 (`proposals/rfc/0023-in-world-resource-ledger.md`) — scope matches exactly.
- [x] **Boundary-preserving**: New service lives in `server/world-api`; shared types in `shared/types`; Colyseus consumes via event, not direct coupling.
- [x] **Contract artifacts**: Three contract docs in `contracts/` (LedgerService interface, event shape, MCP tool). All cross-package touchpoints documented.
- [x] **Verifiable increments**: Each phase produces independently runnable/testable output. Unit tests ship in Phase 2 (same change as implementation per constitution).
- [x] **Documentation impact**: `docs/architecture.md` open question resolved; map grammar docs updated; `server/world-api` README updated.
- [x] **Service testing**: Unit tests in same change; integration tests planned in Phase 2 (may land separately if Neo4j unavailable in CI — documented here per constitution).

## Project Structure

### Documentation (this feature)

```text
specs/022-in-world-resource-ledger/
├── plan.md              ← this file
├── research.md          ← Phase 0 ✅
├── data-model.md        ← Phase 1 ✅
├── quickstart.md        ← Phase 1 ✅
├── contracts/
│   ├── ic-ledger-service.md    ← Phase 1 ✅
│   ├── ic-ledger-events.md     ← Phase 1 ✅
│   └── ic-mcp-inventory.md     ← Phase 1 ✅
└── tasks.md             ← Phase 2 (/speckit tasks)
```

### Source Code

```text
shared/types/src/
└── ledger.ts                    # Transaction, Transfer, BagResult, ResourceType, ActionCost, CostQuote

server/world-api/src/
├── LedgerService.ts             # Effect service Tag + LedgerServiceOps interface
├── LedgerServiceLive.ts         # Neo4j-backed Layer implementation
├── LedgerServiceInMemory.ts     # In-memory Layer implementation (tests + PoC)
├── ledger-errors.ts             # Data.TaggedError types (InsufficientFunds, etc.)
├── movement.ts                  # MODIFIED: add cost quote/commit around GO rule check
└── mcp-server.ts                # MODIFIED: add `inventory` tool

server/world-api/test/
├── LedgerService.test.ts        # Unit tests (in-memory impl)
└── LedgerService.integration.test.ts  # Integration tests (Neo4j; skipped when URI unset)

server/src/
└── errors.ts                    # MODIFIED: add ledger errors to HttpMappingError union

maps/sandbox/
└── sandbox.map.gram             # MODIFIED: add [resources:Resources | ...] example block
```

**Structure Decision**: All new code lives in the existing `server/world-api` package. No new top-level directories. Shared types extend the existing `shared/types` package following the established export pattern. Consistent with how `ItemService`, `MapService`, and `LiveSessionService` are structured.

## Phase 0: Research ✅

See [research.md](research.md). All unknowns resolved:
- Hash-chaining: SHA-256 over canonical JSON, `node:crypto`, no new deps
- Single-writer: existing `LiveSessionService` session mutex suffices for MVP
- Bag materialization: in-memory Map, replayed on startup, O(1) reads
- Cost integration: `movement.ts` calls `LedgerService.quote` then `.commit`
- Resource seed: `.map.gram` `[resources:Resources | ...]` block, parsed by `@aie-matrix/map-gram`
- Test strategy: unit (in-memory, same change) + integration (Neo4j, may land separately)

## Phase 1: Design & Contracts ✅

- [data-model.md](data-model.md) — shared types, Neo4j schema, gram extension, in-memory state, state transitions
- [contracts/ic-ledger-service.md](contracts/ic-ledger-service.md) — LedgerService Effect interface + error HTTP mappings
- [contracts/ic-ledger-events.md](contracts/ic-ledger-events.md) — `ledger:transaction:committed` event shape + Colyseus consumer contract
- [contracts/ic-mcp-inventory.md](contracts/ic-mcp-inventory.md) — MCP `inventory` tool schema + read policy
- [quickstart.md](quickstart.md) — local dev setup, verification checklist

## Phase 2: Tasks

Run `/speckit tasks` to generate `tasks.md` with the ordered implementation task list.

Anticipated task sequence:
1. `shared/types/src/ledger.ts` — define all shared types
2. `server/world-api/src/ledger-errors.ts` — `Data.TaggedError` types
3. `server/src/errors.ts` — extend `HttpMappingError` union
4. `server/world-api/src/LedgerServiceInMemory.ts` — in-memory impl
5. `server/world-api/test/LedgerService.test.ts` — unit tests (all paths)
6. `@aie-matrix/map-gram` — parse `[resources:Resources | ...]` and `:GO` cost arrays
7. `server/world-api/src/LedgerServiceLive.ts` — Neo4j-backed impl + startup replay
8. `server/world-api/src/LedgerService.ts` — Effect Tag, wire Layer into session startup
9. `server/world-api/src/movement.ts` — cost quote/accept/receipt integration
10. `server/world-api/src/mcp-server.ts` — `inventory` tool
11. `server/world-api/test/LedgerService.integration.test.ts` — Neo4j integration tests
12. `docs/architecture.md` — mark time-series open question resolved
13. `maps/sandbox/sandbox.map.gram` — add resource seed example
