# Tasks: Resource Lifecycle (027)

**Input**: Design documents from `specs/027-resource-lifecycle/`  
**Branch**: `027-resource-lifecycle`

**Map file status** (reviewed as part of task generation):
- `maps/sandbox/redbluegreen.map.gram` — **needs update**: has `[resources:Resources]` block (gold/xp/badge) and movement cost rules referencing "gold"; movement costs are out of scope → remove resources block and cost attributes from GO rules
- `maps/sandbox/canonical.map.gram` — no resources block; item placements valid; leaderboard `resource:` fields are string labels (not ResourceType refs) — no change needed
- `maps/sandbox/read-and-collect.map.gram` — item placements without qty (defaults to 1) — compatible as-is
- `maps/sandbox/freeplay.map.gram` — ItemType declarations, no resources block — compatible as-is
- All other maps — no items or resources — no change needed

---

## Phase 1: Setup

**Purpose**: Confirm branch state, record proposal linkage, no new directories needed.

- [ ] T001 Verify `specs/027-resource-lifecycle/` artifacts are committed and plan.md references RFC-0023 correctly
- [ ] T002 Update `maps/sandbox/redbluegreen.map.gram` — remove `[resources:Resources]` block (lines 11–15) and remove `costResource`/`costQty` attributes from GO rules (lines 23–25), leaving free movement between tile types

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Grammar, shared types, and ledger interface changes that all user stories depend on. Must complete before any story work.

⚠️ **CRITICAL**: All downstream packages import from `shared/map-gram` and `shared/types`. Complete this phase before touching `server/`.

- [ ] T003 In `shared/map-gram/src/types.ts`: rename `itemTypeName → itemRef` in `ParsedItemPlacement`; add `qty: number` (default 1); add `SpawnGrant` interface; remove `ParsedResourceType`; remove `resourceTypes` from `ParsedMap`; add `spawnGrants: SpawnGrant[]` to `ParsedMap`
- [ ] T004 In `shared/map-gram/src/parse.ts`: parse `qty` from item placement gram node using `intProp` helper (default 1); parse `[spawngrants:SpawnGrants | ...]` block into `SpawnGrant[]`; emit `MapGramParseError` when `[resources:Resources]` block is present; stop populating `resourceTypes`
- [ ] T005 In `shared/map-gram/src/index.ts`: export `SpawnGrant`; remove `ParsedResourceType` export
- [ ] T006 [P] In `shared/types/src/items.ts`: remove `ItemDefinition` interface and `ItemSidecar` type alias (consumers will import `ItemTypeDef` from `@aie-matrix/map-gram`)
- [ ] T006b [P] In `shared/types/src/ledger.ts`: remove `ResourceType` interface; remove `CatalogResourceGrant` type
- [ ] T007 In `shared/types/src/index.ts`: remove re-exports of `ItemDefinition`, `ItemSidecar`, `ResourceType`, `CatalogResourceGrant`
- [ ] T008 Add `ItemSeed` interface to `server/world-api/src/LedgerService.ts`: `{ itemRef: string; qty: number; h3Index?: string }`; change `init(seed: ResourceType[])` → `init(seed: ItemSeed[])`; remove `resourceTypes()` and `ensureResourceType()` from `LedgerServiceOps`
- [ ] T009 In `server/world-api/src/ledger-errors.ts`: delete `LedgerMonotonicTradeRejected` class; remove it from the `LedgerError` union type
- [ ] T010 In `server/world-api/src/LedgerServiceInMemory.ts`: remove `ResourceType` import and `resourceTypes` Map; remove monotonic checks (`rt.class === "monotonic"` branches); remove `LedgerMonotonicTradeRejected` usage; simplify `init()` to accept `ItemSeed[]` and create genesis transfers to `world@{h3Index}` or `world`; remove `resourceTypes()` and `ensureResourceType()` implementations; remove `LedgerUnknownResource` check based on resource type registry (validation moves upstream)
- [ ] T011 In `server/world-api/src/LedgerServiceLive.ts`: same removals as T010 for the Neo4j-backed implementation; replace `ResourceType` Neo4j node write (`MERGE (r:ResourceType ...)`) with no-op or `ItemType` registration if needed for replay; update genesis Cypher to use `ItemSeed` actor IDs (`world@{h3Index}` / `world`)
- [ ] T012 In `server/world-api/src/mechanics.ts`: delete monotonic mint helpers (`awardXp`, movement cost helpers); delete file if empty after removal
- [ ] T013 Update `shared/map-gram` unit tests: update `ParsedItemPlacement` fixture field from `itemTypeName` → `itemRef`; add test for `qty` parsing; add test for `SpawnGrant` block parsing; add test asserting `MapGramParseError` when `[resources:Resources]` block present
- [ ] T014 Update `server/world-api/src/agent-resource-grants.test.ts`: replace `ResourceType` fixtures with `ItemSeed` fixtures; remove `ensureResourceType` calls; verify `init()` accepts `ItemSeed[]`

