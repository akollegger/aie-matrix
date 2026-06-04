import { Context, Effect } from "effect";
import type { ActorId } from "@aie-matrix/shared-types";
import type { GroupId, GroupSummary } from "@aie-matrix/shared-types";
import type {
  GroupAntesMismatch,
  GroupChatStoreError,
  GroupDissolved,
  GroupDuplicateOffer,
  GroupNotFound,
  GroupNotMember,
  GroupNotMemberOrParticipant,
  GroupNotParticipant,
  GroupOfferExpired,
  GroupOfferNotFound,
  GroupPersistenceError,
} from "./group-errors.js";

export interface GroupServiceOps {
  /**
   * Create a new group from a completed shared formation offer.
   * Called after the ledger transaction is committed.
   */
  createGroup(params: {
    groupId: GroupId;
    ghostA: ActorId;
    ghostB: ActorId;
    resource: string;
    amount: number;
    formationTxId: string;
  }): Effect.Effect<{ groupId: GroupId; name: string }, GroupPersistenceError>;

  /**
   * Open an admission vote window for a prospective member.
   * Posts a system message to the group chat.
   */
  proposeJoin(params: {
    groupId: GroupId;
    prospectId: ActorId;
    resource: string;
    amount: number;
    expiresAt: number;
  }): Effect.Effect<
    { offerId: string; expiresAt: number },
    GroupNotFound | GroupDissolved | GroupAntesMismatch | GroupDuplicateOffer
  >;

  /**
   * Record a member vote on a pending admission offer.
   * Resolves the offer immediately if majority is reached.
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
   * Resolve all vote windows that have passed their expiry timestamp.
   * Called by a background timer.
   */
  resolveExpiredOffers(): Effect.Effect<void, never>;

  /**
   * Remove a member and return their contributed resources.
   * Always succeeds if the caller is a current member.
   * Dissolves the group when the last member leaves.
   */
  leave(params: {
    groupId: GroupId;
    ghostId: ActorId;
    leaveTxId: string;
  }): Effect.Effect<
    { returned: { resource: string; amount: number }; dissolved: boolean },
    GroupNotFound | GroupNotMember | GroupPersistenceError
  >;

  /**
   * Add a non-member actor as a participant (PARTICIPANT_IN edge).
   * Any member may call this.
   */
  addParticipant(params: {
    groupId: GroupId;
    actorId: ActorId;
    role: string;
    requesterId: ActorId;
  }): Effect.Effect<void, GroupNotFound | GroupNotMember | GroupPersistenceError>;

  /**
   * Remove a participant. Any member may call this.
   */
  removeParticipant(params: {
    groupId: GroupId;
    actorId: ActorId;
    requesterId: ActorId;
  }): Effect.Effect<void, GroupNotFound | GroupNotMember | GroupNotParticipant | GroupPersistenceError>;

  /** List groups the ghost currently belongs to. */
  listMemberships(ghostId: ActorId): Effect.Effect<GroupSummary[], never>;

  /**
   * Return the current member list for a group.
   * Used by EvalContractService to freeze beneficiaries at acceptance.
   */
  getGroupMembers(groupId: GroupId): Effect.Effect<ActorId[], GroupNotFound>;

  /**
   * Post a message to the group chat thread.
   * Fan-out to all current members + participants.
   * Does not require conversational mode or location.
   */
  groupSay(params: {
    groupId: GroupId;
    senderId: ActorId;
    senderName: string;
    content: string;
    senderTile: string;
  }): Effect.Effect<
    { messageId: string; mx_listeners: ActorId[] },
    GroupNotFound | GroupDissolved | GroupNotMemberOrParticipant | GroupChatStoreError
  >;
}

export class GroupService extends Context.Tag("aie-matrix/GroupService")<
  GroupService,
  GroupServiceOps
>() {}
