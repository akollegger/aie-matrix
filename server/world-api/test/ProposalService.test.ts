import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ItemSeed } from "../src/LedgerService.js";
import { makeLedgerServiceInMemory } from "../src/LedgerServiceInMemory.js";
import { makeProposalService } from "../src/ProposalService.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD: ItemSeed = { itemRef: "GoldCoin", qty: 200 };
const ENERGY: ItemSeed = { itemRef: "EnergyCell", qty: 100 };

function makeLedger(seed: ItemSeed[] = [GOLD, ENERGY]) {
  const svc = makeLedgerServiceInMemory();
  Effect.runSync(svc.init(seed));
  return svc;
}

function creditGold(ledger: ReturnType<typeof makeLedger>, actorId: string, qty: number) {
  Effect.runSync(ledger.commit({
    id: ulid(),
    transfers: [{ resource: "GoldCoin", qty, from: "world", to: actorId }],
    cause: "test.credit", actors: [], ts: Date.now(),
  }));
}

function creditEnergy(ledger: ReturnType<typeof makeLedger>, actorId: string, qty: number) {
  Effect.runSync(ledger.commit({
    id: ulid(),
    transfers: [{ resource: "EnergyCell", qty, from: "world", to: actorId }],
    cause: "test.credit", actors: [], ts: Date.now(),
  }));
}

// ---------------------------------------------------------------------------
// propose()
// ---------------------------------------------------------------------------

test("propose() creates a pending proposal and returns proposalId + expiresAt", () => {
  const ledger = makeLedger();
  const svc = makeProposalService(ledger);
  const result = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));
  assert.ok(result.proposalId, "proposalId should be set");
  assert.ok(result.expiresAt > Date.now(), "expiresAt should be in the future");
});

test("propose() rejects when counterparty is on a different tile", () => {
  const ledger = makeLedger();
  const cellMap = new Map([["ghost-a", "cell-1"], ["ghost-b", "cell-2"]]);
  const svc = makeProposalService(ledger);
  const err = Effect.runSync(Effect.flip(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 5 }, want: { resource: "EnergyCell", qty: 2 },
  }, (id) => cellMap.get(id))));
  assert.equal(err._tag, "LedgerError.CounterpartyNotNearby");
});

test("propose() succeeds when both ghosts are on the same tile", () => {
  const ledger = makeLedger();
  const cellMap = new Map([["ghost-a", "cell-1"], ["ghost-b", "cell-1"]]);
  const svc = makeProposalService(ledger);
  const result = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 5 }, want: { resource: "EnergyCell", qty: 2 },
  }, (id) => cellMap.get(id)));
  assert.ok(result.proposalId);
});


// ---------------------------------------------------------------------------
// agree()
// ---------------------------------------------------------------------------

test("agree() atomically transfers both resources and marks proposal agreed", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 50);
  creditEnergy(ledger, "ghost-b", 30);
  const svc = makeProposalService(ledger);

  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));

  const result = Effect.runSync(svc.agree(proposalId, "ghost-b"));
  assert.equal(result.status, "agreed");

  const bagA = Effect.runSync(ledger.bag("ghost-a"));
  const bagB = Effect.runSync(ledger.bag("ghost-b"));
  assert.equal(bagA.holdings.find(h => h.resource === "GoldCoin")?.qty, 40, "ghost-a gave 10 gold");
  assert.equal(bagA.holdings.find(h => h.resource === "EnergyCell")?.qty, 5, "ghost-a received 5 energy");
  assert.equal(bagB.holdings.find(h => h.resource === "EnergyCell")?.qty, 25, "ghost-b gave 5 energy");
  assert.equal(bagB.holdings.find(h => h.resource === "GoldCoin")?.qty, 10, "ghost-b received 10 gold");
});

test("agree() rejects when a third party (not initiator or counterparty) tries to agree", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 20);
  creditEnergy(ledger, "ghost-b", 10);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 5 }, want: { resource: "EnergyCell", qty: 2 },
  }));
  // ghost-c is not a party — should be rejected
  const err = Effect.runSync(Effect.flip(svc.agree(proposalId, "ghost-c")));
  assert.equal(err._tag, "LedgerError.SelfAgreeDenied");
  // Balances must be unchanged
  const bagA = Effect.runSync(ledger.bag("ghost-a"));
  assert.equal(bagA.holdings.find(h => h.resource === "GoldCoin")?.qty, 20, "ghost-a balance unchanged");
});

test("agree() rejects when caller is the initiator (SelfAgreeDenied)", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 20);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));
  const err = Effect.runSync(Effect.flip(svc.agree(proposalId, "ghost-a")));
  assert.equal(err._tag, "LedgerError.SelfAgreeDenied");
});

