/**
 * The full economy loop on the joint ledger (RFC-0029), end to end with
 * NO new transaction machinery: stipend → buy (a plain trade) → eat (a
 * bag debit). Proves a ghost can win/hold gold, swap it for food via a
 * ledger trade, and consume that food from its bag for Fuel.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import { makeLedgerServiceInMemory } from "./LedgerServiceInMemory.js";
import type { ItemSeed } from "./LedgerService.js";
import { consumeFromBag } from "./economy.js";

const SEED: ItemSeed[] = [
  { itemRef: "gold", qty: 1000 },
  { itemRef: "food-cake", qty: 100 },
];

// Per-unit Fuel for foods (mirrors ItemDefinition.fuel; cake delivers 4).
const FUEL: Record<string, number> = { "food-cake": 4 };
const fuelOf = (ref: string) => FUEL[ref] ?? 0;

function bal(svc: ReturnType<typeof makeLedgerServiceInMemory>, actor: string, res: string): number {
  const r = Effect.runSync(svc.bag(actor));
  return r.holdings.find((h) => h.resource === res)?.qty ?? 0;
}

test("stipend → buy (trade) → eat (bag debit): the whole loop on the ledger", () => {
  const svc = makeLedgerServiceInMemory();
  Effect.runSync(svc.init(SEED));

  // Stipend: world grants the ghost 100 gold. Vendor stocked with 5 cakes.
  Effect.runSync(svc.commit({
    id: ulid(),
    transfers: [{ resource: "gold", qty: 100, from: "world", to: "ghost-1" }],
    cause: "stipend", actors: ["ghost-1"], ts: Date.now(),
  }));
  Effect.runSync(svc.commit({
    id: ulid(),
    transfers: [{ resource: "food-cake", qty: 5, from: "world", to: "vendor-1" }],
    cause: "vendor-stock", actors: ["vendor-1"], ts: Date.now(),
  }));
  assert.equal(bal(svc, "ghost-1", "gold"), 100);
  assert.equal(bal(svc, "vendor-1", "food-cake"), 5);

  // BUY: a plain offer/agree trade — gold ghost→vendor, cake vendor→ghost.
  // (This is exactly what ProposalService.agree commits; the vendor auto-agrees.)
  Effect.runSync(svc.commit({
    id: ulid(),
    transfers: [
      { resource: "gold", qty: 4, from: "ghost-1", to: "vendor-1" },
      { resource: "food-cake", qty: 1, from: "vendor-1", to: "ghost-1" },
    ],
    cause: "vendor.purchase", actors: ["ghost-1", "vendor-1"], ts: Date.now(),
  }));
  assert.equal(bal(svc, "ghost-1", "gold"), 96, "ghost paid 4 gold");
  assert.equal(bal(svc, "ghost-1", "food-cake"), 1, "ghost now holds a cake");
  assert.equal(bal(svc, "vendor-1", "gold"), 4, "vendor took the gold");
  assert.equal(bal(svc, "vendor-1", "food-cake"), 4, "vendor stock decremented");

  // EAT: consume the cake from the bag → Fuel; unit returns to world pool.
  const res = Effect.runSync(consumeFromBag(svc, "ghost-1", "food-cake", fuelOf));
  assert.equal(res.ok, true);
  assert.equal(res.consumed, 4, "cake delivered its fuel");
  assert.equal(res.remaining, 0);
  assert.equal(bal(svc, "ghost-1", "food-cake"), 0, "cake consumed from bag");

  // Conservation held throughout (no minting/destruction).
  assert.equal(bal(svc, "world", "gold") + bal(svc, "ghost-1", "gold") + bal(svc, "vendor-1", "gold"), 1000);
  assert.equal(
    bal(svc, "world", "food-cake") + bal(svc, "ghost-1", "food-cake") + bal(svc, "vendor-1", "food-cake"),
    100,
  );
});

test("eating with an empty bag is a no-op", () => {
  const svc = makeLedgerServiceInMemory();
  Effect.runSync(svc.init(SEED));
  const res = Effect.runSync(consumeFromBag(svc, "ghost-broke", "food-cake", fuelOf));
  assert.equal(res.ok, false);
  assert.equal(res.consumed, 0);
});
