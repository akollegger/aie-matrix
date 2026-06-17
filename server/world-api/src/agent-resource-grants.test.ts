import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import type { SpawnGrant } from "@aie-matrix/map-gram";
import { makeLedgerServiceInMemory } from "./LedgerServiceInMemory.js";
import type { ItemSeed } from "./LedgerService.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger() {
  return makeLedgerServiceInMemory();
}

const goldSeed: ItemSeed = { itemRef: "GoldCoin", qty: 100 };
const keySeed: ItemSeed = { itemRef: "BrassKey", qty: 5, h3Index: "8f2800000000015" };

// ---------------------------------------------------------------------------
// Ledger init with ItemSeed
// ---------------------------------------------------------------------------

describe("ledger init with ItemSeed[]", () => {
  it("seeds world bag from ItemSeed with no h3Index", async () => {
    const ledger = makeLedger();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldSeed]);
        const bag = yield* ledger.bag("world");
        const gold = bag.holdings.find(h => h.resource === "GoldCoin");
        assert.equal(gold?.qty, 100, "world should have 100 GoldCoin");
      })
    );
  });

  it("seeds world@{h3Index} bag from ItemSeed with h3Index", async () => {
    const ledger = makeLedger();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([keySeed]);
        const tileBag = yield* ledger.bag("world@8f2800000000015");
        const keys = tileBag.holdings.find(h => h.resource === "BrassKey");
        assert.equal(keys?.qty, 5, "tile actor should have 5 BrassKey");
      })
    );
  });

  it("init with empty seed produces no genesis transaction", async () => {
    const ledger = makeLedger();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([]);
        const bag = yield* ledger.bag("world");
        assert.equal(bag.holdings.length, 0, "world bag should be empty after empty seed");
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Agent resource grant seeding (simulating what mcp-server.ts does)
// ---------------------------------------------------------------------------

describe("agent resource grant seeding", () => {
  it("ghost with a grant receives the declared qty on first seed", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-funder-001";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldSeed]);

        // Seed the ghost with 50 GoldCoin from world bag
        yield* ledger.commit({
          id: "ABCDEF1234567890ABCDEF1234", // deterministic tx id
          transfers: [{ resource: "GoldCoin", qty: 50, from: "world", to: ghostId }],
          cause: "agent.resource-grant",
          actors: [ghostId],
          ts: Date.now(),
        });

        const bag = yield* ledger.bag(ghostId);
        const gold = bag.holdings.find(h => h.resource === "GoldCoin");
        assert.equal(gold?.qty, 50, "ghost should have 50 GoldCoin");
      })
    );
  });

  it("second seed attempt with same tx ID is rejected (no double-seeding)", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-funder-002";
    const txId = "ABCDEF1234567890ABCDEF0000";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldSeed]);

        yield* ledger.commit({
          id: txId,
          transfers: [{ resource: "GoldCoin", qty: 50, from: "world", to: ghostId }],
          cause: "agent.resource-grant",
          actors: [ghostId],
          ts: Date.now(),
        });

        // Second attempt with same txId — should fail with DuplicateTransaction
        const result = yield* Effect.either(
          ledger.commit({
            id: txId,
            transfers: [{ resource: "GoldCoin", qty: 50, from: "world", to: ghostId }],
            cause: "agent.resource-grant",
            actors: [ghostId],
            ts: Date.now(),
          })
        );
        assert.equal(result._tag, "Left", "second seed should fail");
        assert.equal((result as any).left._tag, "LedgerError.DuplicateTransaction", "error should be DuplicateTransaction");

        // Balance unchanged
        const bag = yield* ledger.bag(ghostId);
        const gold = bag.holdings.find(h => h.resource === "GoldCoin");
        assert.equal(gold?.qty, 50, "balance should remain 50 after failed re-seed");
      })
    );
  });

  it("ghost without a grant entry is unaffected", async () => {
    const ledger = makeLedger();
    const unrelatedGhostId = "ghost-no-agent-001";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldSeed]);
        // No seeding for this ghost
        const bag = yield* ledger.bag(unrelatedGhostId);
        assert.equal(bag.holdings.length, 0, "unrelated ghost should have no holdings");
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Spawn grant seeding (simulates mcp-server.ts first-connect logic)
// ---------------------------------------------------------------------------

