import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import type { Transfer } from "@aie-matrix/shared-types";
import type { ItemSeed } from "../src/LedgerService.js";
import { makeLedgerServiceInMemory } from "../src/LedgerServiceInMemory.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD: ItemSeed = { itemRef: "GoldCoin", qty: 100 };

function makeLedger(seed: ItemSeed[] = [GOLD]) {
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
  assert.equal(result.holdings.find(h => h.resource === "GoldCoin")?.qty, 100);
});

// ---------------------------------------------------------------------------
// commit() — reward (world → ghost)
// ---------------------------------------------------------------------------

test("commit() reward: ghost gains, world loses, conservation holds", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 20)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  const worldBag = Effect.runSync(svc.bag("world"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "GoldCoin")?.qty, 20);
  assert.equal(worldBag.holdings.find(h => h.resource === "GoldCoin")?.qty, 80);
});

// ---------------------------------------------------------------------------
// commit() — spend (ghost → world)
// ---------------------------------------------------------------------------

test("commit() spend: ghost decremented, world incremented", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 20)])));
  Effect.runSync(svc.commit(tx([transfer("ghost-001", "world", "GoldCoin", 5)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  const worldBag = Effect.runSync(svc.bag("world"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "GoldCoin")?.qty, 15);
  assert.equal(worldBag.holdings.find(h => h.resource === "GoldCoin")?.qty, 85);
});

// ---------------------------------------------------------------------------
// commit() — InsufficientFunds
// ---------------------------------------------------------------------------

test("commit() InsufficientFunds: denied when balance below cost, balance unchanged", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 3)])));
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("ghost-001", "world", "GoldCoin", 5)]))
  ));
  assert.equal(err._tag, "LedgerError.InsufficientFunds");
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "GoldCoin")?.qty, 3);
});

// ---------------------------------------------------------------------------
// commit() — DuplicateTransaction
// ---------------------------------------------------------------------------

test("commit() DuplicateTransaction: same ULID rejected on second submission", () => {
  const svc = makeLedger([GOLD]);
  const t = tx([transfer("world", "ghost-001", "GoldCoin", 10)]);
  Effect.runSync(svc.commit(t));
  const err = Effect.runSync(Effect.flip(svc.commit(t)));
  assert.equal(err._tag, "LedgerError.DuplicateTransaction");
});

// ---------------------------------------------------------------------------
// commit() — UnknownResource
// ---------------------------------------------------------------------------

test("commit() rejects zero quantity transfer", () => {
  const svc = makeLedger([GOLD]);
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 0)]))
  ));
  assert.equal(err._tag, "LedgerError.ConservationViolation");
});

test("commit() rejects negative quantity transfer (prevents resource minting exploit)", () => {
  const svc = makeLedger([GOLD]);
  const before = Effect.runSync(svc.bag("world")).holdings.find(h => h.resource === "GoldCoin")?.qty ?? 0;
  const err = Effect.runSync(Effect.flip(
    svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", -10)]))
  ));
  assert.equal(err._tag, "LedgerError.ConservationViolation");
  // Balance must be unchanged — no minting occurred
  const after = Effect.runSync(svc.bag("world")).holdings.find(h => h.resource === "GoldCoin")?.qty ?? 0;
  assert.equal(after, before);
});

test("hash includes transfer amounts: changing qty produces a different hash", () => {
  const svc1 = makeLedger([GOLD]) as any;
  const svc2 = makeLedger([GOLD]) as any;
  // Commit different amounts to two fresh ledgers
  Effect.runSync(svc1.commit(tx([transfer("world", "ghost-001", "GoldCoin", 10)])));
  Effect.runSync(svc2.commit(tx([transfer("world", "ghost-001", "GoldCoin", 99)])));
  const log1: any[] = svc1._getLog();
  const log2: any[] = svc2._getLog();
  // The last entry (after genesis) should have different hashes
  assert.notEqual(log1.at(-1).hash, log2.at(-1).hash, "transfers with different qty must produce different hashes");
});

test("commit() with unknown resource (no registry) succeeds — resource identity is the string itself", () => {
  const svc = makeLedger([GOLD]);
  // No resource registry means any string is valid as a resource; InsufficientFunds if from-actor has none
  // world.genesis is always allowed to go negative, so seeding with any resource works
  Effect.runSync(svc.commit(tx([transfer("world.genesis", "ghost-001", "EnergyCell", 10)])));
  const ghostBag = Effect.runSync(svc.bag("ghost-001"));
  assert.equal(ghostBag.holdings.find(h => h.resource === "EnergyCell")?.qty, 10);
});

// ---------------------------------------------------------------------------
// verify() — untampered chain
// ---------------------------------------------------------------------------

test("verify() passes on untampered chain", () => {
  const svc = makeLedger([GOLD]);
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 10)])));
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-002", "GoldCoin", 5)])));
  const result = Effect.runSync(svc.verify());
  // 2 commits + 1 genesis seed = 3 entries
  assert.ok(result.entries >= 2);
});

// ---------------------------------------------------------------------------
// verify() — ChainTamperedError (tamper the log via exposed internals)
// ---------------------------------------------------------------------------

test("verify() ChainTamperedError: detected when entry hash mutated", () => {
  const svc = makeLedger([GOLD]) as any;
  Effect.runSync(svc.commit(tx([transfer("world", "ghost-001", "GoldCoin", 10)])));

  const log: any[] = svc._getLog();
  assert.ok(log.length >= 1, "should have at least one entry");

  // Tamper: change the hash of the last committed entry
  const lastIdx = log.length - 1;
  log[lastIdx] = { ...log[lastIdx], hash: "tampered-hash-000" };

  const err = Effect.runSync(Effect.flip(svc.verify()));
  assert.equal(err._tag, "LedgerError.ChainTampered");
  assert.ok((err as any).atId, "should report which entry was tampered");
});

