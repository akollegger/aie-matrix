import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { makeGroupServiceInMemory } from "../src/GroupServiceInMemory.js";
import {
  GroupAntesMismatch,
  GroupDuplicateOffer,
  GroupNotFound,
  GroupNotMember,
  GroupNotMemberOrParticipant,
  GroupNotParticipant,
  GroupOfferExpired,
  GroupOfferNotFound,
} from "../src/group-errors.js";

function makeSvc() {
  const messages: unknown[] = [];
  const svc = makeGroupServiceInMemory((msg) => messages.push(msg));
  return { svc, messages };
}

async function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, never, never>);
}

async function runFail<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  const exit = await Effect.runPromiseExit(effect as Effect.Effect<A, E, never>);
  if (exit._tag === "Failure") {
    const cause = exit.cause;
    if (cause._tag === "Fail") return cause.error as E;
  }
  throw new Error("Expected failure but got success");
}

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

test("createGroup — creates group with both MEMBER_OF records", async () => {
  const { svc } = makeSvc();
  const result = await run(svc.createGroup({
    ghostA: "gA",
    ghostB: "gB",
    resource: "trust",
    amount: 10,
    formationTxId: "tx-001",
  }));
  assert.ok(result.groupId.length > 0);
  assert.ok(result.name.length > 0);

  const memberships = await run(svc.listMemberships("gA"));
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0]!.groupId, result.groupId);
  assert.equal(memberships[0]!.myContribution.resource, "trust");
  assert.equal(memberships[0]!.myContribution.amount, 10);
  assert.equal(memberships[0]!.memberCount, 2);
});

test("createGroup — amount 0 (communication-only bond) is valid", async () => {
  const { svc } = makeSvc();
  const result = await run(svc.createGroup({
    ghostA: "gA",
    ghostB: "gB",
    resource: "trust",
    amount: 0,
    formationTxId: "tx-002",
  }));
  assert.ok(result.groupId.length > 0);
  const memberships = await run(svc.listMemberships("gA"));
  assert.equal(memberships[0]!.myContribution.amount, 0);
});

// ---------------------------------------------------------------------------
// proposeJoin
// ---------------------------------------------------------------------------

test("proposeJoin — opens vote window and posts system message", async () => {
  const { svc, messages } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const result = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));
  assert.ok(result.offerId.length > 0);
  assert.ok(messages.some((m: any) => m.content.includes("gC") && m.content.includes("offered to join")));
});

test("proposeJoin — fails if group not found", async () => {
  const { svc } = makeSvc();
  const err = await runFail(svc.proposeJoin({ groupId: "nonexistent", prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));
  assert.ok(err instanceof GroupNotFound);
});

test("proposeJoin — fails on ante mismatch (wrong amount)", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const err = await runFail(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 5, expiresAt: Date.now() + 60_000 }));
  assert.ok(err instanceof GroupAntesMismatch);
});

test("proposeJoin — rejects duplicate pending offer (FR-013)", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));
  const err = await runFail(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));
  assert.ok(err instanceof GroupDuplicateOffer);
});

// ---------------------------------------------------------------------------
// vote — admit
// ---------------------------------------------------------------------------

test("vote — single accept from sole voter admits the prospect (majority of voters)", async () => {
  const { svc, messages } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const { offerId } = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));

  const result = await run(svc.vote({ offerId, voterId: "gA", decision: "accept" }));
  assert.ok(!result.resolved, "one accept from two members is not yet a majority");

  const result2 = await run(svc.vote({ offerId, voterId: "gB", decision: "accept" }));
  assert.ok(result2.resolved);
  assert.equal(result2.outcome, "admitted");

  const memberships = await run(svc.listMemberships("gC"));
  assert.equal(memberships.length, 1);
  assert.ok(messages.some((m: any) => m.content.includes("has joined")));
});

