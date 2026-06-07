# Feature Specification: In-World Resource Ledger

> **⚠️ Superseded by [027-resource-lifecycle](../027-resource-lifecycle/spec.md)**
>
> The `ResourceType` registry, monotonic resource classes, and `CatalogResourceGrant` concepts
> introduced here were removed in 027. Use `itemRef` strings and `SpawnGrant` blocks instead.
> The hash-chained ledger core (double-entry, conservation invariant) was kept and extended.

**Feature Branch**: `022-in-world-resource-ledger`  
**Created**: 2026-05-31  
**Status**: Superseded  
**Input**: In-world resource ledger as described in RFC-0023

## Proposal Context *(mandatory)*

- **Related Proposal**: [proposals/rfc/0023-in-world-resource-ledger.md](../../proposals/rfc/0023-in-world-resource-ledger.md)
- **Scope Boundary**: A single append-only, hash-chained, double-entry transaction log per map session that tracks all resource movements between actor-owned bags. Covers two resource classes (conserved and monotonic), the `inventory` MCP tool for ghost-facing balance reads, cost enforcement on `GO` rule edges, and Neo4j persistence of the log. Scoped to a single long-lived session (AIEWF 2026 Moscone West map).
- **Out of Scope**: Cross-session carryover; trade offer/accept handshake UI; cost enforcement on non-`GO` actions; snapshots for fast replay (deferred post-MVP); external ledger integrations; group membership visibility policy (depends on a future Group Formation RFC).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghost checks and spends resources (Priority: P1)

A ghost (autonomous agent) checks what it currently holds, is rewarded resources by a server mechanic, and then pays a movement cost to cross a restricted tile edge. The ghost's balance updates correctly and the conservation invariant holds throughout.

**Why this priority**: This is the core loop — without it, nothing downstream (costs, exams, bounties) works. It is the minimum observable feature.

**Independent Test**: Seed a map with `gold: 100` in the world bag. Credit a ghost 20 gold. Verify `inventory` returns `{ gold: 20 }` and the world bag holds `gold: 80`. Cross a tile edge with a 5-gold cost. Verify ghost holds `gold: 15`, world holds `gold: 85`, and the sum stays 100.

**Acceptance Scenarios**:

1. **Given** a session seeded with `gold: 100` in the world bag, **When** a server mechanic credits a ghost 20 gold, **Then** `inventory` returns `{ gold: 20 }` and world bag reports `{ gold: 80 }`.
2. **Given** a ghost holds `gold: 15` and a `:GO` rule edge costs 5 gold, **When** the ghost attempts to cross that edge, **Then** the movement succeeds, a receipt reports `-5 gold`, and the ghost's balance is `{ gold: 10 }`.
3. **Given** a ghost holds `gold: 3` and a `:GO` rule edge costs 5 gold, **When** the ghost attempts to cross that edge, **Then** the movement is denied with `INSUFFICIENT_FUNDS` and the ghost's balance is unchanged.
4. **Given** any sequence of transactions, **When** all actor balances for a conserved resource are summed, **Then** the total equals the seeded amount.

---

### User Story 2 — Operator verifies ledger integrity (Priority: P2)

An operator or auditor replays the append-only log to validate that every bag's current balance is consistent with the transaction history, and that no historical entry has been tampered with.

**Why this priority**: Verifiability is the central promise of the ledger design. Without it, the ledger is just a mutable balance store with extra steps.

**Independent Test**: Run a sequence of transactions. Rebuild all bags from the log from genesis and confirm they match the live cached bags. Manually alter a historical log entry and re-walk the chain — tampering must be detected.

**Acceptance Scenarios**:

1. **Given** a log of N transactions, **When** all bags are rebuilt by replaying from genesis, **Then** every balance matches the live cached state.
2. **Given** a running session, **When** the server restarts and replays the persisted log, **Then** all balances after restart are identical to those before the restart.
3. **Given** a historical log entry is mutated, **When** the chain is re-walked, **Then** tampering is detected and reported.
4. **Given** a transaction ID that has already been committed, **When** the same ID is submitted again, **Then** the duplicate is rejected (idempotency).

---

### User Story 3 — Monotonic resources accumulate and cannot be traded (Priority: P3)

A ghost earns XP or a badge through an authorized server mechanic. The resource accumulates and can be read via `inventory`, but cannot be transferred to another actor.

