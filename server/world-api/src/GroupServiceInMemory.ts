import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";
import type { ActorId, GroupId, GroupSummary, VoteWindow } from "@aie-matrix/shared-types";
import {
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
} from "./group-errors.js";
import { GroupService, type GroupServiceOps } from "./GroupService.js";

interface GroupRecord {
  groupId: GroupId;
  name: string;
  members: Map<ActorId, { resource: string; contributed: number }>;
  participants: Map<ActorId, { role: string }>;
  dissolvedAt: number | null;
}

interface ChatMessage {
  thread_id: GroupId;
  message_id: string;
  timestamp: string;
  role: "user" | "system";
  name: string;
  content: string;
  mx_tile: string;
  mx_listeners: ActorId[];
}

function generateGroupName(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: " ",
    style: "capital",
  });
}

export function makeGroupServiceInMemory(
  onMessage?: (msg: ChatMessage) => void,
): GroupServiceOps {
  const groups = new Map<GroupId, GroupRecord>();
  const voteWindows = new Map<string, VoteWindow>();
  const chatLog = new Map<GroupId, ChatMessage[]>();

  function getGroup(groupId: GroupId): GroupRecord | undefined {
    return groups.get(groupId);
  }

  function postSystemMessage(groupId: GroupId, content: string, listeners: ActorId[]): void {
    const msg: ChatMessage = {
      thread_id: groupId,
      message_id: ulid(),
      timestamp: new Date().toISOString(),
      role: "system",
      name: "system",
      content,
      mx_tile: "",
      mx_listeners: listeners,
    };
    if (!chatLog.has(groupId)) chatLog.set(groupId, []);
    chatLog.get(groupId)!.push(msg);
    onMessage?.(msg);
  }

  function resolveVoteWindow(offerId: string): void {
    const window = voteWindows.get(offerId);
    if (!window) return;
    const { offer, votes } = window;
    const group = groups.get(offer.groupId);
    if (!group) {
      voteWindows.delete(offerId);
      return;
    }
    const acceptCount = votes.filter(v => v.decision === "accept").length;
    const rejectCount = votes.filter(v => v.decision === "reject").length;
    const totalVoted = acceptCount + rejectCount;
    const admitted = totalVoted > 0 && acceptCount > rejectCount;
    if (admitted) {
      group.members.set(offer.prospectId, { resource: offer.resource, contributed: offer.amount });
      const memberList = [...group.members.keys(), ...group.participants.keys()];
      postSystemMessage(offer.groupId, `${offer.prospectId} has joined the group.`, memberList);
    }
    voteWindows.delete(offerId);
  }

  return {
    createGroup({ groupId, ghostA, ghostB, resource, amount, formationTxId: _ }) {
      return Effect.sync(() => {
        const name = generateGroupName();
        const members = new Map<ActorId, { resource: string; contributed: number }>();
        members.set(ghostA, { resource, contributed: amount });
        members.set(ghostB, { resource, contributed: amount });
        const record: GroupRecord = {
          groupId,
          name,
          members,
          participants: new Map(),
          dissolvedAt: null,
        };
        groups.set(groupId, record);
        chatLog.set(groupId, []);
        return { groupId, name };
      });
    },

    proposeJoin({ groupId, prospectId, resource, amount, expiresAt }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (group.dissolvedAt !== null) return yield* Effect.fail(new GroupDissolved({ groupId }));

        // Validate ante matches existing members
        const memberContributions = [...group.members.values()];
        if (memberContributions.length > 0) {
          const expectedAnte = memberContributions[0]!.contributed;
          const expectedResource = memberContributions[0]!.resource;
          if (resource !== expectedResource || amount !== expectedAnte) {
            return yield* Effect.fail(new GroupAntesMismatch({
              expected: expectedAnte,
              got: amount,
              resource: expectedResource,
            }));
          }
        }

        // Enforce one pending offer per ghost per group (FR-013)
        for (const w of voteWindows.values()) {
          if (w.offer.groupId === groupId && w.offer.prospectId === prospectId) {
            return yield* Effect.fail(new GroupDuplicateOffer({ groupId, prospectId }));
          }
        }

        const offerId = ulid();
        voteWindows.set(offerId, {
          offer: { offerId, groupId, prospectId, resource, amount, expiresAt },
          votes: [],
        });

        const expiry = new Date(expiresAt).toISOString();
        const memberList = [...group.members.keys()];
        // Use offerId as message_id so inbox notification.message_id === offerId,
        // allowing members to call group.vote with the offer_id directly from inbox.
        const msg: ChatMessage = {
          thread_id: groupId,
          message_id: offerId,
          timestamp: new Date().toISOString(),
          role: "system",
          name: "system",
          content: `${prospectId} has offered to join. Offer ID: ${offerId}. Vote before ${expiry}. Use group.vote to respond.`,
          mx_tile: "",
          mx_listeners: memberList,
        };
        if (!chatLog.has(groupId)) chatLog.set(groupId, []);
        chatLog.get(groupId)!.push(msg);
        onMessage?.(msg);

        return { offerId, expiresAt };
      });
    },

    vote({ offerId, voterId, decision }) {
      return Effect.gen(function* () {
        const window = voteWindows.get(offerId);
        if (!window) return yield* Effect.fail(new GroupOfferNotFound({ offerId }));
        if (Date.now() > window.offer.expiresAt) {
          voteWindows.delete(offerId);
          return yield* Effect.fail(new GroupOfferExpired({ offerId }));
        }
        const group = getGroup(window.offer.groupId);
        if (!group || !group.members.has(voterId)) {
          return yield* Effect.fail(new GroupNotMember({ groupId: window.offer.groupId, actorId: voterId }));
        }

        // Replace existing vote from same voter
        const idx = window.votes.findIndex(v => v.voterId === voterId);
        const newVote = { voterId, decision, ts: Date.now() };
        if (idx >= 0) {
          window.votes[idx] = newVote;
        } else {
          window.votes.push(newVote);
        }

        const memberCount = group.members.size;
        const acceptCount = window.votes.filter(v => v.decision === "accept").length;
        const rejectCount = window.votes.filter(v => v.decision === "reject").length;
        const majority = Math.floor(memberCount / 2) + 1;

        if (acceptCount >= majority) {
          resolveVoteWindow(offerId);
          return { resolved: true, outcome: "admitted" as const };
        }
        if (rejectCount >= majority) {
          voteWindows.delete(offerId);
          return { resolved: true, outcome: "rejected" as const };
        }
        return { resolved: false, outcome: "pending" as const };
      });
    },

    resolveExpiredOffers() {
      return Effect.sync(() => {
        const now = Date.now();
        for (const [offerId, window] of voteWindows) {
          if (now > window.offer.expiresAt) {
            resolveVoteWindow(offerId);
            if (voteWindows.has(offerId)) voteWindows.delete(offerId);
          }
        }
      });
    },

    leave({ groupId, ghostId, leaveTxId: _ }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        const membership = group.members.get(ghostId);
        if (!membership) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: ghostId }));

        group.members.delete(ghostId);
        const remaining = [...group.members.keys(), ...group.participants.keys()];
        postSystemMessage(groupId, `${ghostId} has left the group.`, remaining);

        let dissolved = false;
        if (group.members.size === 0) {
          group.dissolvedAt = Date.now();
          dissolved = true;
        }

        return { returned: { resource: membership.resource, amount: membership.contributed }, dissolved };
      });
    },

    addParticipant({ groupId, actorId, role, requesterId }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (!group.members.has(requesterId)) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: requesterId }));
        group.participants.set(actorId, { role });
      });
    },

    removeParticipant({ groupId, actorId, requesterId }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (!group.members.has(requesterId)) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: requesterId }));
        if (!group.participants.has(actorId)) return yield* Effect.fail(new GroupNotParticipant({ groupId, actorId }));
        group.participants.delete(actorId);
      });
    },

    listMemberships(ghostId) {
      return Effect.sync(() => {
        const result: GroupSummary[] = [];
        for (const group of groups.values()) {
          if (group.dissolvedAt !== null) continue;
          const membership = group.members.get(ghostId);
          if (!membership) continue;
          result.push({
            groupId: group.groupId,
            name: group.name,
            memberCount: group.members.size,
            myContribution: { resource: membership.resource, amount: membership.contributed },
          });
        }
        return result;
      });
    },

    groupSay({ groupId, senderId, senderName, content, senderTile }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (group.dissolvedAt !== null) return yield* Effect.fail(new GroupDissolved({ groupId }));
        const isMember = group.members.has(senderId);
        const isParticipant = group.participants.has(senderId);
        if (!isMember && !isParticipant) {
          return yield* Effect.fail(new GroupNotMemberOrParticipant({ groupId, actorId: senderId }));
        }

        const messageId = ulid();
        const mx_listeners: ActorId[] = [
          ...group.members.keys(),
          ...group.participants.keys(),
        ].filter(id => id !== senderId);

        const msg: ChatMessage = {
          thread_id: groupId,
          message_id: messageId,
          timestamp: new Date().toISOString(),
          role: "user",
          name: senderName,
          content,
          mx_tile: senderTile,
          mx_listeners,
        };

        const log = chatLog.get(groupId);
        if (!log) {
          return yield* Effect.fail(new GroupChatStoreError({ message: `No chat log for group ${groupId}` }));
        }
        log.push(msg);
        onMessage?.(msg);

        return { messageId, mx_listeners };
      });
    },
  };
}

export const GroupServiceInMemoryLayer: Layer.Layer<GroupService> = Layer.succeed(
  GroupService,
  makeGroupServiceInMemory(),
);
