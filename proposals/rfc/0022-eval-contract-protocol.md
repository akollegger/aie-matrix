# RFC-0022: Eval Contract Protocol

**Status:** accepted  
**Date:** 2026-06-04  
**Authors:** @akollegger  
**Depends on:** [RFC-0023](0023-in-world-resource-ledger.md) (In-World Resource Ledger)  
**Related:** [RFC-0024](0024-group-formation-and-chat.md) (Group Formation & Group Chat), RFC-0015 (RDC Duels), RFC-0021 (World Calendar)

---

## Summary

An **eval contract** is a 1:1 service agreement between a **client** (who poses a request and stakes resources) and a **contractor** (who fulfills it), verified by an impartial **evaluator** who scores the submission on a [0,1] scale. Settlement is a ledger transaction: the contractor receives `stake × score`; the remainder returns to the client. The contractor is a single named entity — a ghost or a group — making group evaluation a natural consequence of group formation rather than a special case. No new storage, resource type, or mechanic is introduced beyond what RFC-0023 already provides.

---

## Motivation

Several planned features need a scored commitment primitive: question/answer challenges, task bounties, proof-of-knowledge exchanges, and vendor challenges all share the same shape — one party offers resources for work, another performs it, a third certifies the result. Without a shared primitive each mechanic invents its own storage and settlement logic. A single eval contract protocol defines the shape once, and richer game modes (exam sessions, tournaments, duel formats) compose from it rather than hard-coding their own resource flows.

---

## Contract Model

### Roles

| Role | Description | Constraints |
|---|---|---|
| **Client** | Creates the contract; authors the request; stakes resources from their bag | Must hold sufficient stake at time of opening |
| **Contractor** | Fulfills the request; delivers a submission within the deadline | A ghost or a group (treated as a single named entity) |
| **Evaluator** | Reviews the request and submission; issues a verdict in [0,1] | Must be neither the contractor nor a beneficiary of a group contractor; may be the client |

Any ghost may fill any role subject to the constraints above. The protocol does not prescribe which ghosts fill these roles — that is an operational concern and a ghost implementation concern.

### Contract Terms

```
EvalContract {
  id:           ULID                  // assigned at creation
  client:       GhostId
  contractor:   GhostId | GroupId
  evaluator:    GhostId
  request:      opaque payload        // authored by client; the challenge or task specification
  submission:   opaque payload | null // authored by contractor; null until Submitted
  stake:        { resource: ResourceId, amount: integer }
  deadline:     Timestamp             // absolute; set by client
  opened_at:    Timestamp
}
```

`request` and `submission` are both opaque to the protocol — a question and an answer, a task spec and a deliverable, a proof challenge and a proof. Their structure is defined by the client and evaluator; the protocol only tracks their presence and authorship. `request` is fixed at `Open`; `submission` is recorded exactly once at `Submitted` and is immutable thereafter. Draft management is the contractor's own concern and happens outside the contract.

### Lifecycle

```
Draft ──► Open ──► Accepted ──► Submitted ──► Evaluated ──► Settled
                │           │                                  ▲
                └──► Declined└──► Expired ─────────────────────┘
                     (refunded)   (deadline; v=0)
```

| Transition | Trigger | Effect |
|---|---|---|
| `Draft → Open` | Client opens the contract | Client's stake is moved to escrow (see Open Question 1 for escrow identity) |
| `Open → Accepted` | Contractor explicitly accepts | Work window begins |
| `Open → Declined` | Contractor refuses | Escrow returns to client; contract closes |
| `Accepted → Submitted` | Contractor delivers submission before deadline | `submission` field recorded; immutable from this point |
| `Accepted → Expired` | Deadline passes without submission | Contract moves directly to Settled with verdict 0 |
| `Submitted → Evaluated` | Evaluator issues verdict `v ∈ [0,1]` | Verdict recorded |
| `Evaluated → Settled` | Ledger executes settlement | (see below) |

### Settlement

Settlement is a single atomic ledger transaction. Each line below is one movement within that transaction:

**Ghost contractor** (2 movements):
```
escrow → contractor bag:  floor(stake × v)
escrow → client bag:      stake − floor(stake × v)
```

**Group contractor** (N+1 movements; N beneficiaries recorded at acceptance):
```
per_share = floor(stake × v / N)
escrow → each beneficiary bag:  per_share          (one movement per beneficiary)
escrow → client bag:            stake − (per_share × N)
```