**Why this priority**: Monotonic resources (XP, badges, hands-played) are needed by RFC-0018 and RFC-0022 but are a lighter extension once the conserved core works.

**Independent Test**: Mint XP for a ghost via an authorized mechanic. Confirm `inventory` shows the accumulated XP. Attempt to transfer XP to another actor — confirm it is rejected.

**Acceptance Scenarios**:

1. **Given** an authorized mechanic mints 50 XP to a ghost, **When** `inventory` is called, **Then** the ghost's XP balance is 50.
2. **Given** a ghost has 50 XP, **When** any actor attempts to transfer that XP to another actor, **Then** the transfer is rejected (monotonic resources cannot move).
3. **Given** multiple XP mint events, **When** `inventory` is called, **Then** the balance is the cumulative sum of all mints.

---

### User Story 4 — Ghost-to-ghost resource trade (Priority: P4)

Two ghosts negotiate and execute a direct resource exchange. Either party can initiate with `offer` or `request`; the other confirms with `agree`. Either party can cancel with `decline`. The ledger commits the exchange atomically only when both parties have consented.

**Why this priority**: Trades are the most common ghost-to-ghost use of the ledger — card exchanges with resource sweeteners, bounty payments, and bartering. Without them the ledger is useful but not social.

**Independent Test**: Ghost A calls `offer` to give 10 gold to Ghost B in exchange for 5 energy. Ghost B calls `agree` with the proposal ID. Confirm both balances updated atomically. Conservation holds. Then: Ghost A calls `offer` again; Ghost B calls `decline` — confirm balances unchanged and proposal cleaned up.

**Acceptance Scenarios**:

1. **Given** Ghost A calls `offer { to, give: {resource, qty}, for: {resource, qty} }`, **When** Ghost B calls `agree { proposalId }`, **Then** both transfers commit atomically, receipts are returned to both parties, and conservation holds.
2. **Given** Ghost B calls `request { from, want: {resource, qty}, offering: {resource, qty} }`, **When** Ghost A calls `agree { proposalId }`, **Then** the same atomic commit occurs as in scenario 1.
3. **Given** a pending proposal, **When** either party calls `decline { proposalId }`, **Then** the proposal is removed, no ledger commit occurs, and both parties receive a cancellation receipt.
4. **Given** Ghost A calls `offer` but lacks sufficient balance, **When** `agree` is called, **Then** the commit is denied with `INSUFFICIENT_FUNDS` and the proposal is voided.
5. **Given** a pending proposal that neither party acts on, **When** the proposal TTL expires (default: 5 minutes), **Then** it is automatically voided as if `decline` were called.
6. **Given** Ghost A tries to `agree` on a proposal they themselves initiated, **Then** the request is rejected (`SELF_AGREE_DENIED`).

---

### Edge Cases

