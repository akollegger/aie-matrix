# Implementation Plan: Resource Lifecycle

**Branch**: `027-resource-lifecycle` | **Date**: 2026-06-07 | **Spec**: `specs/027-resource-lifecycle/spec.md`  
**Input**: Feature specification from `/specs/027-resource-lifecycle/spec.md`

## Summary

Unify the parallel `ItemType` and `ResourceType` systems by making items the only resource abstraction. All item accounting moves into the existing Neo4j-backed `LedgerService`. `take`/`drop` MCP tools commit ledger transfers. `offer`/`request`/`agree` continue through `ProposalService` but now reference itemRefs instead of abstract resource IDs. The `[resources:Resources]` gram block, `ResourceType`, `ItemDefinition`, and `LedgerMonotonicTradeRejected` are removed. `ItemService` becomes a ledger projection that drives Colyseus broadcasts synchronously.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `neo4j-driver` v5, `@modelcontextprotocol/sdk` 1.29+, `@relateby/pattern` (gram AST), `zod` 3, `@colyseus/core` 0.15.57  
**Storage**: Neo4j (`LedgerEntry` chain, `LedgerHead` pointer); in-memory caches for bag balances and item positions  
**Testing**: `vitest` (unit); Neo4j integration tests (skipped when `NEO4J_URI` unset)  
**Target Platform**: Node.js server (world-api), shared packages consumed by colyseus and browser clients  
**Project Type**: Multi-package monorepo — `shared/map-gram`, `shared/types`, `server/colyseus`, `server/world-api`  
**Performance Goals**: Ledger commit p95 < 10ms (existing SC-008 benchmark retained)  
**Constraints**: Colyseus broadcast must fire synchronously in the same Effect fiber as ledger commit  
**Scale/Scope**: Single live session; ~100 concurrent ghosts; hundreds of item instances

## Constitution Check

- ✅ **Proposal linkage**: traces to RFC-0023 (`specs/022-in-world-resource-ledger/`) and supersedes its `ResourceType` declarations.
- ✅ **Boundary-preserving**: all changes stay within `shared/map-gram`, `shared/types`, `server/colyseus`, `server/world-api`. No new top-level directories.
- ✅ **Contract artifacts**: updated contracts in `specs/027-resource-lifecycle/contracts/` cover `ParsedItemPlacement`, `LedgerService`, `ItemService`, MCP tool schemas.
- ✅ **Verifiable increments**: each phase has independently testable unit-slice; `pnpm test` must pass after each phase.
- ✅ **Documentation**: `docs/mcp-tools.md`, `shared/map-gram/README.md`, `specs/022-in-world-resource-ledger/spec.md` enumerated in spec.

## Project Structure

### Documentation (this feature)

```text
specs/027-resource-lifecycle/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-001-parsed-item-placement.md
│   ├── ic-003-ledger-service.md
│   ├── ic-004-mcp-take-drop.md
│   └── ic-005-mcp-offer-request.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (packages touched)

```text
shared/map-gram/src/
├── types.ts             # ParsedItemPlacement + qty; SpawnGrant; remove ParsedResourceType
├── parse.ts             # qty parsing; SpawnGrant block; error on [resources:Resources]

shared/types/src/
├── items.ts             # Remove ItemDefinition; ItemTypeDef re-exported from map-gram
├── ledger.ts            # Remove ResourceType; CatalogResourceGrant becomes ItemGrant
├── index.ts             # Update re-exports

server/colyseus/src/
├── mapLoader.gram.ts    # itemSidecar built from ItemTypeDef; expand qty in initialItemRefs

