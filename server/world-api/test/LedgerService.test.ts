import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ResourceType, Transfer } from "@aie-matrix/shared-types";
import { makeLedgerServiceInMemory } from "../src/LedgerServiceInMemory.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD: ResourceType = { id: "gold", class: "conserved", qty: 100, floor: 0, label: "Gold" };
const XP: ResourceType = { id: "xp", class: "monotonic", qty: 0, floor: 0, label: "Experience" };

function makeLedger(seed: ResourceType[] = [GOLD]) {
  const svc = makeLedgerServiceInMemory();
  Effect.runSync(svc.init(seed));
  return svc;
}

function transfer(from: string, to: string, resource: string, qty: number): Transfer {
  return { from, to, resource, qty };
}

function tx(transfers: Transfer[], cause = "test", actors: string[] = []) {
  return { id: ulid(), transfers, cause, actors, ts: Date.now() };
}

// ---------------------------------------------------------------------------
// bag()
// ---------------------------------------------------------------------------

test("bag() returns empty holdings for a new actor", () => {
  const svc = makeLedger();
  const result = Effect.runSync(svc.bag("ghost-001"));
  assert.deepEqual(result.holdings, []);
});

test("bag() returns world holdings after seed", () => {
  const svc = makeLedger([GOLD]);
  const result = Effect.runSync(svc.bag("world"));
  assert.equal(result.holdings.find(h => h.resource === "gold")?.qty, 100);
});

// ---------------------------------------------------------------------------
// commit() — reward (world → ghost)
// ---------------------------------------------------------------------------

test("commit() reward: ghost gains, world loses, conservation holds", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 20)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  const worldBag = Effect.runSync(svc.bag("world"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "gold")?.qty, 20);
  assert.equal(worldBag.holdings.find(h => h.resource === "gold")?.qty, 80);
});

// ---------------------------------------------------------------------------
// commit() — spend (ghost → world)
// ---------------------------------------------------------------------------

test("commit() spend: ghost decremented, world incremented", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 20)])));
  Effect.runSync(svc.commit(tx([transfer("ghost-001", "world", "gold", 5)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  const worldBag = Effect.runSync(svc.bag("world"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "gold")?.qty, 15);
  assert.equal(worldBag.holdings.find(h => h.resource === "gold")?.qty, 85);
});

// ---------------------------------------------------------------------------
// commit() — InsufficientFunds
// ---------------------------------------------------------------------------

test("commit() InsufficientFunds: denied when balance below cost, balance unchanged", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 3)])));
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("ghost-001", "world", "gold", 5)]))
  ));
  assert.equal(err._tag, "LedgerError.InsufficientFunds");
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "gold")?.qty, 3);
});

// ---------------------------------------------------------------------------
// commit() — DuplicateTransaction
// ---------------------------------------------------------------------------

test("commit() DuplicateTransaction: same ULID rejected on second submission", () => {
  const svc = makeLedger([GOLD]);
  const t = tx([transfer("world", "ghost-001", "gold", 10)]);
  Effect.runSync(svc.commit(t));
  const err = Effect.runSync(Effect.flip(svc.commit(t)));
  assert.equal(err._tag, "LedgerError.DuplicateTransaction");
});

// ---------------------------------------------------------------------------
// commit() — UnknownResource
// ---------------------------------------------------------------------------

test("commit() UnknownResource: rejected when resource not registered", () => {
  const svc = makeLedger([GOLD]);
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("world", "ghost-001", "energy", 10)]))
  ));
  assert.equal(err._tag, "LedgerError.UnknownResource");
  assert.equal((err as any).resource, "energy");
});

// ---------------------------------------------------------------------------
// verify() — untampered chain
// ---------------------------------------------------------------------------

test("verify() passes on untampered chain", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 10)])));
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-002", "gold", 5)])));
  const result = Effect.runSync(svc.verify());
  // 2 commits + 1 genesis seed = 3 entries
  assert.ok(result.entries >= 2);
});

// ---------------------------------------------------------------------------
// verify() — ChainTamperedError (tamper the log via exposed internals)
// ---------------------------------------------------------------------------

