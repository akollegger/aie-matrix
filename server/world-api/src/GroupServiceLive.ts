import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Schedule } from "effect";
import { ulid } from "ulid";
import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";
import type { ActorId, GroupId, GroupSummary } from "@aie-matrix/shared-types";
import type { Driver } from "neo4j-driver";
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
  GroupPersistenceError,
} from "./group-errors.js";
import { GroupService, type GroupServiceOps } from "./GroupService.js";
import { WorldBridgeService } from "./WorldBridgeService.js";
import type { VoteWindow } from "@aie-matrix/shared-types";

function generateGroupName(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: " ",
    style: "capital",
  });
}

interface GroupRecord {
  groupId: GroupId;
  name: string;
  members: Map<ActorId, { resource: string; contributed: number }>;
  participants: Map<ActorId, { role: string }>;
  dissolvedAt: number | null;
}

function groupBagActorId(groupId: GroupId): string {
  return `group:${groupId}`;
}

function makeGroupServiceLive(
  driver: Driver,
  bridge: WorldBridgeService["Type"],
  conversationDataDir: string,
): GroupServiceOps {
  // In-memory cache of active groups (loaded from Neo4j on first use or on session startup)
  const groups = new Map<GroupId, GroupRecord>();
  // In-memory vote windows (ephemeral, not persisted)
  const voteWindows = new Map<string, VoteWindow>();

  function getGroup(groupId: GroupId): GroupRecord | undefined {
    return groups.get(groupId);
  }

  async function appendGroupThread(groupId: GroupId, record: object): Promise<void> {
    const dir = conversationDataDir;
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${groupId}.jsonl`);
    await appendFile(path, JSON.stringify(record) + "\n", "utf8");
  }

  function fanoutGroupMessage(listeners: ActorId[], threadId: GroupId, messageId: string): void {
    for (const lid of listeners) {
      bridge.fanoutWorldV1({
        t: "message.new",
        targetGhostId: lid,
        payload: {
          from: "group",
          role: "group",
          priority: "GROUP",
          thread_id: threadId,
          message_id: messageId,
        },
      });
    }
  }

  async function postSystemMessageAsync(groupId: GroupId, content: string, listeners: ActorId[]): Promise<void> {
    const messageId = ulid();
    const record = {
      thread_id: groupId,
      message_id: messageId,
      timestamp: new Date().toISOString(),
      role: "system",
      name: "system",
      content,
      mx_tile: "",
      mx_listeners: listeners,
    };
    await appendGroupThread(groupId, record);
    fanoutGroupMessage(listeners, groupId, messageId);
  }

  function resolveVoteWindowAsync(offerId: string): Promise<void> {
    const window = voteWindows.get(offerId);
    if (!window) return Promise.resolve();
    const { offer, votes } = window;
    const group = groups.get(offer.groupId);
    if (!group) {
      voteWindows.delete(offerId);
      return Promise.resolve();
    }
    const acceptCount = votes.filter(v => v.decision === "accept").length;
    const rejectCount = votes.filter(v => v.decision === "reject").length;
    const totalVoted = acceptCount + rejectCount;
    const admitted = totalVoted > 0 && acceptCount > rejectCount;
    voteWindows.delete(offerId);

    if (!admitted) return Promise.resolve();

    const session = driver.session();
    return session
      .executeWrite((tx) =>
        tx.run(
          `MATCH (g:Group {group_id: $groupId})
           MERGE (ghost:Ghost {ghost_id: $prospectId})
           CREATE (ghost)-[:MEMBER_OF {contributed: $amount, resource: $resource}]->(g)`,
          { groupId: offer.groupId, prospectId: offer.prospectId, amount: offer.amount, resource: offer.resource },
        ),
      )
      .then(() => {
        group.members.set(offer.prospectId, { resource: offer.resource, contributed: offer.amount });
        const memberList = [...group.members.keys(), ...group.participants.keys()];
        return postSystemMessageAsync(offer.groupId, `${offer.prospectId} has joined the group.`, memberList);
      })
      .catch((e: unknown) => {
        console.error(JSON.stringify({ kind: "group.admit.error", offerId, error: String(e) }));
      })
      .finally(() => session.close());
  }

  return {
    createGroup({ ghostA, ghostB, resource, amount, formationTxId }) {
      return Effect.tryPromise({
        try: async () => {
          const groupId = ulid();
          const name = generateGroupName();
          const bagActorId = groupBagActorId(groupId);

          const session = driver.session();
          try {
            await session.executeWrite((tx) =>
              tx.run(
                `CREATE (g:Group {group_id: $groupId, name: $name, created_at: $createdAt, dissolved_at: null, bag_actor_id: $bagActorId})
                 WITH g
                 MERGE (a:Ghost {ghost_id: $ghostA})
                 MERGE (b:Ghost {ghost_id: $ghostB})
                 CREATE (a)-[:MEMBER_OF {contributed: $amount, resource: $resource}]->(g)
                 CREATE (b)-[:MEMBER_OF {contributed: $amount, resource: $resource}]->(g)
                 RETURN g.group_id AS groupId`,
                { groupId, name, createdAt: Date.now(), bagActorId, ghostA, ghostB, amount, resource },
              ),
            );
          } finally {
            await session.close();
          }

          const members = new Map<ActorId, { resource: string; contributed: number }>();
          members.set(ghostA, { resource, contributed: amount });
          members.set(ghostB, { resource, contributed: amount });
          groups.set(groupId, { groupId, name, members, participants: new Map(), dissolvedAt: null });

          // Initialize the group chat thread file
          await appendGroupThread(groupId, {
            thread_id: groupId,
            message_id: ulid(),
            timestamp: new Date().toISOString(),
            role: "system",
            name: "system",
            content: `Group "${name}" formed by ${ghostA} and ${ghostB}. Formation tx: ${formationTxId}.`,
            mx_tile: "",
            mx_listeners: [ghostA, ghostB],
          });

          return { groupId, name };
        },
        catch: (e) => new GroupPersistenceError({ message: String(e) }),
      });
    },

    listMemberships(ghostId) {
      return Effect.tryPromise({
        try: async () => {
          const session = driver.session();
          try {
            const result = await session.executeRead((tx) =>
              tx.run(
                `MATCH (ghost:Ghost {ghost_id: $ghostId})-[m:MEMBER_OF]->(g:Group)
                 WHERE g.dissolved_at IS NULL
                 MATCH (others)-[:MEMBER_OF]->(g)
                 RETURN g.group_id AS groupId, g.name AS name, m.contributed AS contributed, m.resource AS resource, count(others) AS memberCount`,
                { ghostId },
              ),
            );
            return result.records.map((r): GroupSummary => {
              const rawCount = r.get("memberCount");
              const rawContrib = r.get("contributed");
              return {
                groupId: r.get("groupId") as string,
                name: r.get("name") as string,
                memberCount: typeof rawCount === "object" && rawCount !== null ? (rawCount as { toNumber(): number }).toNumber() : Number(rawCount),
                myContribution: {
                  resource: r.get("resource") as string,
                  amount: typeof rawContrib === "object" && rawContrib !== null ? (rawContrib as { toNumber(): number }).toNumber() : Number(rawContrib),
                },
              };
            });
          } finally {
            await session.close();
          }
        },
        catch: () => [],
      }).pipe(Effect.orElse(() => Effect.succeed([])));
    },

    proposeJoin({ groupId, prospectId, resource, amount, expiresAt }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (group.dissolvedAt !== null) return yield* Effect.fail(new GroupDissolved({ groupId }));

        const memberContributions = [...group.members.values()];
        if (memberContributions.length > 0) {
          const expectedAnte = memberContributions[0]!.contributed;
          const expectedResource = memberContributions[0]!.resource;
          if (resource !== expectedResource || amount !== expectedAnte) {
            return yield* Effect.fail(new GroupAntesMismatch({ expected: expectedAnte, got: amount, resource: expectedResource }));
          }
        }

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
        yield* Effect.promise(() =>
          postSystemMessageAsync(
            groupId,
            `${prospectId} has offered to join. Vote before ${expiry}. Use group.vote to respond.`,
            memberList,
          ),
        );

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
          yield* Effect.promise(() => resolveVoteWindowAsync(offerId));
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
      return Effect.promise(async () => {
        const now = Date.now();
        const expired = [...voteWindows.entries()].filter(([, w]) => now > w.offer.expiresAt);
        await Promise.all(expired.map(([offerId]) => resolveVoteWindowAsync(offerId)));
      });
    },

    leave({ groupId, ghostId, leaveTxId: _ }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        const membership = group.members.get(ghostId);
        if (!membership) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: ghostId }));

        yield* Effect.tryPromise({
          try: async () => {
            const session = driver.session();
            try {
              await session.executeWrite((tx) =>
                tx.run(
                  `MATCH (ghost:Ghost {ghost_id: $ghostId})-[r:MEMBER_OF]->(g:Group {group_id: $groupId})
                   DELETE r`,
                  { ghostId, groupId },
                ),
              );
            } finally {
              await session.close();
            }
          },
          catch: (e) => new GroupPersistenceError({ message: String(e) }),
        });

        group.members.delete(ghostId);
        const remaining = [...group.members.keys(), ...group.participants.keys()];
        yield* Effect.promise(() => postSystemMessageAsync(groupId, `${ghostId} has left the group.`, remaining));

        let dissolved = false;
        if (group.members.size === 0) {
          group.dissolvedAt = Date.now();
          dissolved = true;
          yield* Effect.tryPromise({
            try: async () => {
              const session = driver.session();
              try {
                await session.executeWrite((tx) =>
                  tx.run(
                    `MATCH (g:Group {group_id: $groupId}) SET g.dissolved_at = $dissolvedAt`,
                    { groupId, dissolvedAt: group.dissolvedAt },
                  ),
                );
              } finally {
                await session.close();
              }
            },
            catch: (e) => new GroupPersistenceError({ message: String(e) }),
          });
        }

        return { returned: { resource: membership.resource, amount: membership.contributed }, dissolved };
      });
    },

    addParticipant({ groupId, actorId, role, requesterId }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (!group.members.has(requesterId)) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: requesterId }));
        yield* Effect.tryPromise({
          try: async () => {
            const session = driver.session();
            try {
              await session.executeWrite((tx) =>
                tx.run(
                  `MATCH (g:Group {group_id: $groupId})
                   MERGE (a:Actor {actor_id: $actorId})
                   MERGE (a)-[r:PARTICIPANT_IN]->(g) SET r.role = $role`,
                  { groupId, actorId, role },
                ),
              );
            } finally {
              await session.close();
            }
          },
          catch: (e) => new GroupPersistenceError({ message: String(e) }),
        });
        group.participants.set(actorId, { role });
      });
    },

    removeParticipant({ groupId, actorId, requesterId }) {
      return Effect.gen(function* () {
        const group = getGroup(groupId);
        if (!group) return yield* Effect.fail(new GroupNotFound({ groupId }));
        if (!group.members.has(requesterId)) return yield* Effect.fail(new GroupNotMember({ groupId, actorId: requesterId }));
        if (!group.participants.has(actorId)) return yield* Effect.fail(new GroupNotParticipant({ groupId, actorId }));
        yield* Effect.tryPromise({
          try: async () => {
            const session = driver.session();
            try {
              await session.executeWrite((tx) =>
                tx.run(
                  `MATCH (a:Actor {actor_id: $actorId})-[r:PARTICIPANT_IN]->(g:Group {group_id: $groupId})
                   DELETE r`,
                  { actorId, groupId },
                ),
              );
            } finally {
              await session.close();
            }
          },
          catch: (e) => new GroupPersistenceError({ message: String(e) }),
        });
        group.participants.delete(actorId);
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

        const record = {
          thread_id: groupId,
          message_id: messageId,
          timestamp: new Date().toISOString(),
          role: "user" as const,
          name: senderName,
          content,
          mx_tile: senderTile,
          mx_listeners,
        };

        yield* Effect.tryPromise({
          try: () => appendGroupThread(groupId, record),
          catch: (e) => new GroupChatStoreError({ message: String(e) }),
        });

        fanoutGroupMessage(mx_listeners, groupId, messageId);
        return { messageId, mx_listeners };
      });
    },
  };
}

export const makeGroupServiceLiveLayer = (
  driver: Driver,
  conversationDataDir: string,
): Layer.Layer<GroupService, never, WorldBridgeService> =>
  Layer.effect(
    GroupService,
    Effect.gen(function* () {
      const bridge = yield* WorldBridgeService;
      const svc = makeGroupServiceLive(driver, bridge, conversationDataDir);

      // Background fiber: resolve expired vote windows every 30 seconds
      yield* Effect.forkDaemon(
        Effect.repeat(
          svc.resolveExpiredOffers(),
          Schedule.fixed("30 seconds"),
        ),
      );

      return svc;
    }),
  );