server/world-api/src/
├── LedgerService.ts     # Remove init(ResourceType[]), resourceTypes(), ensureResourceType(); add init(ItemSeed[])
├── LedgerServiceInMemory.ts  # Remove ResourceType map, monotonic checks, LedgerMonotonicTradeRejected
├── LedgerServiceLive.ts      # Remove ResourceType Neo4j nodes, monotonic checks; LedgerEntry stores itemRef
├── ledger-errors.ts          # Remove LedgerMonotonicTradeRejected
├── ItemService.ts            # takeItem/dropItem call ledger.commit(); Colyseus bridge fires synchronously
├── ProposalService.ts        # Replace resourceTypes() lookup with ItemService.getSidecar() validation
├── mcp-server.ts             # take/drop wire through ItemService; offer/request rename fields; remove ensureResourceType call; spawn grants from map
├── mechanics.ts              # Remove monotonic mint helpers (or repurpose for eval payout)
├── agent-resource-grants.test.ts  # Update fixtures to use item-style grants
```

## Phase 0: Research

*All unknowns resolved from codebase. No external research required.*

### Finding 1 — Current spawn grant mechanism

`CatalogResourceGrant` in `mcp-server.ts` (line 66) seeds ghost bags from a per-agent-id map at first connect, using `ensureResourceType` + `ledger.commit`. This is the existing spawn path.

**Decision**: Replace `CatalogResourceGrant` with a map-level `SpawnGrant` keyed by role (from `agentCard.metadata.role`). The catalog grant map is removed; grants come from the parsed map at session init.

### Finding 2 — `resourceTypes()` in ProposalService

`ProposalService.ts` line 152 calls `ledger.resourceTypes()` to validate that both sides of a trade reference known resource types. This is the only consumer of `resourceTypes()` outside the ledger itself.

**Decision**: Replace with `ItemService.getSidecar().has(resourceId)` check. `LedgerService.resourceTypes()` and `ensureResourceType()` are removed.

### Finding 3 — `LedgerService.init()` seed format

`init(seed: ResourceType[])` currently takes a list of `ResourceType` objects (with `class`, `qty`, `floor`, `label`). The genesis transaction mints `qty` units into `"world"` for conserved types.

**Decision**: Change signature to `init(seed: ItemSeed[])` where `ItemSeed = { itemRef: string; qty: number; h3Index?: string }`. Each seed entry becomes a genesis transfer `{ from: "world.genesis", to: "world@{h3Index}" | "world", resource: itemRef, qty }`. Session init derives seeds by summing `ParsedItemPlacement.qty` per `(itemTypeName, h3Index)`.

### Finding 4 — `initialItemRefs` in LoadedMap

`mapLoader.gram.ts` populates `initialItemRefs: string[]` by listing each item type name once per cell (no qty expansion). Colyseus broadcasts these as the initial tile item list.

**Decision**: Change `initialItemRefs` to carry quantity by expanding: `["GoldCoin", "GoldCoin", "GoldCoin"]` for qty 3. This is the simplest change; no type signature change required. Alternatively, use `{ itemRef: string; qty: number }[]` — but that requires updating all consumers. Keep the flat array expansion for now; note as a potential future cleanup.

### Finding 5 — `mechanics.ts` monotonic helpers

`mechanics.ts` has helpers for monotonic minting (`awardXp`, etc.), guarded by a comment saying only authorised callers may mint. These are used for movement cost accounting and XP awards.

**Decision**: Delete these helpers entirely. Movement costs are out of scope. If eval payout needs a `world → ghost` transfer, it calls `ledger.commit()` directly with `cause: "eval-payout"` — no special minting path needed.

### Finding 6 — `EvalContractService` and group payout

`EvalContractService.ts` imports `LedgerMonotonicTradeRejected` (line 15) and includes it in a union type (line 26). Payout currently goes to the contract creator's bag, not group members.

**Decision**: Remove `LedgerMonotonicTradeRejected` from the union. Add group payout path: when contract target is a group, read frozen member list at acceptance time, split payout floor-divided, commit individual `eval-payout` transfers.

## Phase 1: Design & Contracts

### Data Model

See `data-model.md` (generated below).

### Interface Contracts

**IC-001 — `ParsedItemPlacement`** (`shared/map-gram`):
```typescript
interface ParsedItemPlacement {
  h3Index: string;
  itemRef: string;          // renamed from itemTypeName
  layerIdentity: string;
  qty: number;              // new; default 1
}
```
Consumers: `mapLoader.gram.ts` (colyseus), session init (world-api), Neo4j seeder.

**IC-003 — `LedgerService` interface changes**:
```typescript
// REMOVED: init(seed: ResourceType[])
// REPLACED WITH:
init(seed: ItemSeed[]): Effect.Effect<void, LedgerPersistenceError>

