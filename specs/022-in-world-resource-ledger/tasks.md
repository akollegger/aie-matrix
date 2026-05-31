# Tasks: In-World Resource Ledger

**Input**: Design documents from `specs/022-in-world-resource-ledger/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story this task belongs to (US1, US2, US3)
- Exact file paths in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and error infrastructure that all phases depend on.

- [x] T001 Add `shared/types/src/ledger.ts` — export `ResourceId`, `ActorId`, `TransactionId`, `ResourceClass`, `ResourceType`, `Transfer`, `Transaction`, `BagEntry`, `BagResult`, `ActionCost`, `CostQuote` per `specs/022-in-world-resource-ledger/data-model.md`
- [x] T002 Re-export ledger types from `shared/types/src/index.ts`
- [x] T003 Add `server/world-api/src/ledger-errors.ts` — `Data.TaggedError` types: `InsufficientFunds`, `ConservationViolation`, `DuplicateTransaction`, `UnknownResource`, `UnknownActor`, `ChainTamperedError`, `PersistenceError` per `specs/022-in-world-resource-ledger/contracts/ic-ledger-service.md`
- [x] T004 Extend `HttpMappingError` union in `server/src/errors.ts` to include ledger errors; add exhaustive `_tag` cases in `errorToResponse()` per `specs/022-in-world-resource-ledger/contracts/ic-ledger-service.md` HTTP mapping table

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `LedgerService` interface, in-memory implementation, and unit tests. Must be complete before US1 integration into `movement.ts` and `mcp-server.ts`.

**⚠️ CRITICAL**: US1, US2, and US3 integration work cannot begin until this phase is complete.

- [x] T005 Add `server/world-api/src/LedgerService.ts` — define `LedgerServiceOps` interface and `LedgerService` Effect `Context.Tag` per `specs/022-in-world-resource-ledger/contracts/ic-ledger-service.md`
- [x] T006 Add `server/world-api/src/LedgerServiceInMemory.ts` — in-memory implementation of `LedgerServiceOps`: SHA-256 hash-chaining (`node:crypto`), ULID idempotency set, in-memory `Map<ActorId, Map<ResourceId, number>>` bag cache, conservation validation, floor enforcement, monotonic-class transfer rejection, `PersistenceError` not applicable (in-memory always succeeds)
- [x] T007 Add `server/world-api/test/LedgerService.test.ts` — unit tests using in-memory implementation (no live services required):
  - `bag()` returns empty holdings for a new actor
  - `commit()` reward: conservation invariant holds (world loses, ghost gains, sum unchanged)
  - `commit()` spend: ghost balance decremented, world balance incremented
  - `commit()` `InsufficientFunds`: denied when balance below cost, balance unchanged
  - `commit()` `DuplicateTransaction`: same ULID rejected on second submission
  - `commit()` `UnknownResource`: rejected when resource type not registered
  - `commit()` conservation violation: detected and rejected
  - `verify()` passes on untampered chain
  - `verify()` `ChainTamperedError`: detected when a historical entry hash is mutated
  - `commit()` monotonic mint: balance accumulates; `Transfer` from monotonic source accepted
  - `commit()` monotonic transfer: rejected when a ghost attempts to transfer monotonic resource to another actor
- [x] T008 Extend `server/world-api/src/LedgerServiceInMemory.ts` — add `resourceTypes()` method returning registered types; add session-start seed method that appends a genesis transaction seeding the world bag from a `ResourceType[]` declaration
- [x] T009 Add `@aie-matrix/map-gram` parser support for `[resources:Resources | ...]` layer block — parse `(:Resource { id, class, qty, floor, label })` nodes into `ResourceType[]`; update gram AST types as needed
- [x] T010 Add `@aie-matrix/map-gram` parser support for `cost` array property on `:GO` rule edges — parse `[{ qty, resource, payee }]` into `ActionCost[]` on the rule edge AST node

**Checkpoint**: `pnpm --filter @aie-matrix/server-world-api test` passes. In-memory ledger is fully exercised; map parser handles resource seeds and GO costs.

---

## Phase 3: User Story 1 — Ghost checks and spends resources (Priority: P1) 🎯 MVP

**Goal**: A ghost can call `inventory`, be rewarded gold by a server mechanic, move across a costed edge (paying the cost), and be denied when underfunded. Conservation invariant holds throughout.

**Independent Test**: Seed a sandbox map with `gold: 100`. Credit a ghost 20 gold. `inventory` returns `{ gold: 20 }`, world holds `gold: 80`. Cross a costed edge (5 gold). `inventory` returns `{ gold: 15 }`, world holds `gold: 85`. Sum stays 100. Attempt with 3 gold → `INSUFFICIENT_FUNDS`, balance unchanged.

- [x] T011 [US1] Add `server/world-api/src/LedgerServiceLive.ts` — Neo4j-backed implementation of `LedgerServiceOps`:
  - On `init()`: read `LEDGER_HEAD` from `(:LiveSession)` if present; replay `[:NEXT_ENTRY]` chain to rebuild bag cache and idempotency set; if no head, append genesis seed transaction and set `LEDGER_HEAD` + `LEDGER_TIP`
  - On `commit()`: validate (conservation, floor, duplicate, unknown resource) → write `(:LedgerEntry)` node → create `[:NEXT_ENTRY]` from old tip → move `[:LEDGER_TIP]` to new entry (atomic Neo4j transaction) → update in-memory cache; on Neo4j failure roll back cache update and return `PersistenceError`
  - Use `LEDGER_TIP` relationship to read chain tip hash without scanning the full chain
- [x] T012 [US1] Wire `LedgerService` Layer into the session startup sequence in `server/world-api/src/index.ts` (or wherever `LiveSessionService` is provided) — provide `LedgerServiceLive` layer; call `LedgerService.init()` after session is established; provide `LedgerServiceInMemory` as a fallback for local dev without Neo4j
- [x] T013 [US1] Add `inventory` MCP tool to `server/world-api/src/mcp-server.ts` per `specs/022-in-world-resource-ledger/contracts/ic-mcp-inventory.md` — call `LedgerService.bag(actorId)`; apply `public`/`self` read policy (default `public` for MVP); return `BagResult` as JSON
- [x] T014 [US1] Modify `server/world-api/src/movement.ts` — before committing a `GO` action, read cost array from rule edge AST; if costs present: call `LedgerService.quote(actorId, costs)` and include quote in response; apply autonomy-threshold consent (auto-accept below threshold, MCP checkpoint above); on acceptance call `LedgerService.commit(costTransaction)` atomically with the movement; on `InsufficientFunds` deny the `GO` with that error
- [x] T015 [US1] Add maps resource seed to `maps/sandbox/sandbox.map.gram` — add `[resources:Resources | (:Resource { id: "gold", class: "conserved", qty: 100, floor: 0, label: "Gold" })]` and a costed `:GO` rule edge example
- [x] T016 [US1] Add integration tests in `server/world-api/test/LedgerService.integration.test.ts` — skip when `NEO4J_URI` unset; cover:
  - Genesis seed written and replayed correctly after restart
  - `(:LedgerEntry)` nodes present in Neo4j after commits
  - `LEDGER_HEAD` / `LEDGER_TIP` relationships correct after N appends
  - Bag balances match pre-restart state after server restart + replay
  - Neo4j write failure (simulate by killing connection) → `PersistenceError`, cache unchanged

**Checkpoint**: `pnpm --filter @aie-matrix/server-world-api test` passes (unit). `inventory` MCP tool works end-to-end locally. Costed `GO` move quotes, deducts, and denies correctly. Conservation sum verifiable.

---

## Phase 4: User Story 2 — Operator verifies ledger integrity (Priority: P2)

**Goal**: An operator can replay the log from genesis to confirm all bag balances match the live cache, detect tampering in any historical entry, confirm restart durability, and confirm duplicate transaction rejection.

**Independent Test**: Run a sequence of transactions. Rebuild bags from genesis — all balances match. Mutate a historical `(:LedgerEntry).hash` in Neo4j — `verify()` returns `ChainTamperedError`. Restart server — balances identical. Submit duplicate ULID — rejected.

- [ ] T017 [US2] Expose `LedgerService.verify()` through an operator HTTP route (e.g. `GET /admin/ledger/verify`) in `server/world-api/src/` — requires `AGENT_HOST_TOKEN` bearer auth; returns `{ entries: number }` on success or `ChainTamperedError` details on failure; register route in the server router
- [ ] T018 [US2] Add route-level tests for `GET /admin/ledger/verify` in `server/world-api/test/` — request without bearer token → 401; request with valid token on clean chain → 200 `{ entries: N }`; request after manual Neo4j entry mutation → 200 with tamper detail body (unit tests for `verify()` itself are already in T007)
- [ ] T019 [US2] Document the verify endpoint in `specs/022-in-world-resource-ledger/quickstart.md` — add "Verify ledger integrity" section with curl example and expected output

**Checkpoint**: `GET /admin/ledger/verify` returns entry count on clean chain; returns tamper detail when a Neo4j entry is manually mutated.

---

## Phase 5: User Story 3 — Monotonic resources accumulate and cannot be traded (Priority: P3)

**Goal**: A server mechanic can mint XP to a ghost. The ghost's XP accumulates via `inventory`. Any attempt to transfer XP between actors is rejected.

**Independent Test**: Mint 50 XP to a ghost. `inventory` returns `{ xp: 50 }`. Mint 30 more — `inventory` returns `{ xp: 80 }`. Ghost attempts `commit` transferring XP to another ghost → rejected. Conservation check: XP total is not bounded (monotonic), but no XP disappears from a bag once minted.

- [ ] T020 [US3] Add XP resource to sandbox map in `maps/sandbox/sandbox.map.gram` — `(:Resource { id: "xp", class: "monotonic", qty: 0, floor: 0, label: "Experience" })`
- [ ] T021 [US3] Add a `rewardXp(actorId, qty)` helper in `server/world-api/src/` (e.g. a mechanic utility) that calls `LedgerService.commit()` with a monotonic XP mint transaction — demonstrates the trust-by-call-site authorization pattern
- [ ] T022 [US3] Add unit tests for monotonic behaviour to `server/world-api/test/LedgerService.test.ts` (extend existing file):
  - Multiple mints accumulate correctly in `bag()`
  - Transfer of monotonic resource between two ghost actors → rejected with appropriate error
  - Monotonic resource does not affect conservation sum check for conserved resources

**Checkpoint**: `pnpm --filter @aie-matrix/server-world-api test` passes including monotonic tests. `inventory` shows accumulated XP. Transfer rejection confirmed.

---

## Phase 6: User Story 4 — Ghost-to-ghost resource trade (Priority: P4)

**Goal**: Two ghosts can negotiate and execute a direct resource exchange using `offer`/`request`, `agree`, and `decline`. Proposals expire automatically. The ledger only sees the final consented commit.

**Independent Test**: Ghost A calls `offer` (give 10 gold, want 5 energy). Ghost B calls `agree`. Confirm both balances updated atomically and conservation holds. Then: Ghost A calls `offer` again; Ghost B calls `decline` — balances unchanged, proposal gone.

- [ ] T029 [US4] Add `Proposal` type to `shared/types/src/ledger.ts` — `{ proposalId: string, initiatorId: ActorId, counterpartyId: ActorId, give: Transfer, want: Transfer, expiresAt: number, status: "pending" | "agreed" | "declined" | "expired" }` per IC-005
- [ ] T030 [US4] Add `ProposalService.ts` in `server/world-api/src/` — in-memory store of pending proposals; `propose()` creates with ULID + TTL; `agree()` calls `LedgerService.commit()` with both actors' consent and marks agreed; `decline()` marks declined; TTL sweep runs on a 30s interval via Effect fiber; emits `ledger.proposal.expired` on expiry
- [ ] T031 [US4] Add trade error types to `server/world-api/src/ledger-errors.ts` — `ProposalNotFound`, `SelfAgreeDenied`, `ProposalExpired`, `MonotonicTradeRejected`; add to `HttpMappingError` union in `server/src/errors.ts`
- [ ] T032 [US4] Add `offer` MCP tool to `server/world-api/src/mcp-server.ts` — params: `to` (actorId), `give` ({resource, qty}), `for` ({resource, qty}); validates counterparty exists, resource is conserved, initiator has sufficient balance (quote only — not committed); returns `{ ok: true, proposalId, expiresAt }`
- [ ] T033 [US4] Add `request` MCP tool to `server/world-api/src/mcp-server.ts` — params: `from` (actorId), `want` ({resource, qty}), `offering` ({resource, qty}); same validation as `offer`; creates proposal with roles reversed; returns `{ ok: true, proposalId, expiresAt }`
- [ ] T034 [US4] Add `agree` MCP tool to `server/world-api/src/mcp-server.ts` — params: `proposalId`; rejects if caller is the initiator (`SelfAgreeDenied`); calls `ProposalService.agree()` → `LedgerService.commit()`; returns receipts for both transfers on success
- [ ] T035 [US4] Add `decline` MCP tool to `server/world-api/src/mcp-server.ts` — params: `proposalId`; callable by either party; calls `ProposalService.decline()`; returns `{ ok: true, proposalId }`
- [ ] T036 [US4] Add unit tests in `server/world-api/test/ProposalService.test.ts` — full offer→agree flow (both balances update, conservation holds); offer→decline (no ledger change); INSUFFICIENT_FUNDS on agree when initiator balance dropped; SelfAgreeDenied; MonotonicTradeRejected on offer; TTL expiry voids proposal
- [ ] T037 [US4] Update `server/world-api/src/mcp-server.ts` `inventory` handler to merge ledger `BagResult` with `ItemService` items — unified response: `{ ok: true, holdings: [{resource, qty, label}], items: [{itemRef, name}] }`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Update `docs/architecture.md` — mark the *Time-Series / Event Log Backend* open question as resolved: Neo4j `(:LedgerEntry)` chain per RFC-0023 §2
- [ ] T024 [P] Add `ledger:transaction:committed` Redis pub/sub emit in `server/world-api/src/LedgerServiceLive.ts` after each successful `commit()` — emit event shape per `specs/022-in-world-resource-ledger/contracts/ic-ledger-events.md` (changes array with `actorId`, `resource`, `newBalance`, `delta`); use existing `RedisPublishService`
- [ ] T025 [P] Add `ledger:transaction:committed` subscriber in `server/colyseus/` — on each event, broadcast `newBalance` for `public`-policy resources to connected spectators via Colyseus state update
- [ ] T026 [P] Update `docs/guides/ghost-action-reference.md` — extend `inventory` entry to show unified `holdings` + `items` response shape; add entries for `offer`, `request`, `agree`, `decline` (parameters, returns, error codes); per SC-011
- [ ] T026b [P] Update `server/world-api/README.md` (or package docs) — document `LedgerService`, `ProposalService`, costed GO edges, and local dev quickstart reference
- [ ] T027 Run full verification checklist from `specs/022-in-world-resource-ledger/quickstart.md` — confirm all items pass; record results
- [ ] T028 Add commit-latency benchmark to `server/world-api/test/LedgerService.bench.ts` — using Vitest bench, measure `LedgerService.commit()` (in-memory impl) over 1000 sequential commits; assert p95 < 10ms; documents SC-008 baseline (Neo4j-backed p95 tracked separately via integration test timing)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T001–T004 can all run in parallel.
- **Phase 2 (Foundational)**: Depends on Phase 1. T005 depends on T001–T002. T006 depends on T005. T007 depends on T006. T008 depends on T006. T009–T010 are independent of T005–T008 and can run in parallel with them.
- **Phase 3 (US1)**: Depends on Phase 2. T011 depends on T005–T006. T012 depends on T011. T013–T014 depend on T012. T015 depends on T009–T010. T016 depends on T011–T014.
- **Phase 4 (US2)**: Depends on Phase 3 (needs the live service wired). T017–T019 can run in parallel with each other.
- **Phase 5 (US3)**: Depends on Phase 2. Can run in parallel with Phase 4 (different files).
- **Phase 6 (US4)**: Depends on Phase 2 (needs `LedgerService`). T029–T031 can run in parallel. T030 depends on T029; T032–T035 depend on T030–T031; T036 depends on T030–T035; T037 depends on T013 (existing inventory tool).
- **Phase 7 (Polish)**: Depends on Phases 3–6. T023, T024, T025, T026, T026b, T027, T028 can all run in parallel.

### User Story Dependencies

- **US1**: Depends on Foundational (Phase 2). No dependency on US2 or US3.
- **US2**: Depends on US1 (needs the live service and verify endpoint).
- **US3**: Depends on Foundational (Phase 2). Independent of US2.
- **US4**: Depends on Foundational (Phase 2). Can run in parallel with US2 and US3. Integrates with US1's `LedgerService` layer.

---

## Parallel Example: Phase 2 (Foundational)

```
# These can run concurrently:
T005  LedgerService.ts (interface + Tag)
T009  map-gram resources block parser
T010  map-gram GO cost parser

