# Feature Specification: Resource Lifecycle

**Feature Branch**: `027-resource-lifecycle`  
**Created**: 2026-06-06  
**Status**: Draft  
**Input**: Address gaps and misalignment in resource creation and management

## Proposal Context *(mandatory)*

- **Related Proposal**: RFC-0022 (In-World Resource Ledger, `specs/022-in-world-resource-ledger/`)
- **Scope Boundary**: Unifying ItemType/item-placement with the ledger resource model; deriving world-bag seed from map placements; ghost spawn seeding; world bag return-to-play mechanics; quantity syntax on item placements; source items that generate resource units at a fixed tile location
- **Out of Scope**: New UI for map authoring; changes to leaderboard or eval contract payoff rules; multi-session resource carry-over

## Background

The current design has two parallel, unconnected systems:

1. **Map Items** — `ItemTypeDef` / `ParsedItemPlacement` declare physical objects at H3 cells. A `takeable` flag exists but is not wired to any transaction.
2. **Ledger Resources** — `ResourceType` (conserved / monotonic) declared in a separate `[resources:Resources | …]` block in the `.map.gram` file; seed `qty` is a manually-entered number.

The design insight that resolves this: **a takeable ItemType is a conserved ResourceType**, distinguished only by how specific its type identity is and how many units are seeded. Placing items on a map is the spatial expression of seeding those units into the world bag. Picking an item up is a ledger transfer from `world@{h3Index}` to the ghost's bag; dropping it is the reverse. The ledger `Transfer.location` field already anticipates this; it just isn't wired.

Additionally, the world bag currently acts as a pure sink — resources paid to it (e.g. movement costs) have no return path to play.

A third gap: there is no way to model resource *generation* at a fixed map location. A water fountain, an ore vein, or an XP shrine should be expressible as an ItemType that produces units of another resource on a timer. This gives the map geographic structure — ghosts must travel to sources — rather than relying on a global world-drip that scatters resources randomly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Map Authoring: Place Items with Quantity (Priority: P1)

A map author places 10 GoldCoin items on a single tile by specifying a quantity, rather than duplicating 10 separate placement nodes.

**Why this priority**: Quantity-on-placement is the foundation for all downstream resource seeding; without it, authors cannot sanely declare conserved resource pools.

**Independent Test**: Parse a `.map.gram` file containing an item placement with an explicit `qty` field; confirm the parser produces the correct total count and that no separate `[resources:Resources]` seed declaration is required.

**Acceptance Scenarios**:

1. **Given** a `.map.gram` with `(:Item:GoldCoin { geometry: [h3\`…\`], qty: 10 })`, **When** the map is parsed, **Then** 10 GoldCoin units are attributed to that H3 cell in the world bag seed.
2. **Given** GoldCoin placements on three different tiles (qty 5, 3, 2), **When** the session initialises, **Then** the world bag holds exactly 10 GoldCoin units distributed across those cells.
3. **Given** a placement with no `qty` field, **When** parsed, **Then** `qty` defaults to 1 (backward-compatible).

> **Map designer note**: The attendee spawn grant for any movement-cost resource SHOULD be sized to guarantee the ghost can reach at least one source or pickup tile from any spawn point. A grant smaller than the minimum path cost to the nearest refill point will strand newly-spawned ghosts.

---

### User Story 2 — Session Init: World Bag Seeded from Placements (Priority: P1)

On session start, the ledger world bag is populated by summing item placements from the map, not from a manually declared `qty` on a separate `ResourceType` block.

**Why this priority**: Eliminates the sync problem between placement counts and declared seed quantities — there should be one source of truth.

**Independent Test**: Start a session from a map with only item placement declarations (no explicit `[resources:Resources]` block for those item types); confirm the ledger world bag reflects the exact placement totals.

**Acceptance Scenarios**:

1. **Given** a map with 10 GoldCoin placements and no explicit resource declaration, **When** the session initialises, **Then** the world bag contains 10 GoldCoin units.
2. **Given** a conserved resource declared in `[resources:Resources]` with no corresponding item placements (e.g. an abstract "XP" counter), **When** the session initialises, **Then** the declared `qty` is still honoured (non-spatial resources remain valid).
3. **Given** both a placement-derived count and an explicit declaration for the same resource id, **When** parsed, **Then** an authoring error is reported (no silent double-counting).

