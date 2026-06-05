# Research: Eval Contracts Between Ghosts

**Feature**: 024-eval-contracts  
**Date**: 2026-06-04

## Decisions

### 1. Service placement

**Decision**: `EvalContractService` lives in `server/world-api/src/`, following the established pattern of `LedgerService` and `GroupService`.

**Rationale**: All domain services for the world (movement, ledger, groups, calendar) reside in `server/world-api/src/`. There is no motivation to create a new package for a service that is deeply coupled to the ledger and group services already in that package.

**Alternatives considered**: A separate `server/eval-contracts/` package. Rejected because it would add cross-package dependency wiring with no benefit at current scale.

---

### 2. Persistence tier

**Decision**: Implement `EvalContractServiceInMemory.ts` for unit-testable in-memory state, and `EvalContractServiceLive.ts` backed by Neo4j (`(:EvalContract)` nodes). Ship both in the same change, consistent with how `LedgerService` and `GroupService` were delivered.

**Rationale**: The constitution requires unit tests for the in-memory layer and integration tests (or a documented plan) for the Neo4j layer. Parallel to `LedgerServiceInMemory.ts` / `LedgerServiceLive.ts`.

**Alternatives considered**: Neo4j-only. Rejected because unit tests would require a live Neo4j instance, violating the constitution's service testing requirements.

---

### 3. Escrow identity

**Decision**: Use a synthetic escrow actor ID derived from the contract ID (`escrow:<contractId>`). This gives each contract a dedicated ledger bag with zero shared-state risk, and the pattern is a natural extension of the existing `ActorId` type (a plain string).

**Rationale**: RFC-0022 Open Question 1 leaves this as an implementation choice. Per-contract escrow actors are cleanest: no sub-accounting needed, the ledger's existing `bag()` / `commit()` API handles it, and the escrow actor can be queried for audit. A shared system escrow account would require filtering by contract ID to separate balances.

**Alternatives considered**: Shared system holding account. Rejected because it requires per-contract sub-accounting that the ledger does not natively provide.

---

### 4. MCP tool interface

**Decision**: Eval contract operations are exposed as MCP tools on the existing `mcp-server.ts`, consistent with Principle V (MCP/A2A-First Interfaces). Tools are added to the existing `ToolServices` union type.

**Rationale**: All ghost-facing domain operations in the project are MCP tools. The evaluator verdict tool is the resolution of RFC-0022 Open Question 6 ("via what interface").

**Alternatives considered**: HTTP endpoint, admin-only call. Both violate Constitution Principle V.

---

### 5. Opaque payload storage

**Decision**: `request` and `submission` are stored as Neo4j string properties (JSON-serialised from the ghost's perspective, opaque to the contract layer). No schema validation at the contract layer.

**Rationale**: RFC-0022 specifies both as "opaque payload". The contract layer only tracks presence and immutability.

---

### 6. Shared types

**Decision**: New branded types `EvalContractId` and `EvalContractState` are added to `shared/types/src/eval-contract.ts` and exported from `shared/types/src/index.ts`. The `EvalContract` record type is also exported for use by the intermedium client if it later renders contract state.

**Rationale**: Follows the pattern of `GroupId`, `GroupSummary` in `shared/types/src/group.ts`. Keeps the service interface clean and avoids stringly-typed contract IDs.