- What happens when a drain transaction would reduce a conserved balance below zero? It clamps to the floor and the transaction commits at the clamped amount; a `ledger.transaction.committed` event carries the `newBalance`.
- What happens when two concurrent costed `GO` actions are submitted for the same ghost? The single-writer constraint serializes them; one commits, the other either commits (if sufficient balance remains) or is denied.
- What happens when a resource type referenced in a transaction has never been seeded? The transaction is rejected with `UnknownResource`.
- What happens when the log is empty (fresh session)? Bags are empty; seeding the world bag is the genesis transaction.
- What happens if Neo4j is unavailable during a commit? The commit fails with `PersistenceError`; the in-memory cache update is rolled back; the caller may retry.
- What happens if a trade proposal expires before `agree` is called? It is automatically voided (TTL default: 5 minutes); both parties are notified via a `ledger.proposal.expired` event.
- What if Ghost A's balance drops below the offered amount between `offer` and `agree`? The `agree` commit fails with `INSUFFICIENT_FUNDS`; the proposal is voided.
- What if both ghosts call `agree` simultaneously on each other's offer for the same resources? The single-writer serializes them; one commits, the other sees a voided proposal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The ledger MUST be append-only; existing entries MUST NOT be modifiable after commit.
- **FR-002**: Each transaction MUST be hash-chained to its predecessor so tampering with any historical entry is detectable by re-walking the chain.
- **FR-003**: Each transaction MUST carry a ULID as its idempotency key; re-submission of a seen ID MUST be rejected.
- **FR-004**: Conserved resource movements MUST be double-entry: the quantity leaving one bag MUST equal the quantity entering another.
- **FR-005**: The sum of all bags' holdings of any conserved resource MUST equal the seeded total for all time.
- **FR-006**: A conserved movement that would cause any bag to go below its floor (default: zero) MUST be denied with `INSUFFICIENT_FUNDS`.
- **FR-007**: Monotonic resources MUST only be minted by server-side Effect services that receive `LedgerService` via Layer injection; authorization is enforced at code review (trust-by-call-site), not at runtime. Monotonic transfers MUST NOT be initiatable by ghost agents or external callers. Monotonic resources MUST NOT be transferable between actors.
- **FR-008**: Actor bags MUST be materialized caches rebuildable from the log; a bag's contents at any point MUST match the fold of all movements touching that actor.
- **FR-009**: The ledger MUST persist to durable storage (Neo4j `(:LedgerEntry)` nodes) such that balances survive a server restart. If the Neo4j write fails, the commit MUST be rolled back (in-memory cache update reverted) and a `PersistenceError` returned to the caller; no partial state is accepted.
- **FR-010**: A `GO` rule edge MAY carry a cost list; the ledger MUST enforce the cost atomically with the movement — if the cost cannot be met, the `GO` is denied.
- **FR-011**: A costed action MUST disclose its cost (quote) before committing and report the committed cost in its response (receipt). Acceptance is governed by the ghost's autonomy threshold: below the threshold the action auto-accepts; at or above it a blocking MCP checkpoint fires and the ghost must explicitly confirm before `commit` is called. The threshold is per-transaction-kind and per-ghost.
- **FR-012**: The `inventory` MCP tool MUST return the calling actor's current holdings; it MUST accept an optional `actorId` parameter subject to read policy.
- **FR-013**: The ledger writer MUST be a single process per session (single-writer constraint).
- **FR-014**: Resource types and the world bag's initial seed MUST be declarable in the map definition (`.map.gram` or sidecar) for MVP.
- **FR-015**: The `offer` MCP tool MUST create a pending trade proposal (giver-initiated); the `request` tool MUST create a pending trade proposal (receiver-initiated). Both produce a `proposalId` returned to the caller.
- **FR-016**: The `agree` MCP tool MUST atomically commit the trade transaction via `LedgerService.commit()` carrying both actors' consent; it MUST be callable only by the non-initiating party.
- **FR-017**: The `decline` MCP tool MUST void a pending proposal without committing any ledger transaction; it MUST be callable by either party.
- **FR-018**: Pending proposals MUST expire automatically after a configurable TTL (default: 5 minutes); expired proposals MUST be voided as if `decline` were called.
- **FR-019**: Monotonic resources MUST NOT be tradeable; `offer` or `request` referencing a monotonic resource MUST be rejected.
- **FR-020**: The `inventory` MCP tool response MUST include both resource holdings (from the ledger) and carried items (from `ItemService`), unified in a single response.

### Key Entities

- **Actor**: Any identifiable entity that can hold resources (world, ghost, NPC). Has exactly one bag.
- **Bag**: Materialized cache of an actor's current holdings per resource type. Rebuilt from the log on demand.
- **Resource**: A named, typed quantity. Either *conserved* (fixed total supply, moves between bags) or *monotonic* (minted by authority, accumulates only).
- **Transaction**: An atomic, ordered set of transfers; hash-chained to its predecessor; carries a ULID, cause, actor list, timestamp, and chain hashes.
- **Transfer**: A single double-entry resource transfer: resource type, quantity, from-actor, to-actor, optional location.
- **LedgerEntry**: The persisted form of a transaction in Neo4j, scoped to a session subgraph.
- **Session**: One instance of a map being played. The ledger is scoped to a single session.

### Interface Contracts