---

### User Story 3 — Ghost Spawn Seeding by Role (Priority: P2)

When a ghost spawns, it receives a role-specific resource grant drawn from the world bag. The ghost's role is read from a `role` field in its A2A agent card metadata. The map declares spawn grants per role; if no role is present the ghost is treated as an attendee.

**Why this priority**: Different participant classes (attendee, vendor, sponsor) warrant different starting resources — a vendor needs inventory, a sponsor needs currency to award. A flat grant for all ghosts cannot express this. Role from the agent card avoids hardcoding agent IDs in the map while keeping the implementation lightweight.

**Independent Test**: Register two agents — one with `role: attendee`, one with `role: sponsor`; declare role grants in the map (`attendee → { Water: 2 }`, `sponsor → { Water: 10, GoldCoin: 5 }`); spawn both; confirm each ghost bag matches its role grant and the world bag debits the correct totals.

**Acceptance Scenarios**:

1. **Given** a ghost whose agent card declares `role: sponsor` and a map grant `sponsor → { GoldCoin: 5 }`, **When** the ghost spawns, **Then** the ledger records a transfer from `world` to the ghost bag for 5 GoldCoin with cause `spawn-grant`.
2. **Given** a ghost whose agent card declares `role: attendee` and a map grant `attendee → { Water: 2 }`, **When** the ghost spawns, **Then** the ghost bag receives 2 Water from the world bag.
3. **Given** a ghost whose agent card has no `role` field, **When** the ghost spawns, **Then** the ghost is treated as `attendee` and receives the attendee grant (if declared).
4. **Given** a ghost with a role that has no grant declared in the map, **When** the ghost spawns, **Then** the ghost bag starts empty — no error, no warning.
5. **Given** insufficient world bag balance to fulfil a role grant, **When** the ghost spawns, **Then** spawn proceeds; the grant is skipped with a logged warning — spawn is never blocked by an underfunded grant.
6. **Given** a ghost claiming `role: sponsor` with no external validation, **When** the ghost spawns, **Then** the declared role is accepted as-is (honor system; closed participation means no role forgery risk).

---

### User Story 4 — Item Pickup and Drop (Priority: P1)

A ghost can pick up a takeable item from a tile, recording a ledger transfer from the world bag at that location to the ghost's bag; and can drop an item, recording the reverse transfer.

**Why this priority**: This is the primary gameplay interaction that unifies the two parallel systems.

**Independent Test**: Place a GoldCoin on a tile; have a ghost on that tile pick it up; confirm: the ghost bag balance increases by 1, the world bag balance decreases by 1, and a ledger entry exists with `location: { h3Index }`.

**Acceptance Scenarios**:

1. **Given** a GoldCoin on tile T and a ghost on tile T, **When** the ghost picks it up, **Then** the ledger records `Transfer { resource: GoldCoin, qty: 1, from: world, to: ghost, location: { h3Index: T } }` and both bags update.
2. **Given** a ghost holding a GoldCoin on tile T, **When** the ghost drops it, **Then** the ledger records the reverse transfer and the item reappears at tile T.
3. **Given** an ItemType with `takeable: false`, **When** a ghost attempts pickup, **Then** the action is rejected with a clear error.
4. **Given** a ghost with no GoldCoin in its bag, **When** it attempts to drop one, **Then** the action is rejected (insufficient funds, standard ledger rule).
5. **Given** a ghost whose conserved resource bag balance is at the declared ceiling, **When** the ghost attempts to pick up one more unit of that resource, **Then** the pickup is rejected with a capacity error — the ghost must drop or spend before acquiring more.
6. **Given** a ghost whose monotonic resource balance (e.g. XP) is at any value, **When** a new XP unit is awarded, **Then** there is no ceiling check — monotonic resources accumulate without limit.
7. **Given** an `offer` with `for_qty: 0` (a gift with no return resource), **When** the counterparty calls `agree`, **Then** the ledger records only the give-side transfer and the transaction commits successfully — zero-quantity legs are permitted.

---

### User Story 5 — World Bag Return-to-Play (Priority: P2)

Resources paid into the world bag (e.g. movement costs) can re-enter play via defined redistribution rules, rather than being permanently burned.

