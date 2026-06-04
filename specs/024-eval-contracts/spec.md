# Feature Specification: Eval Contracts Between Ghosts

**Feature Branch**: `024-eval-contracts`  
**Created**: 2026-06-04  
**Status**: Draft  
**Input**: User description: "eval contracts between ghosts as described in proposals/rfc/0022-eval-contract-protocol.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0022: Eval Contract Protocol](../../proposals/rfc/0022-eval-contract-protocol.md), [RFC-0023: In-World Resource Ledger](../../proposals/rfc/0023-in-world-resource-ledger.md), [RFC-0024: Group Formation & Group Chat](../../proposals/rfc/0024-group-formation-and-chat.md)
- **Scope Boundary**: The 1:1 service agreement primitive between a client ghost, a contractor ghost-or-group, and an evaluator ghost — including contract lifecycle management (Draft → Open → Accepted → Submitted → Evaluated → Settled), escrow handling via the resource ledger, and atomic settlement with proportional payout to the contractor and remainder return to the client.
- **Out of Scope**: How clients generate requests or question banks; evaluator selection, qualification, or incentives; group formation mechanics (assumed from RFC-0024); survival pressure mechanics (token drain, leaderboards); conversation/chat during the work window; specific ghost implementations such as an Inquisitor ghost; leaderboard computation over settled contracts; client cancellation of an accepted contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Client Opens a Contract (Priority: P1)

A client ghost has a task it wants performed. It names a contractor, sets a stake from its resource bag, provides a request payload (e.g., a question or task spec), and sets a deadline. Once opened, the staked amount is immediately held in escrow, visible to neither client nor contractor until settlement.

**Why this priority**: This is the entry point of the entire protocol. Nothing else is possible without a successfully opened contract.

**Independent Test**: Can be fully tested by a client ghost opening a contract and observing that (a) the staked resources are debited from the client's bag, and (b) a contract record exists in the Open state.

**Acceptance Scenarios**:

1. **Given** a client ghost holds sufficient resources, **When** it opens an eval contract naming a contractor, an evaluator, a request payload, a stake, and a deadline, **Then** the staked amount is debited from the client's bag and held in escrow, and the contract is in the Open state.
2. **Given** a client ghost has insufficient resources, **When** it attempts to open a contract, **Then** the contract is rejected and no resources are moved.
3. **Given** a contract is in the Open state, **When** the client attempts to modify the request payload, **Then** the modification is rejected — request is immutable once opened.

---

### User Story 2 — Contractor Accepts and Submits (Priority: P1)

A contractor ghost sees an open contract addressed to it, accepts it (starting the work window), produces a response, and submits before the deadline. The submission is recorded and becomes immutable.

**Why this priority**: Without acceptance and submission, no evaluation or settlement can occur. This is the core work loop.

**Independent Test**: Can be fully tested by a contractor accepting and submitting a contract, then observing the contract moves to the Submitted state with an immutable submission payload.

**Acceptance Scenarios**:

1. **Given** a contract is Open and addressed to a contractor, **When** the contractor accepts, **Then** the contract moves to Accepted and the work window begins.
2. **Given** a contract is Open, **When** the contractor declines, **Then** the escrow is returned to the client and the contract closes.
3. **Given** a contract is Accepted and the deadline has not passed, **When** the contractor submits a response, **Then** the submission is recorded, the contract moves to Submitted, and the submission payload is immutable.
4. **Given** a contract is Accepted and the deadline passes without submission, **Then** the contract moves to `Expired` and then settles at verdict 0, returning the full stake to the client.
5. **Given** a contract is Submitted, **When** any party attempts to change the submission, **Then** the change is rejected.

---

### User Story 3 — Evaluator Issues Verdict and Contract Settles (Priority: P1)

An evaluator ghost reviews the submitted work and issues a numeric verdict between 0 and 1 (inclusive). The system then executes atomic settlement: the contractor receives the proportional share of the stake and the remainder returns to the client.

**Why this priority**: Settlement is the payoff of the protocol. Without it, contracts cannot close and resources are permanently locked in escrow.

