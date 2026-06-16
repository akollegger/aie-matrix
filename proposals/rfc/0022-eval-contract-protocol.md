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

> **Superseded by `[:Grants { role: qty } | (itemRef)]` gram syntax (2026-06-07, branch 027-resource-lifecycle)**
>
> The `resourceGrants` field on `catalog.json` and the `ResourceType`/`CatalogResourceGrant` types
> have been removed. The initial-resource problem is now solved at the **map level** instead.

### Motivation

Eval contracts require the client ghost to hold resources before it can stake them. Ghost agents that act as clients need a reliable source of initial resources.

### Current design (027+)

Initial item grants are declared directly in the `.map.gram` file using per-item `Grants` blocks — an entity-component pattern where grant data is attached to item type nodes:

```gram
(goldCoin:ItemType:GoldCoin { name: "Gold Coin", takeable: true })

[:Grants { attendee: 10, funder: 500 } | (goldCoin)]
```

Multiple items and roles compose naturally across blocks:

```gram
[:Grants { attendee: 1, funder: 5 } | (brassKey)]
[:Grants { attendee: 10, funder: 500 } | (goldCoin)]
```

At ghost first-connect the world-api reads the ghost's `role` from its A2A agent card metadata, aggregates all `Grants` blocks for that role, and commits one ledger transfer (`world → ghostId`) per grant item. Subsequent reconnects are idempotent — the transaction ID is deterministically derived from `SHA-256(ghostId:role:itemRef)`.

### Key differences from the original catalog-based design

| Old (catalog.json) | New (map gram) |
|---|---|
| `resourceGrants` field on each `CatalogEntry` | `[:Grants { role: qty } \| (itemRef)]` blocks in `.map.gram` |
| `ResourceType` registry — every resource pre-declared | Any string is a valid `itemRef`; no registry needed |
| `class: "conserved" \| "monotonic"` | Only conserved resources exist; monotonic class removed |
| Coupled to agent catalog (operator-controlled per agent) | Coupled to map (operator-controlled per session) |

This resolves the initial-resource acquisition problem while keeping resource identity fully map-driven rather than catalog-driven.

---

## Addendum: Structured Problem and Answer Schema (2026-06-15)

> **Superseded by [RFC-0027](0027-structured-exam-artifact.md) (Structured Exam Artifact Format, 2026-06-15)**
>
> The artifact content no longer belongs in the contract. The contract holds `artifactRef` — a SHA-256 hash of the exam artifact — rather than the artifact itself. The schema for problem types, rubric types, answer types, and verdict derivation is now defined in RFC-0027. Hashing is over the artifact bytes as-is; byte-reproducibility is a generation-time quality attribute rather than a canonicalization problem (see RFC-0027 §R8 note).

### Motivation

The RFC defines `request` and `submission` as opaque strings, intentionally leaving their structure to the client and evaluator. In practice this produces two problems:

1. **Evaluators cannot auto-grade.** Without a typed rubric in the request, the evaluator has no machine-readable answer key or scoring criteria. The broker currently issues `verdict: 1.0` for every non-null submission regardless of content — participation credit, not evaluation.

2. **Contractors cannot know what form to respond in.** An opaque `request` gives no signal about whether to submit prose, a selected option, a number, or code. The contractor must rely on out-of-band channel messages to understand the expected answer format.

This addendum defines a versioned JSON schema for both fields. The protocol lifecycle and settlement math are unchanged.

### Problem Schema (`request` payload)

```typescript
interface ContractRequest {
  schema_version: "1";
  problems: Problem[];        // one or more; single-problem is the common case
}

type Problem =
  | OpenEndedProblem
  | MultipleChoiceProblem
  | ShortAnswerProblem
  | NumericalProblem;

interface ProblemBase {
  id: string;                 // stable ref within contract, e.g. "q1", "q2"
  prompt: string;             // the question or task shown to the contractor
  weight?: number;            // default 1; relative weight for multi-problem scoring
}

interface OpenEndedProblem extends ProblemBase {
  type: "open_ended";
  rubric?: ModelGradedRubric | HumanRubric;
}

interface MultipleChoiceProblem extends ProblemBase {
  type: "multiple_choice";
  options: Array<{ id: string; text: string }>;
  rubric: ExactMatchRubric;   // correct option ids
}

interface ShortAnswerProblem extends ProblemBase {
  type: "short_answer";
  rubric: ExactMatchRubric;   // acceptable answer strings (case-insensitive)
}

interface NumericalProblem extends ProblemBase {
  type: "numerical";
  rubric: NumericalRubric;
}
```

### Rubric Types