**Why this priority**: Without return paths, conserved resources drain to zero and gameplay degrades over time.

**Independent Test**: Configure a redistribution rule that returns 50% of world bag GoldCoin holdings to random map tiles every N seconds; run the session for 2N seconds; confirm item counts on tiles increase and world bag decreases accordingly.

**Acceptance Scenarios**:

1. **Given** a world bag holding 10 GoldCoin units and a redistribution rule "drip 1 GoldCoin to a random passable tile every 60 seconds", **When** 60 seconds elapse, **Then** the ledger records a transfer from `world` to `world@{h3Index}` and a new item appears at that tile.
2. **Given** an eval contract award that pays from the world bag to a ghost, **When** the contract resolves, **Then** the payout reduces the world bag and increases the ghost bag (existing mechanic, confirmed still correct).
3. **Given** a world bag at zero for a given resource, **When** a redistribution tick fires, **Then** no transfer is recorded and no error is raised.
4. **Given** a session running for 30 minutes with active movement costs and source items ticking, **When** the world bag for a conserved resource is checked at regular intervals, **Then** its balance never reaches zero — source tick rate is validated against the configured consumption rate at session start and a warning is logged if the budget is unsustainable.

---

### User Story 6 — Source Items Generate Resources at a Location (Priority: P2)

A map author designates an ItemType (e.g. WaterFountain) as a source for another resource type (e.g. Water). The fountain, placed on a specific tile, periodically makes Water units available at that tile, creating a geographic draw that rewards ghosts who travel to it.

**Why this priority**: Sources give spatial structure to resource flow — they are the canonical return-to-play mechanism for conserved resources and the primary mint for monotonic ones. A global world-drip is a fallback; sources are the designed experience.

**Independent Test**: Place one WaterFountain (source: `{ resourceId: Water, ratePerTick: 1, intervalSecs: 30 }`) on a tile; after 30 seconds, confirm a ledger transfer from `world` to `world@{fountainH3}` has occurred and a Water unit is available at that tile for pickup.

**Acceptance Scenarios**:

