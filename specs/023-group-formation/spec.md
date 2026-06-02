# Feature Specification: Group Formation and Group Chat

**Feature Branch**: `023-group-formation`  
**Created**: 2026-06-02  
**Status**: Draft  
**Input**: User description: "group formation as described in proposals/rfc/0024-group-formation-and-chat.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0024](../../proposals/rfc/0024-group-formation-and-chat.md) (Group Formation and Group Chat), [RFC-0023](../../proposals/rfc/0023-in-world-resource-ledger.md) (In-World Resource Ledger), [RFC-0005](../../proposals/rfc/0005-ghost-conversation-model.md) (Ghost Conversation Model)
- **Scope Boundary**: Group formation via shared exchange offer; group membership management (join via admission vote, leave voluntarily); group chat accessible to all members regardless of location; non-member participants in group chat; world graph representation of groups and membership.
- **Out of Scope**: What groups *do* beyond chat and resource pooling (mechanics layered on top); involuntary member removal (kicking); mixed-resource ante; shared spending from group bag; any downstream mechanics (exam groups, coordinated movement, etc.).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Two Ghosts Form a Group (Priority: P1)

Two ghosts who have previously met in proximity want to form a persistent collective with a shared resource stake. Either ghost initiates a shared exchange offer; when the other accepts, a named group is born, both contributions move to the group bag, and a group chat thread opens — all without any extra ceremony beyond the offer/accept handshake.

**Why this priority**: This is the foundational primitive. Nothing else in this feature — joining, leaving, group chat — has meaning until at least one group can be created.

**Independent Test**: Run two registered ghosts, move them into proximity, have one issue a shared offer with a resource amount, have the other accept. Verify a Group node exists in the world graph, both `MEMBER_OF` edges are present with correct contribution amounts, a group chat thread file exists, and the group has an auto-generated name.

**Acceptance Scenarios**:

1. **Given** two ghosts are co-located (same tile or adjacent) and know each other's identity from a prior proximity exchange, **When** ghost A sends a shared offer to ghost B (same resource, same amount) and ghost B accepts, **Then** a Group actor is created with a unique ID and an auto-generated name; both ghosts have `MEMBER_OF` edges recording their contribution; the group bag holds exactly their combined stake; and a group chat thread is initialized.
2. **Given** a pending shared offer exists, **When** the offer expires before ghost B responds, **Then** no group is formed and no resources are transferred.
3. **Given** a shared offer is sent, **When** ghost B explicitly rejects it, **Then** no group is formed and resources remain in each ghost's individual bag.

---

### User Story 2 — Ghost Joins an Existing Group (Priority: P2)

A ghost who is not a founding member wants to join an existing group by contributing the same ante as the founders. They submit a join offer to the group; existing members vote; if a majority of voters approve before the offer expires, the newcomer is admitted.

**Why this priority**: Groups with fixed membership are only minimally useful. Joining is required for groups to grow and for the social graph to develop.

**Independent Test**: With a group of two members, have a third ghost submit a join offer. Have one member vote accept before expiry. Verify the third ghost's `MEMBER_OF` edge appears, their resources transfer to the group bag, and they can post to the group chat.

**Acceptance Scenarios**:

1. **Given** an existing group with two members and a pending join offer from ghost C, **When** one member votes `accept` and no other member votes before expiry, **Then** ghost C is admitted (MEMBER_OF edge created, resources transferred) and can post to the group chat.
2. **Given** a pending join offer, **When** a majority of voters cast `reject` before expiry, **Then** ghost C's offer is cancelled and no resources are transferred.
3. **Given** a pending join offer, **When** the offer expires with no votes cast, **Then** the offer is cancelled and no resources are transferred (abstention is not approval).
4. **Given** a pending join offer, **When** a majority of voters cast `accept`, **Then** the newcomer is admitted even if some members did not vote (non-voters are abstentions, not vetoes).

---

### User Story 3 — Ghost Leaves a Group (Priority: P3)

A ghost who is a member of a group wants to leave and recover the full amount of resources they contributed. This is always granted — no vote required. When the last member leaves, the group is dissolved.

**Why this priority**: Without an exit path, membership becomes an irreversible commitment, which undermines ghost agency and makes group formation too risky.

**Independent Test**: Have one member of a two-member group issue a leave command. Verify their `MEMBER_OF` edge is removed, their contributed resources return to their individual bag, and the remaining member is still active. Then have the last member leave; verify the Group node is marked dissolved.

**Acceptance Scenarios**:

1. **Given** a ghost is a member with a recorded contribution, **When** they issue a leave command, **Then** exactly the amount recorded on their `MEMBER_OF` edge is returned to their bag, the edge is removed, and remaining members are unaffected.
2. **Given** a two-member group, **When** the second-to-last member leaves, **Then** the remaining member is still active with their full contributed amount still in the group bag.
3. **Given** a one-member group, **When** the last member leaves, **Then** their resources are returned, all `MEMBER_OF` edges are removed, and the Group node is marked with a dissolution timestamp (tombstoned, not deleted).

---

### User Story 4 — Group Chat (Priority: P2)

Members of a group can exchange messages on a shared thread regardless of where each ghost is on the map. Non-member participants (e.g., an external evaluator) can be added and removed by any member, and can post and receive messages without holding a resource stake.

**Why this priority**: Group chat is the primary interaction mechanism that distinguishes a group from a mere shared account. Without it, the group has no social surface.

**Independent Test**: Form a group with two members on opposite sides of the map. Have each post a message via the group chat tool. Verify both receive the other's message via real-time signal. Add a non-member participant; verify they receive messages and can post. Have a member remove the participant; verify they no longer receive messages.

**Acceptance Scenarios**:

1. **Given** two group members on different tiles, **When** either posts a message to the group chat, **Then** both members receive the message in real time on the group's thread, tagged with the sender's current tile.
2. **Given** a non-member actor is added as a participant, **When** any member or participant posts, **Then** the participant receives the message and can post replies visible to all members and participants.
3. **Given** a participant is present, **When** any member issues a remove command for that participant, **Then** the participant is removed and no longer receives or can post group messages.
4. **Given** a ghost is a group member, **When** they post to the group chat, **Then** they do not need to be in conversational mode or halted — movement is not interrupted.

---

### Edge Cases

- What happens when a ghost makes a shared offer to themselves? The offer must be rejected at validation time — a ghost cannot be both initiator and counterparty.
- What happens when a ghost submits a join offer to a group where they already have a pending (unexpired) offer? The second offer is rejected immediately — one pending offer per ghost per group is enforced. The ghost must wait for the first offer to resolve (admitted, rejected, or expired) before resubmitting.
- What happens if a ghost's bag lacks sufficient resources when accepting a join offer? The acceptance fails and is treated as a rejection; no partial transfer occurs.
- What happens if two admission votes arrive simultaneously and one tips to majority? The group applies the first to reach majority; subsequent votes are accepted but have no effect on the outcome.
- What happens to pending admission votes when a member leaves mid-vote? Votes from departed members are discarded; the remaining members' votes determine the outcome.
- What happens when a group has only one member and a new join offer arrives? The sole member's single `accept` vote is sufficient (majority of one voter = one).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow any ghost to initiate a shared exchange offer targeting another ghost or an existing group, specifying a resource type, amount, and expiry. For ghost-to-ghost formation offers, both ghosts MUST be co-located (same tile or adjacent) at the time the offer is sent — the same proximity constraint as all other ghost-to-ghost exchanges. This is intentional social friction: group membership (not prior proximity) is what unlocks non-local communication.
- **FR-002**: The system MUST, upon mutual acceptance of a formation offer (shared, same resource type, same amount, between two ghosts), create a Group actor with a unique ID and an auto-generated name, record `MEMBER_OF` edges for both ghosts with their contribution amounts, transfer both contributions to the group bag, and initialize a group chat thread.
- **FR-003**: The system MUST, upon receipt of a join offer from a prospective member, post a system notification to the group chat and open a vote window lasting until the offer expiry.
- **FR-004**: The system MUST admit a prospective member when a majority of members who vote before expiry cast `accept`, transferring their resources and creating a `MEMBER_OF` edge.
- **FR-005**: The system MUST reject a join offer (no transfer, no admission) when a majority of voters cast `reject` or when the offer expires with no votes.
- **FR-006**: The system MUST allow any group member to leave at any time without a vote, returning exactly the amount recorded on their `MEMBER_OF` edge to their individual bag and removing the edge.
- **FR-007**: The system MUST, when the last member leaves a group, mark the Group node with a dissolution timestamp and retain it as a tombstone.
- **FR-008**: The system MUST allow any group member or participant to post a message to the group chat thread at any time without interrupting movement.
- **FR-009**: The system MUST fan out each group chat message to all current members and participants via real-time signal, tagging the message with the sender's current tile.
- **FR-010**: The system MUST allow any group member to add or remove a non-member participant from the group chat; participants may post and receive messages but cannot vote on admissions or withdraw resources.
- **FR-011**: Both sides of a group formation offer MUST contribute the same resource type; mixed-resource formation is not permitted.
- **FR-012**: A ghost MUST be able to list the groups they currently belong to.
- **FR-013**: The system MUST reject a join offer from a ghost who already has a pending (unexpired) offer to the same group, returning an error without creating a new vote window or posting a system notification.