/** Deterministic tx ID matching mcp-server.ts: SHA-256(ghostId:role:itemRef) */
function spawnGrantTxId(ghostId: string, role: string, itemRef: string): string {
  return createHash("sha256").update(`${ghostId}:${role}:${itemRef}`).digest("hex").slice(0, 26);
}

function applySpawnGrant(
  ledger: ReturnType<typeof makeLedger>,
  spawnGrants: SpawnGrant[],
  ghostId: string,
  role: string,
) {
  const grant = spawnGrants.find(g => g.role === role);
  if (!grant) return Effect.void;
  return Effect.forEach(grant.grants, (g) =>
    ledger.commit({
      id: spawnGrantTxId(ghostId, role, g.itemRef),
      transfers: [{ resource: g.itemRef, qty: g.qty, from: "world", to: ghostId }],
      cause: "spawn-grant",
      actors: [ghostId],
      ts: Date.now(),
    }).pipe(
      Effect.catchTag("LedgerError.InsufficientFunds", () => Effect.void),
      Effect.catchTag("LedgerError.DuplicateTransaction", () => Effect.void),
      Effect.asVoid,
    )
  , { discard: true });
}

describe("spawn grant seeding", () => {
  const spawnGrants: SpawnGrant[] = [
    { role: "attendee", grants: [{ itemRef: "BrassKey", qty: 1 }] },
    { role: "explorer", grants: [{ itemRef: "BrassKey", qty: 2 }, { itemRef: "PowerBar", qty: 1 }] },
  ];

  it("attendee ghost receives 1 BrassKey on first connect", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-spawn-001";

    await Effect.runPromise(Effect.gen(function* () {
      yield* ledger.init([{ itemRef: "BrassKey", qty: 10 }]);
      yield* applySpawnGrant(ledger, spawnGrants, ghostId, "attendee");
      const bag = yield* ledger.bag(ghostId);
      const keys = bag.holdings.find(h => h.resource === "BrassKey");
      assert.equal(keys?.qty, 1, "attendee should receive 1 BrassKey");
    }));
  });

  it("explorer ghost receives 2 BrassKey and 1 PowerBar on first connect", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-spawn-002";

    await Effect.runPromise(Effect.gen(function* () {
      yield* ledger.init([
        { itemRef: "BrassKey", qty: 10 },
        { itemRef: "PowerBar", qty: 10 },
      ]);
      yield* applySpawnGrant(ledger, spawnGrants, ghostId, "explorer");
      const bag = yield* ledger.bag(ghostId);
      const keys = bag.holdings.find(h => h.resource === "BrassKey");
      const bars = bag.holdings.find(h => h.resource === "PowerBar");
      assert.equal(keys?.qty, 2, "explorer should receive 2 BrassKey");
      assert.equal(bars?.qty, 1, "explorer should receive 1 PowerBar");
    }));
  });

  it("reconnect (same tx ID) is silently skipped — no double-seeding", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-spawn-003";

    await Effect.runPromise(Effect.gen(function* () {
      yield* ledger.init([{ itemRef: "BrassKey", qty: 10 }]);
      yield* applySpawnGrant(ledger, spawnGrants, ghostId, "attendee");
      yield* applySpawnGrant(ledger, spawnGrants, ghostId, "attendee"); // reconnect
      const bag = yield* ledger.bag(ghostId);
      const keys = bag.holdings.find(h => h.resource === "BrassKey");
      assert.equal(keys?.qty, 1, "balance unchanged after reconnect");
    }));
  });

  it("insufficient world bag balance skips grant without blocking spawn", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-spawn-004";

    await Effect.runPromise(Effect.gen(function* () {
      // World has 0 BrassKey — grant should silently skip
      yield* ledger.init([]);
      yield* applySpawnGrant(ledger, spawnGrants, ghostId, "attendee");
      const bag = yield* ledger.bag(ghostId);
      assert.equal(bag.holdings.length, 0, "ghost should have nothing when world bag empty");
    }));
  });
});