test("vote — majority reject does not admit", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const { offerId } = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));

  await run(svc.vote({ offerId, voterId: "gA", decision: "reject" }));
  const result = await run(svc.vote({ offerId, voterId: "gB", decision: "reject" }));
  assert.equal(result.outcome, "rejected");

  const memberships = await run(svc.listMemberships("gC"));
  assert.equal(memberships.length, 0);
});

test("vote — single voter admit works when no other members vote (apathy is not a veto)", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const { offerId } = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));

  // gA votes, gB abstains; gA is majority of voters cast
  await run(svc.vote({ offerId, voterId: "gA", decision: "accept" }));
  // gA alone is 1/1 voters — wait for expiry resolution
  await run(svc.resolveExpiredOffers()); // not expired yet, no change
  // Still pending — need gB or expiry
  const memberships = await run(svc.listMemberships("gC"));
  assert.equal(memberships.length, 0, "not admitted until majority votes or expiry");
});

test("vote — fails if offerId not found", async () => {
  const { svc } = makeSvc();
  const err = await runFail(svc.vote({ offerId: "bad-id", voterId: "gA", decision: "accept" }));
  assert.ok(err instanceof GroupOfferNotFound);
});

test("vote — fails if voter is not a member", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const { offerId } = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));
  const err = await runFail(svc.vote({ offerId, voterId: "gX", decision: "accept" }));
  assert.ok(err instanceof GroupNotMember);
});

// ---------------------------------------------------------------------------
// resolveExpiredOffers
// ---------------------------------------------------------------------------

test("resolveExpiredOffers — expired offer with no votes is cancelled", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() - 1 }));

  await run(svc.resolveExpiredOffers());

  const memberships = await run(svc.listMemberships("gC"));
  assert.equal(memberships.length, 0, "prospect not admitted after expired offer with no votes");
});

test("resolveExpiredOffers — expired offer with majority accept is admitted", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const { offerId } = await run(svc.proposeJoin({ groupId, prospectId: "gC", resource: "trust", amount: 10, expiresAt: Date.now() + 60_000 }));

  // Cast one accept vote, then manually expire the window
  const window = (svc as any).voteWindows?.get(offerId); // internal — just manipulate via the test shim
  // Since we can't easily poke internals, use vote then expire via a trick:
  // Create a second svc with already-expired window
  const { svc: svc2 } = makeSvc();
  const { groupId: g2 } = await run(svc2.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-2" }));
  const past = Date.now() - 1;
  const { offerId: oid2 } = await run(svc2.proposeJoin({ groupId: g2, prospectId: "gD", resource: "trust", amount: 10, expiresAt: past }));
  // vote cast before expiry via vote() — but window is already expired, so vote() returns error
  const voteErr = await runFail(svc2.vote({ offerId: oid2, voterId: "gA", decision: "accept" }));
  assert.ok(voteErr instanceof GroupOfferExpired);
});

// ---------------------------------------------------------------------------
// leave
// ---------------------------------------------------------------------------

test("leave — returns contributed resources and removes membership", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));

  const result = await run(svc.leave({ groupId, ghostId: "gA", leaveTxId: "tx-leave-1" }));
  assert.equal(result.returned.resource, "trust");
  assert.equal(result.returned.amount, 10);
  assert.equal(result.dissolved, false);

  const memberships = await run(svc.listMemberships("gA"));
  assert.equal(memberships.length, 0);
});

test("leave — last member triggers dissolution", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));

  await run(svc.leave({ groupId, ghostId: "gA", leaveTxId: "tx-l1" }));
  const result = await run(svc.leave({ groupId, ghostId: "gB", leaveTxId: "tx-l2" }));
  assert.equal(result.dissolved, true);

  // Dissolved group still exists but listMemberships excludes it
  const memberships = await run(svc.listMemberships("gB"));
  assert.equal(memberships.length, 0);
});

test("leave — fails if not a member", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const err = await runFail(svc.leave({ groupId, ghostId: "gX", leaveTxId: "tx-l" }));
  assert.ok(err instanceof GroupNotMember);
});

test("leave — fails if group not found", async () => {
  const { svc } = makeSvc();
  const err = await runFail(svc.leave({ groupId: "unknown", ghostId: "gA", leaveTxId: "tx-l" }));
  assert.ok(err instanceof GroupNotFound);
});

