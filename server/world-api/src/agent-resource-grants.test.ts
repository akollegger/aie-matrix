import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { makeLedgerServiceInMemory } from "./LedgerServiceInMemory.js";
import type { ResourceType } from "@aie-matrix/shared-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger() {
  return makeLedgerServiceInMemory();
}

const goldType: ResourceType = {
  id: "gold",
  label: "Gold",
  class: "conserved",
  qty: 100,
  floor: 0,
};

const funderCreditsType: ResourceType = {
  id: "funder-credits",
  label: "Funder Credits",
  class: "conserved",
  qty: 0,
  floor: 0,
};

// ---------------------------------------------------------------------------
// I-T005: ensureResourceType tests
// ---------------------------------------------------------------------------

describe("ensureResourceType", () => {
  it("registers a new resource type", async () => {
    const ledger = makeLedger();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([]);
        yield* ledger.ensureResourceType(funderCreditsType);
        const types = yield* ledger.resourceTypes();
        assert.ok(types.some(t => t.id === "funder-credits"), "funder-credits should be registered");
      })
    );
  });

  it("second call is a no-op (does not throw, original label preserved)", async () => {
    const ledger = makeLedger();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([]);
        yield* ledger.ensureResourceType(funderCreditsType);
        // Call again with different label — should not overwrite
        yield* ledger.ensureResourceType({ ...funderCreditsType, label: "Different Label" });
        const types = yield* ledger.resourceTypes();
        const fc = types.find(t => t.id === "funder-credits");
        assert.equal(fc?.label, "Funder Credits", "original label should be preserved");
      })
    );
  });
});

// ---------------------------------------------------------------------------
// I-T005: seeding tests (simulating what mcp-server.ts does)
// ---------------------------------------------------------------------------

describe("agent resource grant seeding", () => {
  it("ghost with a grant receives the declared qty on first seed", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-funder-001";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldType]);

        // Ensure funder-credits type
        yield* ledger.ensureResourceType(funderCreditsType);

        // Seed the ghost (simulating mcp-server first-connect logic)
        yield* ledger.commit({
          id: "ABCDEF1234567890ABCDEF1234", // deterministic tx id
          transfers: [{ resource: "funder-credits", qty: 50, from: "world", to: ghostId }],
          cause: "agent.resource-grant",
          actors: [ghostId],
          ts: Date.now(),
        });

        const bag = yield* ledger.bag(ghostId);
        const fc = bag.holdings.find(h => h.resource === "funder-credits");
        assert.equal(fc?.qty, 50, "ghost should have 50 funder-credits");
      })
    );
  });

  it("second seed attempt with same tx ID is rejected (no double-seeding)", async () => {
    const ledger = makeLedger();
    const ghostId = "ghost-funder-002";
    const txId = "ABCDEF1234567890ABCDEF0000";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldType]);
        yield* ledger.ensureResourceType(funderCreditsType);

        yield* ledger.commit({
          id: txId,
          transfers: [{ resource: "funder-credits", qty: 50, from: "world", to: ghostId }],
          cause: "agent.resource-grant",
          actors: [ghostId],
          ts: Date.now(),
        });

        // Second attempt with same txId — should fail with DuplicateTransaction
        const result = yield* Effect.either(
          ledger.commit({
            id: txId,
            transfers: [{ resource: "funder-credits", qty: 50, from: "world", to: ghostId }],
            cause: "agent.resource-grant",
            actors: [ghostId],
            ts: Date.now(),
          })
        );
        assert.equal(result._tag, "Left", "second seed should fail");
        assert.equal((result as any).left._tag, "LedgerError.DuplicateTransaction", "error should be DuplicateTransaction");

        // Balance unchanged
        const bag = yield* ledger.bag(ghostId);
        const fc = bag.holdings.find(h => h.resource === "funder-credits");
        assert.equal(fc?.qty, 50, "balance should remain 50 after failed re-seed");
      })
    );
  });

  it("ghost without a catalog entry is unaffected", async () => {
    const ledger = makeLedger();
    const unrelatedGhostId = "ghost-no-agent-001";

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.init([goldType]);
        // No ensureResourceType, no seeding for this ghost
        const bag = yield* ledger.bag(unrelatedGhostId);
        assert.equal(bag.holdings.length, 0, "unrelated ghost should have no holdings");
      })
    );
  });
});