- **IC-001**: `Transaction` and `Transfer` shapes (including `prevHash`/`hash` fields and ULID `id`) MUST be defined in `shared/types/` and consumed by both `server/world-api` and `server/colyseus`.
- **IC-002**: `LedgerService` MUST expose an Effect-ts service interface so it can be consumed by `movement.ts` (cost enforcement), MCP server (`inventory` tool), and calendar-triggered scheduled transactions (RFC-0021).
- **IC-003**: The `ledger.transaction.committed` event MUST include a `changes` array (each entry: `actorId`, `resource`, `newBalance`, `delta`) plus a top-level `cause` field, so that `server/colyseus` can broadcast bag changes for all affected actors without coupling to ledger internals. Only actors whose bags changed are included in `changes`.
- **IC-004**: New `Data.TaggedError` types (`InsufficientFunds`, `ConservationViolation`, `ConsentRequired`, `UnknownResource`, `PersistenceError`, `ProposalNotFound`, `SelfAgreeDenied`, `ProposalExpired`) MUST be added to the `HttpMappingError` union in `server/src/errors.ts` and handled in `errorToResponse()`.
- **IC-005**: `Proposal` shape (proposalId, initiatorId, counterpartyId, give, want, expiresAt, status) MUST be defined in `shared/types/src/ledger.ts`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Conservation holds across all transaction sequences — the sum of all bags for any conserved resource equals the seeded total, verifiable by replaying the log.
- **SC-002**: A ghost denied a costed move due to insufficient balance receives an `INSUFFICIENT_FUNDS` response; the balance is unchanged.
- **SC-003**: A duplicate transaction ID is rejected; the ledger state is unchanged.
- **SC-004**: All bag balances after a server restart match the pre-restart state (rebuilt from the persisted log).
- **SC-005**: Tampering with any historical log entry is detectable by re-walking the hash chain.
- **SC-006**: `inventory` returns the correct holdings within one round-trip after a transaction commits.
- **SC-007**: A costed `GO` move quotes the cost before committing and reports the receipt after; the ghost's balance reflects the deduction.
- **SC-008**: The `commit` path completes in under 10ms at p95 under expected AIEWF load (~3000 concurrent ghosts, single session).
- **SC-009**: A completed trade atomically updates both parties' balances; neither party can observe an intermediate state where one balance is updated but the other is not.
- **SC-010**: A `decline` or TTL expiry voids a proposal with no ledger state change; both parties' balances are identical before and after.
- **SC-011**: `docs/guides/ghost-action-reference.md` documents `offer`, `request`, `agree`, `decline`, and the updated `inventory` response shape before the feature ships.

## Clarifications

### Session 2026-05-31

- Q: How is "authorized server mechanic" enforced for monotonic minting? → A: Trust-by-call-site — only Effect services wired with `LedgerService` via Layer injection can mint; enforced at code review, no runtime token.
- Q: How does a costed action carry ghost acceptance? → A: Autonomy-threshold — auto-accepts below the ghost's per-kind threshold; blocking MCP checkpoint fires at or above it.
- Q: What happens if the Neo4j write fails during commit? → A: Roll back in-memory cache update and surface `PersistenceError` to caller; no partial state accepted.
- Q: IC-003 event shape — singular actorId/resource or array? → A: Array of changes (`actorId`, `resource`, `newBalance`, `delta`) per entry, matching the contract doc.
- Q: Should the `<10ms p95` commit latency target be a testable success criterion? → A: Yes — added as SC-008.

## Assumptions

- The Moscone West map runs as a single long-lived session for AIEWF 2026; cross-session carryover is not needed.
- Neo4j is the persistence backend for MVP; whether it scales to conference load is an open question (RFC-0023 §9) deferred post-event.
- MVP replays the log from genesis on restart; snapshots to bound recovery time are deferred.
- Resource types and world bag seed are declared in the map definition (`.map.gram` or a sidecar file) for MVP; an admin API for runtime registration is future work.
- The world-api process owning the session is the sole ledger writer for a given session.
- Costs on non-`GO` actions (take, NPC commands) are out of scope until the rule system covers those actions.
- The trade offer/accept handshake is a higher-level mechanic; the ledger sees only the final consented transaction.
- Trade proposals (`offer`, `request`) are proximity-gated: both ghosts must share a tile. This is intentional social friction — avoidance via movement is the primary defense against unwanted interactions; active blocking is a later escalation step. See `docs/project-overview.md` §Social Friction by Design.
- Group membership visibility policy (`group` read scope on `inventory`) depends on a future Group Formation RFC and is deferred.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — mark the *Time-Series / Event Log Backend* open question as resolved (Neo4j `(:LedgerEntry)` nodes, per RFC-0023 §2).
- `docs/guides/effect-ts.md` — may need an entry showing the `LedgerService` Layer pattern as a canonical example of a single-writer Effect service.
- Map format documentation (wherever `.map.gram` resource seed syntax is specified) — add resource type and seed declaration syntax.