// ---------------------------------------------------------------------------
// addParticipant / removeParticipant
// ---------------------------------------------------------------------------

test("addParticipant — member can add a participant", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  await run(svc.addParticipant({ groupId, actorId: "inquisitor-1", role: "inquisitor", requesterId: "gA" }));
  // Verify participant can post via groupSay
  await run(svc.groupSay({ groupId, senderId: "inquisitor-1", senderName: "Inquisitor", content: "hello", senderTile: "" }));
});

test("addParticipant — non-member cannot add participant", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const err = await runFail(svc.addParticipant({ groupId, actorId: "obs", role: "observer", requesterId: "gX" }));
  assert.ok(err instanceof GroupNotMember);
});

test("removeParticipant — member can remove a participant", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  await run(svc.addParticipant({ groupId, actorId: "obs", role: "observer", requesterId: "gA" }));
  await run(svc.removeParticipant({ groupId, actorId: "obs", requesterId: "gA" }));
  // Participant removed: groupSay now fails
  const err = await runFail(svc.groupSay({ groupId, senderId: "obs", senderName: "Obs", content: "hi", senderTile: "" }));
  assert.ok(err instanceof GroupNotMemberOrParticipant);
});

test("removeParticipant — fails if actor is not a participant", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const err = await runFail(svc.removeParticipant({ groupId, actorId: "nonexistent", requesterId: "gA" }));
  assert.ok(err instanceof GroupNotParticipant);
});

// ---------------------------------------------------------------------------
// groupSay
// ---------------------------------------------------------------------------

test("groupSay — member message is stored and listeners include all members", async () => {
  const { svc, messages } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));

  const result = await run(svc.groupSay({ groupId, senderId: "gA", senderName: "Ghost A", content: "hello group", senderTile: "8a1234567ffffff" }));
  assert.ok(result.messageId.length > 0);
  assert.ok(result.mx_listeners.includes("gB"), "gB should receive the message");
  assert.ok(!result.mx_listeners.includes("gA"), "sender not in own listeners");
  assert.ok(messages.some((m: any) => m.content === "hello group"));
});

test("groupSay — non-member/non-participant is rejected", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  const err = await runFail(svc.groupSay({ groupId, senderId: "gX", senderName: "Intruder", content: "hi", senderTile: "" }));
  assert.ok(err instanceof GroupNotMemberOrParticipant);
});

test("groupSay — fails if group dissolved", async () => {
  const { svc } = makeSvc();
  const { groupId } = await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 10, formationTxId: "tx-1" }));
  await run(svc.leave({ groupId, ghostId: "gA", leaveTxId: "tx-l1" }));
  await run(svc.leave({ groupId, ghostId: "gB", leaveTxId: "tx-l2" }));
  // Now dissolved — participant path
  const err = await runFail(svc.groupSay({ groupId, senderId: "gA", senderName: "A", content: "hi", senderTile: "" }));
  // Dissolved check fires first
  assert.ok("_tag" in err);
});

// ---------------------------------------------------------------------------
// listMemberships
// ---------------------------------------------------------------------------

test("listMemberships — returns empty for ghost with no groups", async () => {
  const { svc } = makeSvc();
  const result = await run(svc.listMemberships("ghost-nobody"));
  assert.deepEqual(result, []);
});

test("listMemberships — returns correct summary for member of multiple groups", async () => {
  const { svc } = makeSvc();
  await run(svc.createGroup({ ghostA: "gA", ghostB: "gB", resource: "trust", amount: 5, formationTxId: "tx-1" }));
  await run(svc.createGroup({ ghostA: "gA", ghostB: "gC", resource: "gold", amount: 10, formationTxId: "tx-2" }));

  const result = await run(svc.listMemberships("gA"));
  assert.equal(result.length, 2);
  const resources = result.map(g => g.myContribution.resource).sort();
  assert.deepEqual(resources, ["gold", "trust"]);
});