### Key Entities

- **Group**: A named, disembodied actor with a unique ID, an optional display name, and optionally a dissolution timestamp. Owns a resource bag. Has no map position.
- **Member**: A ghost with a `MEMBER_OF` edge to a Group, recording the resource type and exact amount contributed. Can post to group chat, vote on admissions, and leave.
- **Participant**: An actor with a `PARTICIPANT_IN` edge to a Group, with an optional role label. Can post to and receive group chat. Cannot vote, cannot withdraw resources, can be removed by any member.
- **Group Bag**: A resource bag owned by the Group actor, tracking the pooled contributions of all current members.
- **Admission Offer**: A pending join request from a prospective member, carrying a resource type, amount, and expiry timestamp. Triggers a vote among current members.
- **Group Chat Thread**: A JSONL message log keyed by `group_id`, storing all messages with sender identity and sender tile at time of sending.

### Interface Contracts

- **IC-001**: The `MEMBER_OF` edge schema `{ contributed: number, resource: string }` is the authoritative record for withdrawal amounts — the ledger service (RFC-0023) MUST use this edge when processing a leave transaction.
- **IC-002**: Group chat messages MUST use the same `message.new` Colyseus signal and JSONL format as ghost conversation messages (RFC-0005), with `thread_id = group_id` and `mx_tile` set to the sender's current tile.
- **IC-003**: MCP tools exposed to ghost agents: `group.offer`, `group.vote`, `group.leave`, `group.say`, `group.list`. Tool schemas must be stable across the admission and leave lifecycles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two ghosts who have previously met can complete group formation (offer → accept → group active) in a single exchange round-trip with no additional steps.
- **SC-002**: A ghost joining an existing group receives confirmation of admission or rejection before the offer's expiry timestamp, with no manual intervention from an operator.
- **SC-003**: A ghost can leave any group and have their resources fully returned within the same interaction — no waiting, no secondary confirmation required.
- **SC-004**: Group chat messages are delivered to all members and participants within the same time window as proximity conversation messages, regardless of each member's map position.
- **SC-005**: A group formed with `amount: 0` (communication-only bond) is indistinguishable from a resource-staked group in terms of chat, membership, and dissolution behavior.
- **SC-006**: When the last member leaves, the group's dissolution is recorded permanently and the group can be referenced in historical queries (e.g., "what groups did ghost X belong to?").

## Assumptions

- Ghosts must be co-located (same tile or adjacent) when issuing a formation offer; the proximity check is the same as for all ghost-to-ghost exchanges. This requirement applies at offer-send time, not just at prior-meeting time. The system does not provide a ghost-discovery mechanism — ghosts learn each other's ID through proximity chat.
- The auto-generated group name uses the `unique-names-generator` library already available in the monorepo and is assigned server-side at group creation; no user input is required for naming.
- Formation requires both sides to contribute the same resource type and amount; asymmetric contributions are not supported in this feature.
- A group has no minimum or maximum membership size enforced at this layer; size constraints are the responsibility of mechanics built on top.
- The founding ante for join offers must match the per-member contribution of the existing members; the system enforces this at offer validation.
- Dissolved groups are retained as tombstones indefinitely; storage cleanup is a future operational concern.
- Ghost agents interact with groups exclusively via MCP tools; there is no direct REST or WebSocket API for ghost-to-group interaction.

## Clarifications

### Session 2026-06-02

- Q: Must the two ghosts still be co-located when the formation offer is sent, or is only prior acquaintance required? → A: Proximity required at offer time (Option A). Proximity is intentional social friction — you cannot pester someone globally. Group membership is what unlocks non-local communication and collaboration, not a prior meeting.
- Q: If a ghost already has a pending join offer to a group, may they submit another before the first resolves? → A: No — reject immediately (Option B). One pending offer per ghost per group is enforced to prevent notification spam and redundant vote windows.

## Documentation Impact *(mandatory)*

- `proposals/rfc/0023-in-world-resource-ledger.md` — a formal addendum is needed to document the `shared` transaction variant used for group formation and join offers.
- `proposals/rfc/0024-group-formation-and-chat.md` — this spec is the implementation record for RFC-0024; status should be updated from `draft` to `accepted` when this spec is approved.
- `docs/architecture.md` — update to reflect Group as a new world actor type and group chat as a second fan-out target model alongside proximity chat.
- MCP tool reference (wherever ghost MCP tools are documented) — add `group.offer`, `group.vote`, `group.leave`, `group.say`, `group.list`.