**Checkpoint**: `pnpm run build` passes. `pnpm test` in `shared/map-gram` and `server/world-api` passes with updated fixtures.

---

## Phase 3: US1 — Map Authoring: Place Items with Quantity (P1)

**Goal**: Map authors can declare `qty` on item placements; the parser produces correct counts; session init seeds the world bag from placements.

**Independent Test**: Parse a `.map.gram` fixture with `qty: 10` on a placement; confirm `ParsedItemPlacement.qty === 10` and world bag after `ledger.init()` holds 10 units at that tile.

- [ ] T015 [US1] In `server/colyseus/src/mapLoader.gram.ts`: import `ItemTypeDef` from `@aie-matrix/map-gram` instead of `ItemDefinition` from `@aie-matrix/shared-types`; update `LoadedMap.itemSidecar` type to `Map<string, ItemTypeDef>`; expand `qty` in `initialItemRefs` by repeating itemRef N times per placement
- [ ] T016 [US1] In `server/colyseus/src/mapTypes.ts` (or wherever `LoadedMap` is defined): update `itemSidecar: Map<string, ItemTypeDef>` type
- [ ] T017 [US1] In `server/world-api/src/index.ts` (or session init): derive `ItemSeed[]` from `parsedMap.itemPlacements` by grouping on `(itemRef, h3Index)` and summing `qty`; pass to `ledger.init()`; remove any `resourceTypes`-based seeding
- [ ] T018 [US1] Add unit test in `shared/map-gram`: given map with `(:Item:GoldCoin { geometry: [h3\`…\`], qty: 10 })`, assert `itemPlacements[0].qty === 10`
- [ ] T019 [US1] Add unit test in `server/world-api`: given `ItemSeed[{ itemRef: "GoldCoin", qty: 10, h3Index: "…" }]`, after `ledger.init()` assert `bag("world@{h3Index}").GoldCoin === 10`

**Checkpoint**: `pnpm test` in `shared/map-gram` (qty tests) and `server/world-api` (init seeding tests) pass.

---

## Phase 4: US2 — Session Init: World Bag Seeded from Placements (P1)

**Goal**: Session starts with world bag matching placement totals; `[resources:Resources]` block causes parse error.

**Independent Test**: Start a session from a map with only item placements (no resources block); `ledger_verify` returns `{ valid: true }`; `ledger.bag("world@{h3}")` equals placement qty.

- [ ] T020 [US2] In `server/world-api`: wire `parsedMap.spawnGrants` into session state so it's available at ghost first-connect time (store in module-level variable alongside the existing `_catalogGrants` pattern, or pass through the `ToolServices` layer)
- [ ] T021 [US2] Remove `_catalogGrants`, `CatalogResourceGrant`, `setCatalogGrants` from `server/world-api/src/mcp-server.ts`; remove the first-connect `ensureResourceType` + `commit` block that uses them
- [ ] T022 [US2] Add integration smoke-test note to `quickstart.md`: start server with `canonical.map.gram`, assert `ledger_verify` clean on first ghost connect

**Checkpoint**: Server starts with `canonical.map.gram`; no resource block errors; `ledger_verify` clean.

---

## Phase 5: US3 — Take and Drop Wire to Ledger (P1)

**Goal**: `take` and `drop` MCP tools commit ledger transfers; Colyseus state updates synchronously.

**Independent Test**: Ghost on tile T calls `take GoldCoin`; ledger records transfer `{ from: world@T, to: ghost, cause: "take" }`; `inventory` shows GoldCoin; `ledger_verify` clean.