test("agree() rejects when proposal does not exist", () => {
  const ledger = makeLedger();
  const svc = makeProposalService(ledger);
  const err = Effect.runSync(Effect.flip(svc.agree("nonexistent-id", "ghost-b")));
  assert.equal(err._tag, "LedgerError.ProposalNotFound");
});

test("agree() rejects when initiator lacks sufficient balance (InsufficientFunds)", () => {
  const ledger = makeLedger();
  // ghost-a has 0 gold — offer 10 they don't have
  creditEnergy(ledger, "ghost-b", 30);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));
  const err = Effect.runSync(Effect.flip(svc.agree(proposalId, "ghost-b")));
  assert.equal(err._tag, "LedgerError.InsufficientFunds");
});

test("agree() conservation: sum of gold unchanged after trade", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 50);
  creditGold(ledger, "ghost-b", 30);
  creditEnergy(ledger, "ghost-b", 20);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 15 }, want: { resource: "EnergyCell", qty: 10 },
  }));
  Effect.runSync(svc.agree(proposalId, "ghost-b"));

  const world = Effect.runSync(ledger.bag("world"));
  const a = Effect.runSync(ledger.bag("ghost-a"));
  const b = Effect.runSync(ledger.bag("ghost-b"));
  const goldSum =
    (world.holdings.find(h => h.resource === "GoldCoin")?.qty ?? 0) +
    (a.holdings.find(h => h.resource === "GoldCoin")?.qty ?? 0) +
    (b.holdings.find(h => h.resource === "GoldCoin")?.qty ?? 0);
  assert.equal(goldSum, 200, "gold conservation holds after trade");
});

// ---------------------------------------------------------------------------
// decline()
// ---------------------------------------------------------------------------

test("decline() voids proposal with no ledger change", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 20);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));

  const result = Effect.runSync(svc.decline(proposalId, "ghost-b"));
  assert.equal(result.status, "declined");

  const bagA = Effect.runSync(ledger.bag("ghost-a"));
  assert.equal(bagA.holdings.find(h => h.resource === "GoldCoin")?.qty, 20, "balance unchanged after decline");
});

test("decline() by initiator also works", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 20);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 10 }, want: { resource: "EnergyCell", qty: 5 },
  }));
  const result = Effect.runSync(svc.decline(proposalId, "ghost-a"));
  assert.equal(result.status, "declined");
});

test("decline() rejects when caller is not a party to the proposal", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 20);
  const svc = makeProposalService(ledger);
  const { proposalId } = Effect.runSync(svc.propose({
    initiatorId: "ghost-a", counterpartyId: "ghost-b",
    give: { resource: "GoldCoin", qty: 5 }, want: { resource: "EnergyCell", qty: 2 },
  }));
  // ghost-c is not a party — should get ProposalNotFound (not revealing the proposal exists)
  const err = Effect.runSync(Effect.flip(svc.decline(proposalId, "ghost-c")));
  assert.equal(err._tag, "LedgerError.ProposalNotFound");
  // Proposal should still be pending
  const [pending] = Effect.runSync(svc.listFor("ghost-a"));
  assert.equal(pending?.status, "pending", "proposal should still be pending");
});

test("decline() on nonexistent proposal returns ProposalNotFound", () => {
  const ledger = makeLedger();
  const svc = makeProposalService(ledger);
  const err = Effect.runSync(Effect.flip(svc.decline("bad-id", "ghost-x")));
  assert.equal(err._tag, "LedgerError.ProposalNotFound");
});

// ---------------------------------------------------------------------------
// listFor()
// ---------------------------------------------------------------------------

test("listFor() returns proposals for both initiator and counterparty", () => {
  const ledger = makeLedger();
  creditGold(ledger, "ghost-a", 30);
  const svc = makeProposalService(ledger);
  Effect.runSync(svc.propose({ initiatorId: "ghost-a", counterpartyId: "ghost-b", give: { resource: "GoldCoin", qty: 5 }, want: { resource: "EnergyCell", qty: 2 } }));
  Effect.runSync(svc.propose({ initiatorId: "ghost-c", counterpartyId: "ghost-a", give: { resource: "GoldCoin", qty: 3 }, want: { resource: "EnergyCell", qty: 1 } }));
  const forA = Effect.runSync(svc.listFor("ghost-a"));
  assert.equal(forA.length, 2, "ghost-a appears in both proposals");
  const forC = Effect.runSync(svc.listFor("ghost-c"));
  assert.equal(forC.length, 1);
});