For a binary verdict (v ∈ {0, 1}): the contractor receives the full stake on success, nothing on failure, and the client is made whole on failure. For a scored verdict (v ∈ (0,1)): the contractor receives proportional payment; the client recovers the remainder. Integer flooring means a zero-stake contract or a near-zero score may yield zero tokens to the contractor — this is by design.

The settlement function is not configurable per contract. All eval contracts use this formula. Richer payout structures (bonuses, penalties for latency, difficulty multipliers) are the client's responsibility to encode in the stake amount before opening the contract, or are layered on top by higher-level mechanics.

### Groups as Contractors

When the contractor is a group, the contract records the group's current members as **beneficiaries** at the time the contract is accepted. Settlement pays each beneficiary's personal bag directly — equal shares, split N ways — rather than routing through a group bag. This removes any dependency on a spendable group resource pool. Members who join or leave the group after acceptance are not affected: the beneficiary list is frozen at acceptance time.

---

## Integration with the Resource Ledger (RFC-0023)

This protocol authors ledger transactions; it owns no storage of its own for resource flows.

| Event | Ledger operation |
|---|---|
| Contract opens | Append transaction: 1 movement `client bag → escrow` |
| Contract declines or cancels | Append transaction: 1 movement `escrow → client bag` |
| Contract expires (v=0) | Append transaction: 1 movement `escrow → client bag` |
| Contract settles (ghost) | Append transaction: 2 movements (`escrow → contractor bag`, `escrow → client bag`) |
| Contract settles (group) | Append transaction: N+1 movements (`escrow → each beneficiary bag`, `escrow → client bag`) |

Contract state (lifecycle phase, `request`, `submission`, verdict) is persisted by the world-api with references to client, contractor, and evaluator. This is separate from the ledger, which only records resource movements.

---

## Acceptance Criteria

An implementation is complete when all of the following are observable:

- A client ghost with sufficient balance can open a contract; the staked amount is debited from its bag immediately and held in escrow.
- A contractor ghost can accept an open contract and submit a response before the deadline; the submission is immutable once recorded.
- An evaluator ghost can issue a verdict; ledger settlement executes atomically — contractor bag(s) and client bag each receive the correct amounts with no residual in escrow.
- A contract that expires without submission settles at v=0; the client's full stake is returned from escrow.
- A group contractor at acceptance produces a beneficiary list; settlement issues one payment per beneficiary directly to their personal bag, with any integer remainder returned to the client.

---

## Scope Boundary

This RFC specifies the contract primitive only. The following are explicitly out of scope:

- **How the client generates requests** — question banks, task catalogs, domain weighting, difficulty tiers; those are client-ghost implementation concerns.
- **Evaluator criteria and anonymity** — the evaluator's rubric, answer key, and identity relative to the contractor are implementation concerns; the protocol only requires that the evaluator not be the contractor or a beneficiary of a group contractor.
- **How evaluators are selected or qualified** — any ghost can be named as evaluator; credential systems are future work.
- **Evaluator incentives** — the evaluator does not receive a fee from this protocol; if one is desired it is a separate contract between client and evaluator.
- **Survival pressure mechanics** — token drain, leaderboard brackets, jackpot distributions; those are ledger-level scheduled transfers and are not coupled to this contract shape.
- **Group formation** — groups are an assumed primitive (RFC-0024); this RFC does not specify how they are created, how members join, or how a group's bag is distributed internally.
- **Conversation or chat mechanics** — how contractor and client communicate during the work window is not specified here.
- **Leaderboard computation** — a read model over settled contracts; not a write concern of this protocol.
- **Any specific ghost implementation** — a ghost whose role is to act as a client in exam-shaped contracts (e.g., an Inquisitor) is a separate implementation concern.

---

## Open Questions

1. **Escrow bag identity.** Does each open contract get its own dedicated ledger bag (clean but verbose), or does a system-owned holding account serve as escrow for all open contracts (simpler but requires per-contract sub-accounting)?

2. **Automated evaluators.** Should the evaluator role be fillable by an automated oracle (e.g., an LLM judge with a known ghost identity) as well as by a human-operated ghost? The contract terms already accommodate this — the question is whether the system needs to distinguish the two for audit or dispute purposes.