// REMOVED: resourceTypes(): Effect.Effect<ResourceType[]>
// REMOVED: ensureResourceType(rt: ResourceType): Effect.Effect<void, LedgerPersistenceError>

// commit() signature UNCHANGED
// bag() signature UNCHANGED
// verify() signature UNCHANGED

interface ItemSeed {
  itemRef: string;
  qty: number;
  h3Index?: string;  // present → "world@{h3Index}"; absent → "world"
}
```

**IC-004 — MCP `take` tool** (updated):
```
take(itemRef: string) → commits ledger Transfer { from: world@{h3}, to: ghost, cause: "take" }
Errors: WorldApiItemNotFound, WorldApiItemNotHere, WorldApiItemNotCarriable, LedgerInsufficientFunds
```

**IC-004 — MCP `drop` tool** (updated):
```
drop(itemRef: string) → MCP layer checks capacity, then commits Transfer { from: ghost, to: world@{h3}, cause: "drop" }
Errors: WorldApiItemNotCarrying, WorldApiTileFull, LedgerInsufficientFunds
```

**IC-005 — MCP `offer` / `request` tools** (field rename):
```
offer(to, give_item, give_qty, for_item, for_qty)   // was give_resource / for_resource
request(from, want_item, want_qty, offering_item, offering_qty)
```

### Quickstart

See `quickstart.md` (generated below).

## Implementation Sequence

The changes form a dependency chain. Work bottom-up: grammar → types → ledger → ItemService → MCP tools → session init.

### Step 1 — `shared/map-gram`: grammar + type changes
- Add `qty?: number` to `ParsedItemPlacement`; rename `itemTypeName` → `itemRef`
- Parse `qty` from gram node property (use existing `intProp` helper; default 1)
- Error on `[resources:Resources]` block presence (parse-time `MapGramParseError`)
- Add `SpawnGrant` type and parse `[spawngrants:SpawnGrants | ...]` block
- Remove `ParsedResourceType` and `resourceTypes` from `ParsedMap`
- **Tests**: update existing item placement parse tests; add qty test; add SpawnGrant parse test; add error test for `[resources:Resources]`

### Step 2 — `shared/types`: remove `ItemDefinition` and `ResourceType`
- Remove `ItemDefinition` from `items.ts` (consumers switch to `ItemTypeDef` from map-gram)
- Remove `ResourceType` from `ledger.ts`
- Remove `CatalogResourceGrant` (replaced by map-level `SpawnGrant`)
- Update `index.ts` re-exports
- **Note**: this step will break callers — fix forward in subsequent steps

### Step 3 — `server/colyseus`: update `mapLoader.gram.ts`
- Import `ItemTypeDef` from `@aie-matrix/map-gram` instead of `ItemDefinition` from shared-types
- `itemSidecar` type becomes `Map<string, ItemTypeDef>`
- Expand `qty` in `initialItemRefs`: for each placement with qty N, push itemRef N times
- Update `LoadedMap` type accordingly

### Step 4 — `server/world-api`: `LedgerService` interface + implementations
- Remove `ResourceType`, `resourceTypes()`, `ensureResourceType()` from `LedgerService.ts` interface
- Remove `LedgerMonotonicTradeRejected` from `ledger-errors.ts` and all union types
- Change `init()` to accept `ItemSeed[]`; genesis transaction mints to `world@{h3Index}` or `world`
- **InMemory**: remove `resourceTypes` Map; remove monotonic checks; remove `LedgerUnknownResource` lookup by resource type (validation replaced by sidecar check upstream); simplify conservation check (all resources are conserved)
- **Live**: remove `ResourceType` Neo4j node write; update genesis Cypher to use `ItemSeed`; remove monotonic checks
- Delete `mechanics.ts` monotonic helpers (or the whole file if empty after removal)
- **Tests**: update `LedgerService.bench.ts` and unit tests to use `ItemSeed`

### Step 5 — `server/world-api`: `ItemService` wired to ledger
- `takeItem()`: after validation, call `ledger.commit({ transfers: [{ resource: itemRef, qty: 1, from: "world@{h3}", to: ghostId, location: { h3Index }, cause: "take" }] })`; on success update in-memory arrays and call `bridge.setTileItems()` / `bridge.setGhostInventory()` synchronously
- `dropItem()`: capacity check stays in MCP handler (no change); `dropItem()` calls `ledger.commit(...)` then updates Colyseus
- `ItemService` now depends on `LedgerService` — add to `Context.Tag` requirements
- **Tests**: update `ItemService.test.ts` to inject a mock `LedgerService`; assert ledger commit called on take/drop

### Step 6 — `server/world-api`: `ProposalService` validation
- Replace `ledger.resourceTypes()` call (line 152) with `itemSidecar.has(resourceId)` check
- Pass sidecar into `ProposalService` factory or inject `ItemService` as dependency

### Step 7 — `server/world-api`: MCP tool schema updates
- Rename `give_resource`/`for_resource` → `give_item`/`for_item` in `offer` tool schema
- Rename `want_resource`/`offering_resource` → `want_item`/`offering_item` in `request` tool schema
- `take`/`drop` handlers: remove direct ItemService mutation (now handled inside ItemService); keep MCP-layer capacity pre-check for drop
- Remove `ensureResourceType` call from first-connect seeding block
- Remove `CatalogResourceGrant` and `_catalogGrants` module-level state

### Step 8 — `server/world-api`: spawn grants from map
- At session init, read `parsedMap.spawnGrants`
- On ghost first-connect (existing first-connect block), lookup `agentCard.metadata.role` (default `"attendee"`)
- Find matching `SpawnGrant`; commit `ledger.commit({ transfers: [{ resource: itemRef, qty, from: "world", to: ghostId, cause: "spawn-grant" }] })` for each grant item
- Guard with duplicate-tx catch (reconnect safety, same pattern as current seeding)
- **Tests**: unit test spawn grant transfer with InMemory ledger

### Step 9 — `server/world-api`: group eval contract payout
- In `EvalContractService`: remove `LedgerMonotonicTradeRejected` from error union
- Add group payout path: when `contract.targetId` is a group, read frozen member list
- Commit `floor(totalQty / memberCount)` to each member; remainder → `"world"`
- **Tests**: extend `EvalContractService.test.ts` with group payout scenario

### Step 10 — Documentation
- `docs/mcp-tools.md`: update `take`, `drop`, `offer`, `request` schemas
- `shared/map-gram/README.md`: document `qty` on item placements; note removal of `[resources:Resources]`; document `SpawnGrant` syntax
- `specs/022-in-world-resource-ledger/spec.md`: add superseded-by note

## Complexity Tracking

*No Constitution violations requiring justification.*

## Verification

After all steps, the following must pass:

1. `pnpm run build` from repo root — no TypeScript errors
2. `pnpm test` in `shared/map-gram` — qty parsing, SpawnGrant parsing, error on resources block
3. `pnpm test` in `server/world-api` — ItemService take/drop commit to ledger; spawn grant transfer; group eval payout; `LedgerMonotonicTradeRejected` absent
4. `grep -r "LedgerMonotonicTradeRejected\|ResourceType\|ItemDefinition\|resources:Resources" server/ shared/ --include="*.ts"` returns zero matches
5. Manual: start server with a map containing item placements; ghost takes an item; ledger verify returns clean
