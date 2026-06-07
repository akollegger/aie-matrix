# Feature Specification: Resource Lifecycle

**Feature Branch**: `027-resource-lifecycle`  
**Created**: 2026-06-06  
**Revised**: 2026-06-07  
**Status**: Draft  
**Input**: Unify the parallel ItemType and ResourceType systems; items are the only resource

## Clarifications

### Session 2026-06-07

- Q: How should the unlocated world pool (used for spawn grants) be identified as a ledger actor? → A: `"world"` — bare string, no suffix
- Q: Should `itemRef` and `itemRef` be unified to a single term? → A: Unify on `itemRef` everywhere (gram parse context, runtime, MCP tools)
- Q: Should Colyseus broadcast updates trigger synchronously or via async subscription after a ledger commit? → A: Synchronous — ledger commit calls Colyseus bridge directly in the same Effect fiber
- Q: Where should tile capacity checks for `drop` live? → A: MCP layer — checked before `ledger.commit()` is called; ledger never sees a rejected drop
- Q: Is in-memory ledger sufficient for MVP, or must it be Neo4j-backed? → A: Neo4j-backed (`LedgerServiceLive`) — every transfer persisted immediately; in-memory implementation retained for tests only

## Proposal Context *(mandatory)*

- **Related Proposal**: RFC-0023 (In-World Resource Ledger, `specs/022-in-world-resource-ledger/`)
- **Scope Boundary**: Eliminating `ResourceType` / `[resources:Resources]` from map grammar; adding `qty` to `ItemPlacement`; wiring `take`/`drop` to ledger commits; making `offer`/`request`/`agree` operate on item types; role-based spawn grants; group eval contract payout to member bags
- **Out of Scope**: Movement costs; world-bag redistribution; source/dispenser items; monotonic resources; container objects; new UI for map authoring; multi-session resource carry-over

## Background

The world had two parallel, unconnected accounting systems:

1. **ItemService** — tracks which item types are on which tiles and in which ghost inventories, as in-memory arrays of itemRef strings. `take`/`drop` mutate this state directly; no ledger involvement.
2. **LedgerService** — tracks balances of abstract `ResourceType` entities declared in a separate `[resources:Resources]` block in the gram file. `offer`/`request`/`agree` flow through this. Not connected to physical items.

This made ghost-to-ghost item trading impossible: `offer` speaks resources, not items. It also forced map authors to declare quantities twice — once as item placements and again as a resource seed — with no enforcement that they agreed.

**The unification**: an item type *is* a resource. The itemRef string becomes the resourceId. All item accounting moves into the ledger. `ItemService` becomes a read-through projection over ledger state for Colyseus broadcasts; it no longer owns state. The `[resources:Resources]` block and `ResourceType` are removed from the grammar entirely.

A secondary cleanup: `ItemTypeDef` (parse-time) and `ItemDefinition` (runtime) are parallel type definitions for the same data. This branch collapses them into a single canonical type.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Map Authoring: Place Items with Quantity (Priority: P1)

A map author places 10 GoldCoin items on a single tile with one placement declaration.

**Acceptance Scenarios**:

1. **Given** `(:Item:GoldCoin { geometry: [h3\`…\`], qty: 10 })`, **When** the map is parsed, **Then** 10 GoldCoin units are attributed to that tile in the world bag seed.
2. **Given** GoldCoin placements on three tiles (qty 5, 3, 2), **When** the session initialises, **Then** the world bag holds exactly 10 GoldCoin distributed across those tiles.
3. **Given** a placement with no `qty`, **When** parsed, **Then** `qty` defaults to 1 (backward-compatible).

---

### User Story 2 — Session Init: World Bag Seeded from Placements (Priority: P1)

On session start, the ledger world bag is populated from item placements — no separate seed declaration required.

**Acceptance Scenarios**:

1. **Given** a map with only item placements (no `[resources:Resources]` block), **When** the session initialises, **Then** the ledger world bag reflects the exact placement totals.
2. **Given** a map with a `[resources:Resources]` block, **When** parsed, **Then** a parse error is raised — the block is no longer valid syntax.

---

### User Story 3 — Take and Drop Wire to Ledger (Priority: P1)

`take` and `drop` are recorded as ledger transfers, making them auditable and consistent with `offer`/`agree`.

**Acceptance Scenarios**:

