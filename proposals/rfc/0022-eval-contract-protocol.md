# RFC-0022: Eval Contract Protocol

**Status:** draft  
**Date:** 2026-06-04  
**Authors:** @akollegger  
**Depends on:** [RFC-0023](0023-in-world-resource-ledger.md) (In-World Resource Ledger)  
**Related:** RFC-TBD (Group Formation), RFC-0015 (RDC Duels), RFC-0021 (World Calendar)

---

## Summary

An **eval contract** is a 1:1 service agreement between a **client** (who poses work and stakes resources) and a **contractor** (who performs the work), verified by an impartial **evaluator** who scores the submission on a [0,1] scale. Settlement is a ledger transaction: the contractor receives `stake × score`; the remainder returns to the client. The contractor is a single named entity — a ghost or a group — making group evaluation a natural consequence of group formation rather than a special case. No new storage, resource type, or mechanic is introduced beyond what RFC-0023 already provides.

---

## Motivation

Several planned features need a scored commitment primitive: question/answer challenges, task bounties, proof-of-knowledge exchanges, and vendor challenges all share the same shape — one party offers resources for work, another performs it, a third certifies the result. Without a shared primitive each mechanic invents its own storage and settlement logic. A single eval contract protocol defines the shape once, and richer game modes (exam sessions, tournaments, duel formats) compose from it rather than hard-coding their own resource flows.

---

## Contract Model

### Roles

| Role | Description | Constraints |
|---|---|---|
| **Client** | Creates the contract; defines the work; stakes resources from their bag | Must hold sufficient stake at time of opening |
| **Contractor** | Performs the work; delivers a submission within the deadline | A ghost or a group (treated as a single named entity) |
| **Evaluator** | Reviews the submission; issues a verdict in [0,1] | Must be neither client nor contractor for the same contract |

Any ghost may fill any role subject to the constraints above. The protocol does not prescribe which ghosts fill these roles — that is an operational concern and a ghost implementation concern.

### Contract Terms

```
EvalContract {
  id:           ULID                  // assigned at creation
  client:       GhostId
  contractor:   GhostId | GroupId
  evaluator:    GhostId
  work:         opaque payload        // the challenge; interpreted by evaluator
  stake:        { resource: ResourceId, amount: integer }
  deadline:     Timestamp             // absolute; set by client
  opened_at:    Timestamp
}
```

The `work` payload is opaque to the protocol. It may be a question, a task specification, a proof request, or any other challenge format that the evaluator understands. The protocol does not constrain its shape.

### Lifecycle

```
Draft ──► Open ──► Accepted ──► Submitted ──► Evaluated ──► Settled
                │                          │
                └──► Declined              └──► Expired
                     (client refunded)          (deadline passed; v=0)
```

| Transition | Trigger | Effect |
|---|---|---|
| `Draft → Open` | Client opens the contract | Client's stake is debited to an escrow bag owned by the contract |
| `Open → Accepted` | Contractor explicitly accepts | Work window begins |
| `Open → Declined` | Contractor refuses | Escrow returns to client; contract closes |
| `Accepted → Submitted` | Contractor delivers submission before deadline | Submission recorded against the contract |
| `Accepted → Expired` | Deadline passes without submission | Contract moves directly to Settled with verdict 0 |
| `Submitted → Evaluated` | Evaluator issues verdict `v ∈ [0,1]` | Verdict recorded |
| `Evaluated → Settled` | Ledger executes settlement | (see below) |

### Settlement

Settlement is a pair of ledger transactions:

**Ghost contractor:**
```
escrow → contractor bag:  floor(stake × v)
escrow → client bag:      stake − floor(stake × v)
```

**Group contractor** (N beneficiaries recorded at acceptance):
```
per_share = floor(stake × v / N)
escrow → each beneficiary bag:  per_share          (N transactions)
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
| Contract opens | Debit `client bag → contract escrow bag` |
| Contract declines or cancels | Debit `contract escrow bag → client bag` |
| Contract expires (v=0) | Debit `contract escrow bag → client bag` |
| Contract settles (ghost) | Two debits: `escrow → contractor bag`, `escrow → client bag` (remainder) |
| Contract settles (group) | N+1 debits: `escrow → each beneficiary bag` (equal share), `escrow → client bag` (remainder) |

Contract state (lifecycle phase, submission, verdict) is stored as a `(:EvalContract)` node in Neo4j with edges to client, contractor, and evaluator. This is separate from the ledger, which only records resource movements.

---

## Scope Boundary

This RFC specifies the contract primitive only. The following are explicitly out of scope:

- **How the client generates work payloads** — question banks, task catalogs, domain weighting, difficulty tiers; those are client-ghost implementation concerns.
- **How evaluators are selected or qualified** — any ghost can be named as evaluator; credential systems are future work.
- **Evaluator incentives** — the evaluator does not receive a fee from this protocol; if one is desired it is a separate contract between client and evaluator.
- **Survival pressure mechanics** — token drain, leaderboard brackets, jackpot distributions; those are ledger-level scheduled transfers and are not coupled to this contract shape.
- **Group formation** — groups are an assumed primitive; this RFC does not specify how they are created, how members join, or how a group's bag is distributed internally.
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