test("verify() ChainTamperedError: detected when entry hash mutated", () => {
  const svc = makeLedger([GOLD]) as any;
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 10)])));

  const log: any[] = svc._getLog();
  assert.ok(log.length >= 1, "should have at least one entry");

  // Tamper: change the hash of the last committed entry
  const lastIdx = log.length - 1;
  log[lastIdx] = { ...log[lastIdx], hash: "tampered-hash-000" };

  const err = Effect.runSync(Effect.flip(svc.verify()));
  assert.equal(err._tag, "LedgerError.ChainTampered");
  assert.ok((err as any).atId, "should report which entry was tampered");
});

// ---------------------------------------------------------------------------
// commit() — monotonic mint
// ---------------------------------------------------------------------------

test("commit() monotonic mint: balance accumulates", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 30)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "xp")?.qty, 80);
});

// ---------------------------------------------------------------------------
// commit() — monotonic transfer rejected
// ---------------------------------------------------------------------------

test("commit() monotonic: ghost cannot transfer XP to another actor", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("ghost-001", "ghost-002", "xp", 10)]))
  ));
  // InsufficientFunds because ghost-001's floor check triggers (monotonic has floor 0
  // and ghost-001.xp = 50, so 50 - 10 >= 0 would pass... need explicit monotonic guard)
  // The implementation rejects because monotonic resources skip the floor check on minting
  // but should reject ghost-to-ghost transfers. For now, verify error is one of our ledger errors.
  assert.equal(err._tag, "LedgerError.MonotonicTradeRejected");
  assert.equal((err as any).resource, "xp");
});

// ---------------------------------------------------------------------------
// resourceTypes()
// ---------------------------------------------------------------------------

test("resourceTypes() returns registered types", () => {
  const svc = makeLedger([GOLD, XP]);
  const types = Effect.runSync(svc.resourceTypes());
  assert.equal(types.length, 2);
  assert.ok(types.find(t => t.id === "gold"));
  assert.ok(types.find(t => t.id === "xp"));
});

// ---------------------------------------------------------------------------
// Phase 5 (US3): monotonic resource accumulation — extended coverage
// ---------------------------------------------------------------------------

test("monotonic: multiple mints accumulate cumulatively", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 30)])));
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 20)])));
  const bag = Effect.runSync(svc.bag("ghost-001"));
  assert.equal(bag.holdings.find(h => h.resource === "xp")?.qty, 100);
});

test("monotonic: two different actors accumulate independently", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 40)])));
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-002", "xp", 60)])));
  const bag1 = Effect.runSync(svc.bag("ghost-001"));
  const bag2 = Effect.runSync(svc.bag("ghost-002"));
  assert.equal(bag1.holdings.find(h => h.resource === "xp")?.qty, 40);
  assert.equal(bag2.holdings.find(h => h.resource === "xp")?.qty, 60);
});

test("monotonic: XP does not appear in inventory of actor with none", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  const bag2 = Effect.runSync(svc.bag("ghost-002"));
  assert.ok(!bag2.holdings.find(h => h.resource === "xp"), "ghost-002 should have no XP holdings");
});

test("monotonic: XP does not affect gold conservation sum", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "gold", 20)])));
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  const worldBag = Effect.runSync(svc.bag("world"));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  const goldSum = (worldBag.holdings.find(h => h.resource === "gold")?.qty ?? 0)
    + (ghostBag.holdings.find(h => h.resource === "gold")?.qty ?? 0);
  assert.equal(goldSum, 100, "gold conservation holds regardless of XP minting");
});

test("monotonic: MonotonicTradeRejected when ghost tries to transfer XP to world", () => {
  const svc = makeLedger([GOLD, XP]);
  Effect.runSync(svc.commit(tx([transfer("world.xp-issuer", "ghost-001", "xp", 50)])));
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("ghost-001", "world", "xp", 10)]))
  ));
  assert.equal(err._tag, "LedgerError.MonotonicTradeRejected");
});

test("mechanics: rewardXp mints XP via LedgerService", async () => {
  const { rewardXp } = await import("../src/mechanics.js");
  const { LedgerServiceInMemoryLayer } = await import("../src/LedgerServiceInMemory.js");
  const { Layer } = await import("effect");
  const svc = makeLedger([GOLD, XP]);
  const layer = Layer.succeed((await import("../src/LedgerService.js")).LedgerService, svc);
  Effect.runSync(Effect.provide(rewardXp("ghost-abc", 25), layer));
  const bag = Effect.runSync(svc.bag("ghost-abc"));
  assert.equal(bag.holdings.find(h => h.resource === "xp")?.qty, 25);
});