- [ ] T023 [US3] Refactor `server/world-api/src/ItemService.ts`: add `LedgerService` dependency to `ItemServiceOps` (or inject via constructor); update `takeItem()` to call `ledger.commit({ transfers: [{ resource: itemRef, qty: 1, from: "world@{h3}", to: ghostId, location: { h3Index }, cause: "take" }] })` before updating in-memory arrays and calling Colyseus bridge; keep bridge calls synchronous after commit
- [ ] T024 [US3] Update `dropItem()` in `server/world-api/src/ItemService.ts`: call `ledger.commit({ transfers: [{ resource: itemRef, qty: 1, from: ghostId, to: "world@{h3}", location: { h3Index }, cause: "drop" }] })` after capacity pre-check; bridge calls synchronous after commit
- [ ] T025 [US3] Update `server/world-api/src/ItemService.test.ts`: inject mock `LedgerService` into `ItemServiceImpl`; assert `commit` called with correct transfer on `takeItem`; assert `commit` called with correct transfer on `dropItem`; assert bridge called synchronously after commit; assert `LedgerInsufficientFunds` propagates correctly from `takeItem`
- [ ] T026 [US3] Update Effect `Layer` wiring in `server/world-api/src/index.ts` or `mcp-server.ts`: ensure `ItemService` receives `LedgerService` via Layer injection (not global reference)
- [ ] T027 [US3] Update `takeEffect` and `dropEffect` in `server/world-api/src/mcp-server.ts`: capacity pre-check for `drop` stays in MCP handler; remove any direct ItemService in-memory mutation that now belongs in `ItemService.takeItem`/`dropItem`

**Checkpoint**: `pnpm test server/world-api` — ItemService tests pass with ledger assertions. Manual: take + drop leaves ledger balanced.

---

## Phase 6: US4 — Ghost-to-Ghost Item Trading (P1)

**Goal**: `offer`/`request`/`agree` operate on itemRefs; validation uses item sidecar not ledger resource registry.

**Independent Test**: Two ghosts on same tile; ghost A offers BrassKey for GoldCoin; ghost B agrees; ledger records two transfers; both inventories update.

- [ ] T028 [US4] In `server/world-api/src/ProposalService.ts`: replace `ledger.resourceTypes()` call (line 152) with `ItemService.getSidecar().has(resourceId)` check; add `ItemService` to `ProposalService` factory params or inject via Effect Layer
- [ ] T029 [US4] In `server/world-api/src/mcp-server.ts`: rename MCP tool schema fields `give_resource` → `give_item`, `for_resource` → `for_item` in `offer` tool; rename `want_resource` → `want_item`, `offering_resource` → `offering_item` in `request` tool; update `offerEffect` and `requestEffect` call sites accordingly
- [ ] T030 [US4] Update `server/world-api/src/EvalContractService.ts`: remove `LedgerMonotonicTradeRejected` from import and error union (already removed in T009, confirm no remaining references)
- [ ] T031 [US4] Verify `ProposalService` unit tests in `server/world-api` still pass with sidecar-based validation; update fixtures to use itemRef strings instead of ResourceType objects

**Checkpoint**: `pnpm test server/world-api` — ProposalService tests pass. `offer`/`agree` schema validates itemRefs against sidecar.

---

## Phase 7: US5 — Ghost Spawn Seeding by Role (P2)

**Goal**: Ghosts receive role-based item grants from `SpawnGrant` map declarations on first connect.

**Independent Test**: Map declares `SpawnGrant { role: "sponsor", GoldCoin: 5 }`; ghost with `agentCard.metadata.role: "sponsor"` connects; ledger records `Transfer { from: "world", to: ghost, cause: "spawn-grant", qty: 5 }`; ghost inventory shows 5 GoldCoin.

- [ ] T032 [US5] In `server/world-api/src/mcp-server.ts`: replace `_catalogGrants` first-connect block with spawn-grant lookup: read `role` from `agentCard.metadata.role` (default `"attendee"`); find matching `SpawnGrant` from session's parsed map; commit `{ from: "world", to: ghostId, resource: itemRef, qty, cause: "spawn-grant" }` per grant item; wrap in duplicate-tx catch (reconnect safety)
- [ ] T033 [US5] Add `SpawnGrant` syntax to `maps/sandbox/canonical.map.gram`: add a `[spawngrants:SpawnGrants | ...]` block with `attendee → { BrassKey: 1 }` as a demonstration grant
- [ ] T034 [US5] Add unit test in `server/world-api/src/agent-resource-grants.test.ts`: mock `SpawnGrant[{ role: "attendee", grants: [{ itemRef: "BrassKey", qty: 1 }] }]`; assert ledger commit called with correct spawn-grant transfer; assert insufficient world bag balance skips grant without blocking spawn

**Checkpoint**: `pnpm test server/world-api` — spawn grant tests pass. Ghost with matching role receives items on connect.

---

## Phase 8: US6 — Group Eval Contract Payout to Members (P2)

**Goal**: Eval contract payout distributes directly to member bags (not group bag); split is floor-divided with remainder to world.

**Independent Test**: Group of 2 ghosts accepts eval contract for 10 GoldCoin; funder resolves; each member receives 5 GoldCoin; ledger records two `eval-payout` transfers; group bag unchanged.