```typescript
type Rubric =
  | ExactMatchRubric
  | NumericalRubric
  | ModelGradedRubric
  | HumanRubric;

interface ExactMatchRubric {
  kind: "exact_match";
  correct: string[];          // for multiple_choice: option ids; for short_answer: acceptable strings
}

interface NumericalRubric {
  kind: "numerical";
  correct: number;
  tolerance: number;          // |submitted − correct| ≤ tolerance scores 1.0
}

interface ModelGradedRubric {
  kind: "model_graded";
  criteria: string;           // scoring instructions for the evaluator LLM
  reference?: string;         // optional reference answer
}

interface HumanRubric {
  kind: "human";
  criteria: string;           // scoring guide shown to the human evaluator
}
```

### Answer Schema (`submission` payload)

```typescript
interface ContractSubmission {
  schema_version: "1";
  answers: Answer[];
}

interface Answer {
  problem_id: string;         // references Problem.id
  value: string | number;     // string for open_ended / multiple_choice / short_answer; number for numerical
}
```

### Verdict Derivation

For a single-problem contract the evaluator issues the verdict directly:

| Rubric kind | How verdict is computed |
|---|---|
| `exact_match` | 1.0 if `value` ∈ `correct` (case-insensitive for short_answer), else 0.0 |
| `numerical` | 1.0 if `|value − correct| ≤ tolerance`, else 0.0 |
| `model_graded` | Evaluator LLM returns `v ∈ [0,1]` using `criteria` and optional `reference` |
| `human` | Evaluator ghost issues `v ∈ [0,1]` using `criteria` as a guide |

For a multi-problem contract the overall verdict is the **weighted mean** of per-problem scores, with weights normalized to sum to 1:

```
verdict = Σ(problem_score_i × weight_i) / Σ(weight_i)
```

The evaluator must issue one verdict for the whole contract. Per-problem scores are an implementation detail of the evaluator, not a protocol concept.

### Presentation vs. Payload

The full `request` — including the rubric — is stored in the contract record and is accessible to anyone who can read the contract (currently: client, contractor, evaluator). For auto-gradable types where the rubric contains an answer key (`exact_match`, `numerical`), the client bears responsibility for not exposing correct answers to the contractor before submission. The conventional pattern is for the client to present only `prompt` via the `say()` channel, not the full `request` payload.

Rubric confidentiality at the protocol level (server-enforced field visibility) is Open Question 7 below.

### Legacy Handling

A `request` string that does not parse as `ContractRequest` with `schema_version: "1"` is treated as **unstructured** (pre-schema). Evaluators may apply any verdict to unstructured contracts; the protocol does not constrain them.

### Broker Migration Example

Current broker `request`:
```json
{ "question": "What's one thing you wish AI systems were better at?" }
```

Migrated to structured schema:
```json
{
  "schema_version": "1",
  "problems": [{
    "id": "q1",
    "type": "open_ended",
    "prompt": "What's one thing you wish AI systems were better at?",
    "rubric": { "kind": "human", "criteria": "Any substantive, non-empty response earns full credit." }
  }]
}
```

Corresponding `submission`:
```json
{
  "schema_version": "1",
  "answers": [{ "problem_id": "q1", "value": "I wish AI was better at knowing what it doesn't know." }]
}
```

With a `human` rubric and the stated criteria, the broker may continue to issue `verdict: 1.0` for any non-empty answer — but the rubric now makes that policy explicit and machine-readable rather than implicit.

### New Open Question

**7. Rubric confidentiality.** For `exact_match` and `numerical` problems, the rubric contains the correct answers. Should the world-api enforce that the contractor can only read the `prompt` field of each problem (not `rubric`) while the contract is in `Open` or `Accepted` state? If so, this requires a server-side projection on the contract read path, and the `getContract` service method must become role-aware.

---

## Addendum: Progressive Disclosure and Commit-Reveal (2026-06-15)

### Motivation

Multi-stage problems — where follow-up questions build on earlier answers, or where hints are revealed incrementally — require the client to withhold content from the contractor at the outset. Similarly, the evaluator's rubric must not be visible to the contractor before submission. Simply omitting this content from the initial artifact breaks verifiability: a client could craft different follow-up questions for different contractors, or adjust the rubric after seeing a submission.

A commit-reveal scheme resolves this: the client (and evaluator) commit to withheld content by hash at proposal time, then reveal the plaintext through a private channel at the appropriate moment. The chain proves the content was fixed before work began; the contractor verifies the received content matches the committed hash.

### Disclosure Commitments

The `contract.proposed` ledger event (RFC-0023 Verifiable Event Log addendum) carries two artifact commitments:

- **`artifactRef`** — hash of the content shared with the contractor at the outset: the initial prompt(s), visible immediately upon acceptance
- **`disclosureRefs`** — an ordered array of hash commitments to withheld content, each to be revealed at a later point in the work window

```typescript
disclosureRefs: string[]  // hex(SHA-256(withheld content)), one per withheld block, in revelation order
```

The client commits to all entries at proposal time. The chain records these hashes before the contractor has accepted — the client cannot alter them after `contract.proposed` is appended, even before agreement. Position in the array is the only identity a disclosure needs: the nth `disclosure.sent` event corresponds to `disclosureRefs[n]`.

### Disclosure Flow

When a stage is triggered — by the contractor submitting a prior answer, a calendar event, or an evaluator decision — the holder sends the plaintext directly to the recipient via the conversation channel (`say()`). The recipient verifies locally:

```
SHA-256(received plaintext) == disclosureRefs[n].hash   →   match confirms authenticity
```

The ledger records only a receipt (`"disclosure.sent"` event: contractId, disclosureIndex, recipientId). The plaintext never appears in the ledger. Future contractors and bystanders see that a disclosure occurred and to whom, but not what was revealed.

### Post-Settlement Audit

After settlement, fairness of evaluation can be verified out-of-band: the evaluator produces the rubric plaintext to an auditor, who hashes it against the committed `disclosureRefs` entry. The chain proves the rubric hash predates the contractor's `contract.submitted` timestamp; the evaluator cannot retroactively alter it. Audit is voluntary and directed — withholding the rubric post-settlement is a reputational matter, not a protocol violation.

Open Question 7 (rubric confidentiality) is partially addressed by this scheme: the rubric is withheld via `disclosureRefs` rather than server-side field projection. A server projection is still worth considering for `exact_match` and `numerical` rubrics embedded in `artifactRef`, where the commitment hash alone does not prevent a contractor from reading the answer key out of the contract record.

### Design Consequence: Contractor Transparency

Because `contract.proposed` is a public ledger event, any contractor can compare their proposal against other contracts sharing the same `artifactRef`:

| Observation | Implication |
|---|---|
| Same `artifactRef`, same `disclosureRefs` hashes | Identical terms — level playing field |
| Same `artifactRef`, different `disclosureRefs` hashes | Client committed to different follow-up content or rubric per contractor — asymmetric treatment detectable without revealing any content |
| Same `artifactRef`, different `stakeAmount` | Different pay for identical base work |

Contractors compare only hashes — no content is exposed. The fairness of terms becomes transparent without revealing the work itself. This creates social pressure toward consistency: a client who offers different progressive questions to different contractors for the same base prompt is detectable by any contractor who compares notes on the ledger.

Note that identical `disclosureRefs` hashes across contracts does not prevent holders from revealing disclosures at different times — timing is not committed to in the proposal and is addressed separately in the temporality addendum (forthcoming).

---

## Addendum: EvalContract Schema Extension for Exam Contracts (2026-06-16)

**Feature**: 031-exam-npcs

The `EvalContract` type gains two nullable fields for the commit-reveal exam protocol:

| Field | Type | Description |
|---|---|---|
| `artifactRef` | `string \| null` | SHA-256 hex of the prompt-only exam artifact (concatenated markdown+frontmatter snippets, ordered by problem id). Committed at `openContract`. `null` for non-exam (broker) contracts. |
| `disclosureRef` | `string \| null` | SHA-256 hex of the full exam artifact with answer key. Committed at `openContract`. `null` for non-exam (broker) contracts. |

These fields are committed at `openContract` time, before the contractor accepts, using the RFC-0022 commit-reveal guarantee. The `disclosureRef` content is never written to the ledger — the quizmaster reveals it via `say()` directly to the contractor after settlement.

### Settlement formula

Settlement is proportional to the verdict score, rounded up:

```
contractorPayment = ceil(verdict × stakeAmount)
clientRefund = stakeAmount - contractorPayment
```

The existing `evaluateContract` action handles this. The quizmaster passes `verdict ∈ [0,1]` computed from the per-question rubric.

### Submission field

The existing `submission: string | null` field carries the full exam text — all per-question markdown+frontmatter snippets with both `correct:` and `answer:` fields filled in — when the quizmaster calls `submitContract`. This is the quizmaster's record of contestant answers (MVP trust tier: the quizmaster is assumed honest in recording answers).

### Backward compatibility

Both new fields are nullable and default to `null`. Existing broker contracts pass `openContract` without `artifactRef`/`disclosureRef`; they receive `null` in both fields. No existing contract state machine transitions are affected.
