# Data Model: Group Formation and Group Chat

## Shared Types (`shared/types/src/group.ts`)

```ts
/** Unique group identifier — ULID. */
export type GroupId = string;

/** An admission offer from a prospective member to a group. */
export interface AdmissionOffer {
  offerId: string;          // ULID — idempotency key for the ledger commit
  groupId: GroupId;
  prospectId: ActorId;      // ghost making the offer
  resource: ResourceId;
  amount: number;           // must match per-member ante; 0 is valid
  expiresAt: number;        // ms epoch
}

/** A single vote on an admission offer. */
export interface AdmissionVote {
  voterId: ActorId;
  decision: "accept" | "reject";
  ts: number;               // ms epoch
}

/** Live in-memory vote window — not persisted. */
export interface VoteWindow {
  offer: AdmissionOffer;
  votes: AdmissionVote[];
}

/** Summary of a group the ghost belongs to. */
export interface GroupSummary {
  groupId: GroupId;
  name: string;
  memberCount: number;
  myContribution: { resource: ResourceId; amount: number };
}

/** A posted group chat message. */
export interface GroupMessage {
  thread_id: GroupId;
  message_id: string;       // ULID
  timestamp: string;        // ISO-8601 worldNow()
  role: "user";
  name: string;             // sender display name
  content: string;
  mx_tile: string;          // sender's H3 cell at send time
  mx_listeners: ActorId[];  // members + participants at send time
}
```

---

## Neo4j Schema

### New Node

```
(:Group {
  group_id:     string,   // ULID — primary key
  name:         string,   // unique-names-generator output; mutable (display only)
  created_at:   integer,  // ms epoch
  dissolved_at: integer | null  // set when last member leaves; null while active
})
```

### New Relationships

```
(:Ghost)-[:MEMBER_OF {
  contributed: integer,   // exact amount placed in the group bag
  resource:    string     // resource type id (e.g. "trust")
}]->(:Group)

(:Actor)-[:PARTICIPANT_IN {
  role: string            // e.g. "inquisitor", "observer"
}]->(:Group)

(:Group)-[:OWNS]->(:Bag)  // group bag — same :Bag node type used by :Ghost
```

### New Indexes / Constraints

```cypher
CREATE CONSTRAINT group_id_unique IF NOT EXISTS
  FOR (g:Group) REQUIRE g.group_id IS UNIQUE;
```

### Relationship to Existing Schema

- `(:Bag)` is the existing resource bag node. No structural change required — groups own a bag exactly as ghosts do.
- `(:LedgerEntry)` chains already support multi-actor `actors[]` fields. Formation and join commits carry both `from` and `to` actors in that field — no ledger schema change required.
- `(:LiveSession)` subgraph is extended with `(:Group)` nodes exactly as it was extended with `(:CalendarEvent)` in spec-021.

---

## In-Memory State (`GroupService`)

```ts
// All active groups, keyed by group_id
type GroupIndex = Map<GroupId, GroupRecord>

interface GroupRecord {
  groupId: GroupId;
  name: string;
  // In-memory member cache — authoritative copy is the Neo4j MEMBER_OF edges
  members: Map<ActorId, { resource: ResourceId; contributed: number }>;
  // In-memory participant list — authoritative copy is PARTICIPANT_IN edges
  participants: Map<ActorId, { role: string }>;
  dissolvedAt: number | null;
}

// Pending admission vote windows, keyed by offerId
type VoteWindows = Map<string, VoteWindow>
```

---

## State Transitions

```
Ghost A sends group.offer (shared, ghost B as counterparty)
  └─► ProposalService.propose({ ..., shared: true })
        ├─ Validates same resource type both sides
        ├─ Creates pending shared proposal in memory
        └─ Returns proposalId + expiresAt

Ghost B accepts (group.offer agree path)
  └─► ProposalService.agree(proposalId, ghostB)
        ├─ LedgerService.commit(formation tx — both contributions → new group bag)
        ├─ GroupService.createGroup(ghostA, ghostB, contribution)
        │     ├─ Mint (:Group) node in Neo4j with unique-names-generator name
        │     ├─ Write MEMBER_OF edges for both ghosts
        │     ├─ Create group bag (OWNS edge)
        │     └─ Initialize {group_id}.jsonl thread
        └─ Returns { groupId, name }

Ghost C sends group.offer (shared, group X as counterparty)
  └─► GroupService.proposeJoin(groupId, ghostC, resource, amount, expiresAt)
        ├─ Validates amount matches per-member ante
        ├─ Creates VoteWindow in memory
        ├─ Posts system message to group chat: "ghost_C has offered to join. Vote before <expiry>."
        └─ Returns offerId + expiresAt

Member votes
  └─► GroupService.vote(offerId, voterId, decision)
        ├─ Appends AdmissionVote to VoteWindow
        └─ Checks majority: if majority accept → GroupService.admitMember()
                                if majority reject → GroupService.rejectOffer()

VoteWindow expires (timer fires)
  └─► GroupService.resolveExpiredOffer(offerId)
        ├─ If majority of cast votes = accept → admitMember()
        └─ Otherwise → rejectOffer()

admitMember(offerId)
  └─► LedgerService.commit(join tx — ghostC contribution → group bag)
        ├─ GroupService creates MEMBER_OF edge for ghostC in Neo4j
        ├─ Updates in-memory GroupRecord.members
        └─ Posts system message to group chat: "ghost_C has joined."

Ghost A issues group.leave
  └─► GroupService.leave(groupId, ghostA)
        ├─ LedgerService.commit(leave tx — ghostA contribution ← group bag)
        ├─ Removes MEMBER_OF edge from Neo4j
        ├─ Updates GroupRecord.members
        ├─ If members empty → GroupService.dissolveGroup(groupId)
        │     └─ Sets dissolved_at on (:Group) node
        └─ Returns { returned: { resource, amount } }
```

---

## Formation Transaction Shape (Ledger)

A group formation commit extends the existing `Transaction` shape with no structural changes — it uses the same `Transfer[]` format with the group bag as the destination actor:

```ts
// Formation transaction
{
  id: ulid(),
  cause: "group.form",
  actors: [ghostA_id, ghostB_id],
  transfers: [
    { resource: "trust", qty: 10, from: ghostA_id, to: group_bag_id },
    { resource: "trust", qty: 10, from: ghostB_id, to: group_bag_id },
  ],
  ts: Date.now(),
}

// Join transaction
{
  id: ulid(),
  cause: "group.join",
  actors: [ghostC_id, group_id],
  transfers: [
    { resource: "trust", qty: 10, from: ghostC_id, to: group_bag_id },
  ],
  ts: Date.now(),
}

// Leave transaction
{
  id: ulid(),
  cause: "group.leave",
  actors: [ghostA_id],
  transfers: [
    { resource: "trust", qty: 10, from: group_bag_id, to: ghostA_id },
  ],
  ts: Date.now(),
}
```

The group bag is identified by a dedicated `ActorId` derived from `group_id` (e.g., `"group:{group_id}"`). This lets `LedgerService` track the group bag balance in its existing `BagCache` without schema changes.