1. **Given** a WaterFountain (source of Water, conserved) on tile T, **When** one tick interval elapses, **Then** the ledger records a transfer `{ from: world, to: world@T, resource: Water, qty: 1, cause: "source-tick" }` — pulling from the undifferentiated world bag.
2. **Given** a WaterFountain (source of Water, conserved) and the world bag holding 0 Water, **When** a tick fires, **Then** no transfer is recorded and no error is raised (source cannot produce what doesn't exist).
3. **Given** an XPShrine (source of XP, monotonic) on tile T, **When** one tick elapses, **Then** the ledger records a new mint transfer `{ from: world, to: world@T, resource: XP, qty: ratePerTick, cause: "source-tick" }` — monotonic sources create new units unconditionally.
4. **Given** a ghost on the same tile as an active WaterFountain, **When** the ghost picks up Water, **Then** the pickup follows the standard `takeable` item transfer path (source and pickup are independent events).
5. **Given** a source ItemType that is also `takeable: true` (a portable lantern that produces light), **When** a ghost picks it up, **Then** the source stops ticking at its original tile and no new ticks fire until it is dropped back onto a tile.

---

### User Story 7 — Admin World-Bag Offer (Priority: P2)

An admin can call `offer` using the world bag as the initiator, targeting any ghost regardless of location. This lets admins reward ghosts directly — a prize, a grant, a consolation — without needing a ghost-to-ghost trade and without proximity constraints.

**Why this priority**: Admins need a direct, flexible mechanism to inject world bag resources into play for event moments (prizes, corrections, spot rewards). The existing `offer`/`agree` flow already handles the commit and counterparty consent; this just relaxes who can initiate and removes proximity.

**Independent Test**: Admin calls `offer` targeting a ghost on a different tile; the proposal is created with `initiatorId: "world"`; the ghost calls `agree`; the ledger records a transfer from `world` to the ghost bag with no proximity check performed.

**Acceptance Scenarios**:

1. **Given** an admin session and a ghost on any tile, **When** the admin calls `offer { to: ghostId, give_resource: Water, give_qty: 5, for_resource: …, for_qty: … }`, **Then** a proposal is created with `initiatorId: "world"` and no proximity check is performed.
2. **Given** a world-bag offer and the target ghost calls `agree`, **When** the proposal commits, **Then** the ledger records `Transfer { from: world, to: ghost, resource: Water, qty: 5, cause: "trade" }` and the world bag debits accordingly.
3. **Given** the world bag holds insufficient balance for the offered resource, **When** the admin calls `offer`, **Then** the proposal is rejected immediately with `LedgerInsufficientFunds` — no pending proposal is created.
4. **Given** a world-bag offer with a non-zero `for_resource` / `for_qty`, **When** the ghost calls `agree`, **Then** the ghost's give-side transfers normally to the world bag (world receives the return resource).
5. **Given** a regular ghost (non-admin) attempting to set `initiatorId: "world"`, **When** the call is made, **Then** it is rejected with an auth error — only admin sessions may offer from the world bag.

---

### User Story 8 — Group Eval Contract Payout to Members (Priority: P2)

When a group accepts an eval contract and the funder agent resolves it, the payout transfers directly to individual member bags — not to the group bag. The group bag holds only membership-escrow resources and cannot receive or hold arbitrary resource types.

**Why this priority**: Clarifies the group bag's role as an escrow of commitment rather than a shared wallet, and ensures payout flows are auditable per-member rather than pooled and undistributed.

**Independent Test**: Form a group of two ghosts; have the group accept an eval contract with a GoldCoin reward; resolve the contract; confirm GoldCoin transfers appear in each member's individual ledger with the split declared by the contract, and the group bag balance is unchanged.

**Acceptance Scenarios**:

1. **Given** a group of two ghosts and an eval contract that awards 10 GoldCoin to the group on success, **When** the funder agent resolves the contract, **Then** the ledger records individual transfers from `world` (or the funder) directly to each member's bag — the group bag is not debited or credited.
2. **Given** a group eval contract that specifies an equal split, **When** the contract resolves, **Then** each member receives `floor(total / memberCount)` GoldCoin; any remainder is returned to the world bag.
3. **Given** a group whose membership is frozen at contract acceptance, **When** the contract resolves, **Then** payout goes only to members at acceptance time — ghosts who joined after acceptance receive nothing from this contract.
4. **Given** an attempt to transfer a non-membership resource (e.g. GoldCoin) into the group bag directly, **When** the transfer is submitted, **Then** it is rejected — the group bag only holds the resource type used as membership escrow.
5. **Given** a group member whose individual bag is at the conserved resource ceiling, **When** the contract payout is attempted, **Then** that member's portion is returned to the world bag and a warning is logged — payout is not blocked for other members.

---

### Edge Cases

- What happens when two ghosts simultaneously attempt to pick up the last unit of a resource on a tile? (Race condition — ledger commit should reject the second with `LedgerInsufficientFunds`.)
- What happens if a map placement references an ItemType not defined in the `[items:Items]` block? (Parse error, session does not start.)
- How does the system handle a monotonic resource declared alongside spatial item placements? (Placements only apply to conserved resources; monotonic resources cannot be spatially placed.)
- What if a ghost drops an item onto a tile that is already at capacity? (Capacity check must precede ledger commit; drop rejected with a capacity error, not a ledger error.)
- What if two source items of the same type are placed on the same tile? (Each ticks independently; their output accumulates at that tile location — no conflict, just higher throughput.)
- What if a source's `resourceId` does not match any declared or placement-derived resource? (Authoring error at map parse time; session does not start.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `ParsedItemPlacement` MUST support an optional integer `qty` field; absence defaults to 1.
- **FR-002**: Session initialisation MUST derive world bag seed quantities for takeable item types by summing placement `qty` values across all tiles, not from a separate `ResourceType.qty` declaration.
- **FR-003**: A `ResourceType` declared in `[resources:Resources]` with the same id as a placement-derived item type MUST raise an authoring error (conflict, not silent merge).
- **FR-004**: Non-spatial conserved resources (e.g. abstract XP pools) MUST continue to be declarable in `[resources:Resources]` with an explicit `qty`; these are not item types and have no tile location.
- **FR-005**: The MCP `pickup` tool MUST validate that the ItemType is `takeable`, the ghost is co-located with the item on the tile, and sufficient world bag balance exists at that location before committing a ledger transfer.
- **FR-006**: The MCP `drop` tool MUST validate that the ghost holds the item, the target tile has sufficient capacity, and the tile exists before committing the reverse ledger transfer.
- **FR-007**: The map MUST support a spawn-grant declaration keyed by role name (e.g. `attendee`, `vendor`, `sponsor`), specifying resource quantities transferred from the world bag to the ghost bag at spawn time.
- **FR-008**: At spawn time the world-api MUST read the `role` field from the ghost's A2A agent card metadata; if absent, the role defaults to `attendee`. The role is accepted without validation (honor system).
- **FR-008a**: If the world bag has insufficient balance to fulfil a role grant, the ghost MUST still spawn; the grant MUST be skipped with a logged warning — spawn is never blocked by an underfunded grant.
- **FR-009**: The world bag MUST support at least one redistribution mechanism: a time-based drip that places resource units back onto passable map tiles.
- **FR-010**: All pickup, drop, spawn-grant, redistribution, and source-tick events MUST be recorded as standard ledger transactions with cause labels (`pickup`, `drop`, `spawn-grant`, `world-drip`, `source-tick`).
- **FR-011**: An `ItemTypeDef` MUST support an optional `source` field declaring `{ resourceId: string, ratePerTick: number, intervalSecs: number }`; when present the item acts as a resource generator at its tile location.
- **FR-012**: A source item producing a **conserved** resource MUST draw from the undifferentiated world bag; if the world bag holds zero units the tick is a no-op (no error).
- **FR-013**: A source item producing a **monotonic** resource MUST mint new units unconditionally on each tick, regardless of world bag balance.
- **FR-014**: When a source item is picked up (if also `takeable: true`), its tick timer MUST be suspended until the item is dropped onto a tile.
- **FR-015**: Source item declarations MUST be validated at map parse time: the `resourceId` MUST match a declared or placement-derived resource; an unknown `resourceId` is an authoring error.
- **FR-016**: When the caller is an admin session, the `offer` tool MUST accept `"world"` as the implicit initiator and MUST NOT perform a proximity check.
- **FR-017**: A world-bag offer MUST validate world bag balance at proposal creation time and reject immediately with `LedgerInsufficientFunds` if balance is insufficient — no pending proposal with an unbacked give-side.
- **FR-018**: A non-admin caller MUST NOT be able to initiate an offer from the world bag; such attempts MUST be rejected with an auth error before any proposal is created.
- **FR-019**: A conserved resource type MUST declare a `ceiling` (maximum units any single ghost bag may hold); the default ceiling is the total seeded quantity. Pickup and trade commits MUST enforce this ceiling and reject with a capacity error if exceeded.
- **FR-020**: Monotonic resource types MUST NOT have a ceiling; ghost bag balances for monotonic resources are unbounded.
- **FR-021**: An `offer` with `for_qty: 0` MUST be accepted as a valid gift; the ledger records only the give-side transfer. The `for_resource` field MAY be omitted or set to any value when `for_qty` is 0.
- **FR-022**: Session initialisation MUST log a warning if the total source tick output rate for any conserved resource is less than the estimated consumption rate (sum of all movement costs across all rule edges multiplied by expected ghost count); the session is not blocked.
- **FR-023**: An eval contract targeting a group MUST record member IDs at acceptance time; payout MUST be distributed directly to those members' individual bags, not to the group bag.
- **FR-024**: The group bag MUST only hold the resource type used as membership escrow; transfers of any other resource type into the group bag MUST be rejected.
- **FR-025**: If a member's bag ceiling prevents receipt of their contract payout share, that share MUST be returned to the world bag; payout for other members proceeds normally.

### Key Entities

- **ResourceType** (extended): adds a `spatial: boolean` flag derived from whether the resource has item placements; spatial resources participate in tile-location transfers. Conserved resources also declare a `ceiling` (max ghost bag holdings); monotonic resources have no ceiling.
- **ItemPlacement** (extended): adds `qty: number` (default 1) to `ParsedItemPlacement`.
- **SpawnGrant**: map-level declaration mapping role names to resource grants — `{ role: string, grants: { resourceId, qty }[] }`. The role key is matched against the `role` field in the ghost's A2A agent card metadata; absence defaults to `attendee`.
- **RedistributionRule**: declares a periodic or event-triggered mechanism for moving world-bag holdings back to tile locations (`{ resourceId, qtyPerTick, intervalSecs, strategy: "random-passable" | … }`).
- **SourceItemDef**: optional field on `ItemTypeDef` — `source?: { resourceId: string, ratePerTick: number, intervalSecs: number }`. A source item is a location-pinned resource generator. For conserved resources it recirculates from the world bag; for monotonic resources it mints new units.

### Interface Contracts

- **IC-001**: `ParsedItemPlacement` in `@aie-matrix/map-gram` MUST add `qty?: number`; consumers (world-api session init, Neo4j seeder) treat absence as `1`.
- **IC-002**: `Transfer.location` (`{ h3Index: string }`) MUST be set on all pickup, drop, and world-drip transfers to preserve spatial auditability in the ledger chain.
- **IC-003**: `LedgerService.commit()` interface is unchanged; spatial context is carried inside the `Transfer` object, not as a separate parameter.
- **IC-004**: MCP tools `pickup` and `drop` are new tool definitions added to the world-api MCP server; their schemas MUST be documented in `docs/mcp-tools.md`.
- **IC-005**: `ItemTypeDef` in `@aie-matrix/map-gram` MUST add `source?: { resourceId: string, ratePerTick: number, intervalSecs: number }`; consumers (world-api session init) register a tick fiber per placed source instance.
- **IC-006**: World-api spawn logic MUST read `agentCard.metadata.role` (string, optional) when resolving spawn grants; the A2A agent card schema is not modified — `role` is an existing free-form metadata field.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A map author can declare a pile of 10 GoldCoins on a single tile with one line of gram syntax; previously required 10 duplicate placement nodes.
- **SC-002**: Session initialisation produces a world bag whose totals exactly match the sum of all placement quantities — verifiable by a deterministic test against a known map fixture.
- **SC-003**: A ghost picking up and dropping items produces a balanced ledger — the sum of all bag holdings plus world bag always equals the seeded total for that conserved resource.
- **SC-004**: All resource movements (pickup, drop, spawn-grant, movement cost, world-drip, contract payout) are recorded as ledger transactions; zero resource movements occur outside the ledger.
- **SC-005**: After 10 minutes of simulated play with 5 ghosts paying movement costs, the world bag for any conserved resource does not reach zero (redistribution rate exceeds consumption rate for default config).
- **SC-006**: A map with a source item produces resource units exclusively at the declared tile location — no units appear at other tiles from source-tick events.
- **SC-007**: Conservation invariant holds across source ticks for conserved resources: total units in all bags plus world bag equals seeded total at all times.
- **SC-008**: An admin world-bag offer that is agreed completes as a single atomic ledger transaction — no intermediate state where the world bag has debited but the ghost bag has not yet credited.

## Assumptions

- Takeable items are fungible within their type (quantity matters, not instance identity); non-fungible unique items are modelled as a conserved resource with `qty: 1` and a uniquely-named type.
- The redistribution drip operates on the server clock, not on player actions; a lightweight timer fiber is acceptable.
- Tile capacity rules are already enforced upstream of the ledger (the ledger does not own capacity logic).
- The `[resources:Resources]` block in `.map.gram` remains valid for non-spatial resource types (XP, reputation scores) that have no physical presence on tiles.
- Ghost spawn location is already determined before the spawn-grant transfer; the grant uses the spawn tile's H3 index if the grant is spatially anchored, or omits `location` if it is an abstract resource.
- Participation is currently closed; role self-declaration in the A2A agent card is accepted on the honor system with no server-side role whitelist.
- The set of valid role names (`attendee`, `vendor`, `sponsor`, etc.) is defined by the map author in the spawn-grant block; the server does not enforce a global role taxonomy.
- Resources are not preserved across sessions; ghost bags and group bags are zeroed at session end. Conservation is a within-session invariant only.
- The group bag is an escrow of membership commitment, not a shared wallet. It holds only the membership resource type and cannot be spent or disbursed directly; eval contract payouts bypass it and go straight to member bags.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update resource model section to reflect unified item/resource design
- `docs/mcp-tools.md` — add `pickup` and `drop` tool schemas
- `shared/map-gram/README.md` (or equivalent) — document `qty` field on item placements
- `specs/022-in-world-resource-ledger/spec.md` — note superseding decisions from this spec