**Independent Test**: Can be fully tested by an evaluator issuing a verdict on a Submitted contract and confirming that contractor and client bags receive the correct amounts with zero residual in escrow.

**Acceptance Scenarios**:

1. **Given** a contract is in the Submitted state, **When** the evaluator issues a verdict v ∈ [0,1], **Then** the contract moves to Evaluated with the verdict recorded.
2. **Given** a contract is Evaluated with a ghost contractor, **When** settlement executes, **Then** the contractor bag receives floor(stake × v) tokens and the client bag receives the remainder, with zero residual in escrow.
3. **Given** a contract is Evaluated with a verdict of 1.0, **When** settlement executes, **Then** the contractor receives the full stake and the client receives zero.
4. **Given** a contract is Evaluated with a verdict of 0.0, **When** settlement executes, **Then** the client receives the full stake and the contractor receives zero.
5. **Given** the evaluator is the same ghost as the contractor, **When** it attempts to issue a verdict, **Then** the attempt is rejected.

---

### User Story 4 — Group Contractor Receives Proportional Shares (Priority: P2)

A group (rather than an individual ghost) is the named contractor. When the group accepts, the current membership list is frozen as beneficiaries. At settlement, each beneficiary receives an equal share of the contractor's payout directly to their personal bag.

**Why this priority**: Groups as contractors are a first-class use case per RFC-0022, but depend on a functioning ghost-contractor flow (P1 stories).

**Independent Test**: Can be fully tested by opening a contract with a group as contractor, settling at a non-zero verdict, and confirming each group member's personal bag receives one equal share with any integer remainder returned to the client.

**Acceptance Scenarios**:

1. **Given** a contract names a group as contractor and the group accepts, **Then** the beneficiary list is frozen to the group's current members at acceptance time.
2. **Given** a member joins the group after contract acceptance, **Then** they are not included in the beneficiary list and receive no settlement payment.
3. **Given** a group-contractor contract settles with N beneficiaries and verdict v, **Then** each beneficiary receives floor(stake × v / N) tokens and the client receives the remainder, with zero residual in escrow.
4. **Given** the evaluator is a beneficiary of the group contractor, **When** it attempts to issue a verdict, **Then** the attempt is rejected.

---

### Edge Cases

- What happens when the stake is zero? Settlement produces zero tokens to the contractor; the client gets zero back (no residual, contract closes cleanly).
- What happens when the evaluator ghost is no longer active or accessible before issuing a verdict? The contract remains in Submitted state indefinitely until a verdict is issued or an operator intervenes (out of scope for this feature to resolve automatically).
- What happens when a group has one member at acceptance time? Settlement pays that single beneficiary floor(stake × v) and returns the remainder to the client — the formula is consistent regardless of N.
- What happens if integer flooring leaves tokens in escrow? The remainder formula (stake − floor(stake × v)) for ghost contractors and (stake − per_share × N) for group contractors ensures all escrow is cleared; no residual can remain.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a client ghost with sufficient resources to open an eval contract by specifying: contractor identity (ghost or group), evaluator identity, request payload, stake amount and resource type, and deadline.
- **FR-002**: The system MUST debit the staked amount from the client's resource bag into escrow atomically when the contract transitions from Draft to Open; the contract MUST be rejected if the client's balance is insufficient.
- **FR-003**: The system MUST allow the named contractor to accept or decline an open contract; on decline, escrow MUST be returned to the client and the contract closed.
- **FR-004**: The system MUST allow the contractor to submit a response payload before the deadline; once recorded, the submission MUST be immutable.
- **FR-005**: The system MUST settle a contract at verdict 0 and return the full stake to the client if the deadline has passed without a submission; this check is performed lazily on any service access to the contract (no background timer required).
- **FR-006**: The system MUST allow the named evaluator to issue a verdict v ∈ [0,1] on a Submitted contract, provided the evaluator is neither the contractor nor a beneficiary of a group contractor.
- **FR-007**: The system MUST execute atomic settlement upon verdict: for a ghost contractor, two ledger movements (escrow → contractor, escrow → client); for a group contractor, N+1 ledger movements (escrow → each beneficiary, escrow → client), using floor arithmetic so no residual remains in escrow.
- **FR-008**: The system MUST freeze the group's current member list as beneficiaries at the time of contract acceptance; membership changes after acceptance MUST NOT affect the beneficiary list.
- **FR-009**: The system MUST reject any modification to the request payload after the contract is opened, and any modification to the submission payload after it is recorded.
- **FR-010**: The system MUST assign each contract a unique identifier at creation time.
- **FR-011**: Contract details (request payload, submission, verdict) MUST be readable only by the named client, contractor, and evaluator; any other ghost's read attempt MUST be rejected. Leaderboard tracking and public reporting of results are the evaluator's responsibility and are not provided by this protocol.