1. **Given** a GoldCoin on tile T and a ghost on tile T, **When** the ghost calls `take`, **Then** the ledger records `Transfer { resource: GoldCoin, qty: 1, from: world@T, to: ghost, cause: "take" }` and both bags update.
2. **Given** a ghost holding a GoldCoin on tile T, **When** the ghost calls `drop`, **Then** the ledger records the reverse transfer with `cause: "drop"`.
3. **Given** an ItemType with `takeable: false`, **When** a ghost attempts `take`, **Then** the action is rejected with a clear error.
4. **Given** a ghost with no GoldCoin in bag, **When** the ghost attempts `drop GoldCoin`, **Then** the action is rejected (`LedgerInsufficientFunds`).
5. **Given** two ghosts simultaneously attempting to take the last unit of a resource on a tile, **Then** the ledger commit rejects the second with `LedgerInsufficientFunds`.

---

### User Story 4 — Ghost-to-Ghost Item Trading (Priority: P1)

Ghosts can trade items using the existing `offer`/`request`/`agree`/`decline` commands, with itemRef as the resource identifier.

**Acceptance Scenarios**:

1. **Given** ghost A holds a BrassKey and ghost B holds a GoldCoin, both on the same tile, **When** ghost A calls `offer { to: B, give_item: BrassKey, give_qty: 1, for_item: GoldCoin, for_qty: 1 }`, **Then** a proposal is created and ghost B receives a notification.
2. **Given** a pending proposal, **When** ghost B calls `agree`, **Then** the ledger records two transfers atomically and both inventories update.
3. **Given** a pending proposal, **When** either party calls `decline`, **Then** the proposal is cancelled and no ledger transfer occurs.
4. **Given** a ghost attempting to offer an item they do not hold, **When** `agree` is called, **Then** the commit fails with `LedgerInsufficientFunds`.

---

### User Story 5 — Ghost Spawn Seeding by Role (Priority: P2)

When a ghost spawns, it receives a role-specific item grant drawn from the world bag.

**Acceptance Scenarios**:

1. **Given** a map grant `sponsor → { GoldCoin: 5 }` and a ghost whose agent card declares `role: sponsor`, **When** the ghost spawns, **Then** the ledger records a transfer from `world` to the ghost bag for 5 GoldCoin with `cause: "spawn-grant"`.
2. **Given** a ghost with no `role` field in its agent card, **When** the ghost spawns, **Then** the ghost is treated as `attendee`.
3. **Given** insufficient world bag balance to fulfil a role grant, **When** the ghost spawns, **Then** spawn proceeds; the grant is skipped with a logged warning — spawn is never blocked.
4. **Given** a role with no grant declared in the map, **When** the ghost spawns, **Then** the ghost bag starts empty with no error.

---

### User Story 6 — Group Eval Contract Payout to Members (Priority: P2)

When a group resolves an eval contract, the payout transfers directly to individual member bags.

**Acceptance Scenarios**:

1. **Given** a group of two ghosts and an eval contract awarding 10 GoldCoin on success, **When** the funder resolves the contract, **Then** individual transfers from the funder to each member bag are recorded — the group bag is not involved.
2. **Given** an equal-split contract, **Then** each member receives `floor(total / memberCount)`; any remainder returns to the world bag.
3. **Given** members frozen at contract acceptance, **Then** payout goes only to those members — ghosts who joined after acceptance receive nothing from this contract.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `ParsedItemPlacement` MUST support an optional integer `qty` field; absence defaults to 1.
- **FR-002**: The `[resources:Resources]` block MUST be removed from `.map.gram` grammar; its presence MUST raise a parse error.
- **FR-003**: Session initialisation MUST seed the ledger world bag by summing placement `qty` values per item type per tile.
- **FR-004**: `take` MUST validate: item type is `takeable`, ghost is co-located with the item, sufficient world bag balance exists at that tile. On success it MUST commit a ledger transfer `{ from: world@{h3Index}, to: ghost, cause: "take" }`.
- **FR-005**: `drop` MUST validate at the MCP layer (before calling `ledger.commit()`): ghost holds the item, target tile has sufficient capacity. The ledger is only invoked on success; it never sees a rejected drop. On success it MUST commit a ledger transfer `{ from: ghost, to: world@{h3Index}, cause: "drop" }`.
- **FR-006**: `offer` and `request` MUST accept itemRef strings as resource identifiers. Field names in the MCP tool schema are renamed to `give_item`/`for_item`.
- **FR-007**: `LedgerMonotonicTradeRejected` and all conserved/monotonic distinctions MUST be removed from the ledger and all dependent code.
- **FR-008**: The map MUST support a spawn-grant block keyed by role name, specifying item quantities transferred from the world bag to the ghost bag at spawn time.
- **FR-009**: At spawn, world-api MUST read `role` from the ghost's A2A agent card metadata; absent defaults to `attendee`. Role is accepted without validation (honor system).
- **FR-010**: If world bag balance is insufficient for a spawn grant, spawn MUST proceed; the grant is skipped with a logged warning.
- **FR-011**: All `take`, `drop`, `spawn-grant`, and eval payout events MUST be recorded as ledger transactions with the appropriate `cause` label.
- **FR-012**: `Transfer.location` (`{ h3Index }`) MUST be set on all `take` and `drop` transfers.
- **FR-013**: An eval contract targeting a group MUST record member IDs at acceptance time; payout MUST go directly to member bags, not the group bag.
- **FR-014**: `ItemTypeDef` (parse-time, map-gram) and `ItemDefinition` (runtime, shared-types) MUST be collapsed into a single canonical type. `ItemDefinition` in shared-types is removed; `ItemTypeDef` from map-gram is the authoritative definition.
- **FR-016**: The production ledger MUST use `LedgerServiceLive` (Neo4j-backed). Every `take`, `drop`, `offer`/`agree`, `spawn-grant`, and `eval-payout` transfer MUST be persisted as a `LedgerEntry` node before the MCP tool returns. `LedgerServiceInMemory` is retained for unit tests only.
- **FR-015**: `ItemService` MUST be refactored to derive its state from the ledger rather than maintaining independent in-memory arrays. On each ledger commit, the Colyseus bridge MUST be called synchronously in the same Effect fiber — no async subscription or deferred reconciliation.

