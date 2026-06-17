# IC-001: GroupService Interface

**Package**: `server/world-api`  
**Consumer**: `mcp-server.ts` (MCP tool handlers), `ProposalService` (formation trigger)  
**Related**: [IC-002 Group Chat Message](ic-group-chat-message.md), [IC-003 MCP Group Tools](ic-mcp-group-tools.md)

## Interface

```ts
export interface GroupServiceOps {
  /**
   * Create a new group from a completed shared formation offer.
   * Called by ProposalService.agree() when shared=true.
   * Mints (:Group) node, MEMBER_OF edges, group bag, and initializes the chat thread.
   */
  createGroup(params: {
    ghostA: ActorId;
    ghostB: ActorId;
    resource: ResourceId;
    amount: number;       // per-member contribution (0 is valid)
    formationTxId: string; // ledger tx id already committed
  }): Effect.Effect<{ groupId: GroupId; name: string }, GroupPersistenceError>;

  /**
   * Open an admission vote window for a prospective member.
   * Posts a system message to the group chat.
   * Returns offerId and expiresAt.
   */
  proposeJoin(params: {
    groupId: GroupId;
    prospectId: ActorId;
    resource: ResourceId;
    amount: number;
    expiresAt: number;  // ms epoch
  }): Effect.Effect<
    { offerId: string; expiresAt: number },
    GroupNotFound | GroupDissolved | GroupAntesMismatch
  >;

  /**
   * Record a member vote on a pending admission offer.
   * Resolves the offer immediately if majority reached.
   */
  vote(params: {
    offerId: string;
    voterId: ActorId;
    decision: "accept" | "reject";
  }): Effect.Effect<
    { resolved: boolean; outcome: "admitted" | "rejected" | "pending" },
    GroupOfferNotFound | GroupOfferExpired | GroupNotMember
  >;

  /**
   * Process all expired vote windows. Called by a background timer.
   * Resolves each window by majority-of-voters rule.
   */
  resolveExpiredOffers(): Effect.Effect<void, never>;

  /**
   * Remove a member from the group and return their contributed resources.
   * Always succeeds if the caller is a member.
   * Dissolves the group if this is the last member.
   */
  leave(params: {
    groupId: GroupId;
    ghostId: ActorId;
    leaveTxId: string;  // ledger tx id already committed
  }): Effect.Effect<
    { returned: { resource: ResourceId; amount: number }; dissolved: boolean },
    GroupNotFound | GroupNotMember
  >;

  /**
   * Add a non-member actor as a participant (PARTICIPANT_IN edge).
   */
  addParticipant(params: {
    groupId: GroupId;
    actorId: ActorId;
    role: string;
    requesterId: ActorId;  // must be a member
  }): Effect.Effect<void, GroupNotFound | GroupNotMember>;

  /**
   * Remove a participant. Any member may remove any participant.
   */
  removeParticipant(params: {
    groupId: GroupId;
    actorId: ActorId;
    requesterId: ActorId;  // must be a member
  }): Effect.Effect<void, GroupNotFound | GroupNotMember | GroupNotParticipant>;

  /**
   * List groups the ghost currently belongs to.
   */
  listMemberships(ghostId: ActorId): Effect.Effect<GroupSummary[], never>;

  /**
   * Post a message to the group chat thread.
   * Fan-out to all current members + participants via WorldBridgeService.
   * Does NOT require conversational mode. Does NOT check location.
   */
  groupSay(params: {
    groupId: GroupId;
    senderId: ActorId;
    senderName: string;
    content: string;
    senderTile: string;  // H3 cell — may be stale; best-effort
  }): Effect.Effect<
    { messageId: string; mx_listeners: ActorId[] },
    GroupNotFound | GroupNotMemberOrParticipant | GroupChatStoreError
  >;
}

export class GroupService extends Context.Tag("aie-matrix/GroupService")<
  GroupService,
  GroupServiceOps
>() {}
```

## Error Types (`server/world-api/src/group-errors.ts`)

```ts
export class GroupNotFound extends Data.TaggedError("GroupError.NotFound")<{ groupId: string }> {}
export class GroupDissolved extends Data.TaggedError("GroupError.Dissolved")<{ groupId: string }> {}
export class GroupNotMember extends Data.TaggedError("GroupError.NotMember")<{ groupId: string; actorId: string }> {}
export class GroupNotParticipant extends Data.TaggedError("GroupError.NotParticipant")<{ groupId: string; actorId: string }> {}
export class GroupNotMemberOrParticipant extends Data.TaggedError("GroupError.NotMemberOrParticipant")<{ groupId: string; actorId: string }> {}
export class GroupAntesMismatch extends Data.TaggedError("GroupError.AntesMismatch")<{ expected: number; got: number; resource: string }> {}
export class GroupOfferNotFound extends Data.TaggedError("GroupError.OfferNotFound")<{ offerId: string }> {}
export class GroupOfferExpired extends Data.TaggedError("GroupError.OfferExpired")<{ offerId: string }> {}
export class GroupPersistenceError extends Data.TaggedError("GroupError.Persistence")<{ message: string }> {}
export class GroupChatStoreError extends Data.TaggedError("GroupError.ChatStore")<{ message: string }> {}
```

## Implementations Required

| Implementation | Purpose | Test tier |
|---|---|---|
| `GroupServiceInMemory` | Unit tests; PoC / dev | Unit (no live services) |
| `GroupServiceLive` | Production (Neo4j-backed) | Integration (Neo4j required) |