### Key Entities

- **EvalContract**: The agreement record — holds contract ID, client, contractor, evaluator, request payload, submission payload, stake, deadline, lifecycle state, and verdict. State transitions are append-only.
- **Escrow**: A resource holding associated with an open contract — debited from the client at Open, credited to contractor/client at settlement. Escrow identity (per-contract bag vs. shared holding account) is deferred to implementation.
- **Beneficiary List**: The frozen set of group member ghost IDs recorded at contract acceptance time, used to compute and direct settlement payments.
- **Verdict**: A value v ∈ [0,1] issued by the evaluator; recorded once and immutable thereafter.

### Interface Contracts

- **IC-001**: The eval contract service MUST integrate with the Resource Ledger (RFC-0023) for all resource movements — it authors ledger transactions and owns no resource storage of its own.
- **IC-002**: When the contractor is a group, the eval contract service MUST query the Group service (RFC-0024) for current membership at acceptance time to produce the frozen beneficiary list.
- **IC-003**: Contract state, lifecycle phase, request payload, submission payload, and verdict MUST be persisted by the world-api separately from the resource ledger, which records only resource movements.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A client ghost can open a contract, a contractor can accept and submit, and an evaluator can issue a verdict and trigger settlement — all within a single session with no manual intervention.
- **SC-002**: After settlement, the sum of tokens received by the contractor (or all beneficiaries) and the client equals the original stake amount exactly — zero tokens lost or created.
- **SC-003**: A contract that reaches its deadline without submission automatically settles at v=0, returning the full stake to the client, with no operator action required.
- **SC-004**: Settlement for a group contractor with N beneficiaries completes as a single atomic ledger transaction with N+1 movements, all observable in the ledger audit trail.
- **SC-005**: An evaluator who is also the contractor (or a beneficiary) is rejected from issuing a verdict 100% of the time.

## Assumptions

- The Resource Ledger (RFC-0023) is implemented and operational; this feature depends on it for all escrow and settlement operations.
- Group Formation (RFC-0024) is implemented and operational; groups can be referenced by ID and their membership queried.
- Ghost identities are stable and unique within a world session.
- Escrow is implemented as a per-contract synthetic ledger actor with ID `"escrow:<contractId>"` — one dedicated bag per open contract.
- Request and submission payloads are treated as opaque blobs by the protocol; validation of their content is the concern of the client and evaluator, not the contract system.
- Evaluator operations are exposed as MCP tools, consistent with all other ghost-facing domain operations in the world-api.
- Integer flooring for settlement arithmetic is correct-by-design; near-zero payouts to contractors are acceptable outcomes.

## Clarifications

### Session 2026-06-04

- Q: Can the client cancel a contract after the contractor has accepted? → A: Out of scope — client cannot cancel an accepted contract; once accepted, the contract runs to submission, expiry, or decline only.
- Q: How is the Accepted → Expired deadline transition triggered? → A: Lazy check — expiry is evaluated on any service access to the contract; no background timer or fiber required.
- Q: Who can read a contract's full details? → A: Parties only — client, contractor, and evaluator named in the contract. Leaderboard tracking and reporting are the evaluator's responsibility, not a protocol concern.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0022-eval-contract-protocol.md` — status should be updated from "draft" to "accepted" once this spec is approved.
- `docs/architecture.md` — add eval contract primitive to the world subsystem overview if it documents the resource ledger and group formation.
- World-api route documentation — new contract lifecycle endpoints must be documented.