### Key Entities

- **ItemTypeDef** (canonical): `{ identity, typeName, name, description?, glyph?, takeable?, capacityCost? }`. `ItemDefinition` from shared-types is removed.
- **ParsedItemPlacement** (extended): adds `qty: number` (default 1).
- **SpawnGrant**: map-level declaration — `{ role: string, grants: { itemRef: string, qty: number }[] }[]`.
- **Transfer** `cause` values for this branch: `"take"`, `"drop"`, `"spawn-grant"`, `"eval-payout"`.
- **Actor ID conventions**: tile-located world pool = `"world@{h3Index}"`; unlocated world pool (spawn grants, eval payout source) = `"world"`; ghost = `"ghost:{ghostId}"`.

### Interface Contracts

- **IC-001**: `ParsedItemPlacement` in `@aie-matrix/map-gram` adds `qty?: number`; consumers treat absence as 1.
- **IC-002**: `Transfer.location` (`{ h3Index: string }`) MUST be set on all `take` and `drop` transfers.
- **IC-003**: `LedgerService.commit()` interface is unchanged; item context is carried inside the `Transfer` object.
- **IC-004**: MCP tools `take` and `drop` schemas are updated to commit ledger transfers; documented in `docs/mcp-tools.md`.
- **IC-005**: MCP tools `offer` and `request` schemas updated to use `give_item`/`for_item` field names accepting itemRef strings.
- **IC-006**: World-api spawn logic reads `agentCard.metadata.role` (string, optional); the A2A agent card schema is not modified.

## Success Criteria *(mandatory)*

- **SC-001**: A map with no `[resources:Resources]` block parses and seeds the world bag correctly from item placements alone.
- **SC-002**: A ghost picking up and dropping an item produces a balanced ledger — ghost bag plus world bag always equals the seeded total for that item type.
- **SC-003**: Two ghosts on the same tile can complete an `offer`/`agree` item trade; the ledger records both transfers atomically.
- **SC-004**: All item movements (take, drop, spawn-grant, eval-payout) are recorded as ledger transactions; zero item movements occur outside the ledger.
- **SC-005**: `LedgerMonotonicTradeRejected` does not appear anywhere in the codebase after this branch merges.

## Assumptions

- All items are fungible within their type (quantity matters, not instance identity). Non-fungible unique items are modelled as an item type with total `qty: 1` across all placements.
- Items are not preserved across sessions; ghost bags are zeroed at session end. Conservation is a within-session invariant only. The ledger chain (Neo4j `LedgerEntry` nodes) is retained after session end for audit purposes.
- The group bag holds only the resource type used as membership escrow and is not affected by eval contract payouts.
- Tile capacity rules continue to be enforced at the MCP layer, not inside the ledger.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update resource model section
- `docs/mcp-tools.md` — update `take`, `drop`, `offer`, `request` schemas
- `shared/map-gram/README.md` — document `qty` on item placements; note removal of `[resources:Resources]`
- `specs/022-in-world-resource-ledger/spec.md` — note superseding decisions from this spec