- [ ] T035 [US6] In `server/world-api/src/EvalContractService.ts`: add group payout path — when `contract.targetId` resolves to a group, read frozen member list stored at acceptance time; compute `share = floor(totalQty / memberCount)`; commit individual `ledger.commit({ transfers: [{ resource: itemRef, qty: share, from: "world", to: memberId, cause: "eval-payout" }] })` per member; commit remainder `(totalQty - share * memberCount)` back to `"world"` if > 0
- [ ] T036 [US6] In `server/world-api/src/EvalContractService.test.ts`: add group payout scenario — 2-member group, 10 GoldCoin reward; assert each member ledger transfer = 5; assert group bag not modified; add odd-remainder test (11 GoldCoin → 5 each + 1 to world)

**Checkpoint**: `pnpm test server/world-api` — EvalContractService group payout tests pass.

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Verification grep, documentation, type consolidation.

- [ ] T037 Run verification grep and confirm zero matches: `grep -r "LedgerMonotonicTradeRejected\|ResourceType\|ItemDefinition\|CatalogResourceGrant\|resources:Resources" server/ shared/ --include="*.ts"` (excluding `node_modules`, `dist`)
- [ ] T038 [P] Update `docs/mcp-tools.md`: revise `take`, `drop` schemas to show ledger commit; rename `give_resource`/`for_resource` → `give_item`/`for_item` in `offer`/`request` schemas
- [ ] T039 [P] Update `shared/map-gram/README.md`: document `qty` on item placements; document `SpawnGrant` gram syntax; note removal of `[resources:Resources]` block
- [ ] T040 [P] Add superseded-by note to `specs/022-in-world-resource-ledger/spec.md` pointing to this spec
- [ ] T041 Run `pnpm run build` from repo root — must pass cleanly (hard gate)
- [ ] T042 Run `pnpm test` in `shared/map-gram` and `server/world-api` — all tests pass
- [ ] T043 Manual smoke test per `specs/027-resource-lifecycle/quickstart.md`: start server, ghost takes item, `ledger_verify` returns clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all phases 3–8**
- **Phase 3–6 (P1 stories)**: All depend on Phase 2; can proceed in order or partially parallel
- **Phase 7–8 (P2 stories)**: Depend on Phase 2; Phase 7 depends on Phase 4 (spawn uses parsed map from session init); Phase 8 depends on Phase 5 (eval payout uses ledger commit)
- **Phase 9 (Polish)**: Depends on all story phases complete

### Story Dependencies

| Story | Depends On | Notes |
|---|---|---|
| US1 (qty parsing) | Phase 2 | Can start immediately after foundation |
| US2 (session init) | Phase 2, US1 | Needs qty in placements to seed correctly |
| US3 (take/drop) | Phase 2 | Independent of US1/US2 for unit tests; needs init for integration |
| US4 (trading) | Phase 2, US3 | ProposalService depends on ItemService sidecar |
| US5 (spawn grants) | US2 | Needs `spawnGrants` in session state |
| US6 (eval payout) | US3 | Payout uses ledger commit |

### Parallel Opportunities

Within Phase 2, these can run in parallel:
- T006 (remove ItemDefinition) + T006b (remove ResourceType) — different files
- T010 (LedgerServiceInMemory) + T011 (LedgerServiceLive) — different files
- T013 (map-gram tests) + T014 (world-api fixture updates) — different packages

Within Phase 9:
- T038 (mcp-tools.md) + T039 (map-gram README) + T040 (022 superseded note) — all parallel

---

## Implementation Strategy

### MVP (P1 stories only — Phases 1–6)

1. Phase 1: Setup + map file cleanup
2. Phase 2: Foundation (grammar, types, ledger interface) — **required before anything else**
3. Phase 3: qty parsing
4. Phase 4: session init seeding
5. Phase 5: take/drop → ledger
6. Phase 6: offer/request itemRef fields
7. Phase 9: verification + docs
8. **STOP and validate**: `pnpm run build` + `pnpm test` + smoke test

### Full Scope (add Phases 7–8)

After MVP validates:
- Phase 7: Spawn grants by role
- Phase 8: Group eval payout

---

## Notes

- `[P]` = different files, no incomplete-task dependencies, safe to parallelize
- `[USn]` label maps to user stories in `spec.md`
- Commit after each phase checkpoint
- The foundational phase (Phase 2) is the highest-risk phase — it touches 4 packages and breaks consumers until all type changes propagate. Work through it completely before testing.
- `redbluegreen.map.gram` movement costs are removed (out of scope for this branch); document in commit message that this is intentional deferral not deletion of the mechanic