# T006 starts after T005:
T006  LedgerServiceInMemory.ts

# T007 + T008 start after T006:
T007  LedgerService.test.ts (unit tests)
T008  Extend InMemory with seed/resourceTypes
```

## Parallel Example: Phase 6 (Polish)

```
# All can run concurrently (different files/packages):
T023  docs/architecture.md update
T024  Redis emit in LedgerServiceLive.ts
T025  Colyseus subscriber
T026  server/world-api README
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1: Setup (shared types + errors)
2. Complete Phase 2: Foundational (in-memory impl + unit tests + gram parsers)
3. Complete Phase 3: US1 (Neo4j live impl, inventory tool, costed GO, sandbox map)
4. **STOP and VALIDATE**: run quickstart checklist, confirm conservation and deny behaviour
5. Deploy if ready

### Incremental Delivery

1. Phase 1 + 2 → foundation + unit tests green
2. Phase 3 → inventory + costed movement end-to-end (**MVP**)
3. Phase 4 → operator verify endpoint
4. Phase 5 → monotonic XP accumulation
5. Phase 6 → Colyseus broadcast, docs, Redis events

### Total Tasks: 37

| Phase | Tasks | Parallelizable |
|---|---|---|
| Phase 1: Setup | 4 | 4 |
| Phase 2: Foundational | 6 | 3 |
| Phase 3: US1 | 6 | 1 |
| Phase 4: US2 | 3 | 3 |
| Phase 5: US3 | 3 | 1 |
| Phase 6: US4 (trade) | 9 | 3 |
| Phase 7: Polish | 7 | 5 |