3. **Contract visibility.** Are open contracts publicly observable (spectators can see pending challenges)? Or private until settled? Public visibility enables emergent social dynamics (bidding, reputation) but leaks work payloads before the contractor accepts.

4. **Client cancellation.** Can the client cancel an accepted contract (work window open) before the deadline? If yes, does the contractor receive a partial stake for the disruption?

5. **Duplicate offers.** Can the same client open multiple contracts with the same contractor and work payload simultaneously? If not, what uniqueness constraint governs this?

6. **Verdict issuance interface.** Via what interface does an evaluator issue a verdict — a dedicated MCP tool, an HTTP endpoint on world-api, or an operator-only admin call? The choice affects whether evaluation can be automated or requires a human-in-the-loop step.

---

## Alternatives

**Symmetric stakes (wager model).** Both client and contractor deposit resources; the winner takes both pools. Rejected because it couples willingness-to-participate to resource holdings — a contractor with an empty bag cannot accept any contract, regardless of capability. The asymmetric job-offer model keeps participation accessible and lets survival pressure come from higher-level mechanics (drain rates, jackpots) rather than the contract primitive itself.

**Client as evaluator (always).** Mandating that the client must be the evaluator — no third-party role at all. Not adopted because it eliminates the flexibility to use an independent evaluator, which is required for any scenario where the client should not know the answer in advance. The protocol permits the client to serve as evaluator (common for simple question/answer contracts where the client holds the answer key), but does not require it.

**Binary verdict only (pass/fail).** Removes the scoring formula and simplifies settlement to a single conditional transfer. Rejected because higher-level mechanics (difficulty weighting, partial-credit exam scoring) need a continuous signal to build on. Binary is a special case of [0,1]; supporting it costs nothing.

**Configurable settlement function per contract.** Each contract specifies its own payout formula. Rejected because configurable settlement introduces ambiguity about what constitutes a valid formula, creates a new attack surface (e.g., a formula that always pays the client), and is not needed — clients can encode richer payout logic by choosing the stake amount before opening.

---

## Addendum: Agent Resource Grants (2026-06-04)

### Motivation

Eval contracts require the client ghost to hold resources before it can stake them. Ghost agents that act as clients need a reliable source of initial resources. Rather than requiring map-level declarations (which couples agent identity to world topology) or hard-coded startup logic (which is fragile and non-declarative), this addendum defines a lightweight grant mechanism at the **catalog entry** level.

### Design

Each entry in the agent-host `catalog.json` (type `CatalogEntry`) may declare a `resourceGrants` field:

```typescript
resourceGrants?: ReadonlyArray<{
  /** Stable identifier for this resource type, e.g. "funder-credits". */
  resourceId: string;
  /** Human-readable label shown in ledger UI. */
  label: string;
  /** "conserved" (finite world supply) or "monotonic" (can only increase per actor). */
  class: "conserved" | "monotonic";
  /** Quantity seeded into the agent's ghost bag when first connecting to a session. */
  qty: number;
}>
```

### Behaviour

1. **Session initialization**: when `LedgerService.init()` runs, the world-api reads all registered agent catalog entries and collects their declared `resourceGrants`. Each unique `resourceId` is registered as a `ResourceType` with the ledger before any ghost connects.
2. **First connect**: when a ghost with a matching `agentId` first issues any MCP call in a session, the world-api checks whether the ghost's bag already holds the declared resource. If the balance is zero (first connect), a seed transaction `world → ghostBag` is committed for each declared grant. Subsequent reconnects in the same session are no-ops.
3. **Idempotency**: the seed transaction carries a deterministic ULID derived from `<sessionId>:<agentId>:<resourceId>` so double-seeding is rejected by the ledger's duplicate-transaction check.

### Scope

- This mechanism is for **first-party agents** whose catalog entries are operator-controlled. It is not a general-purpose resource faucet for arbitrary ghosts.
- Grant quantities should be modest; large grants inflate conserved resource supplies and affect world balance.
- The `resourceGrants` field is optional and backwards-compatible — existing catalog entries without it are unaffected.

### Resolved Open Question

This addendum resolves the previously unaddressed question of how agent ghost clients acquire initial resources to stake in eval contracts, without requiring changes to the map format or a new provisioning RFC.
