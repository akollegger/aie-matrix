import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { makeLeaderboardServiceInMemory } from "./LeaderboardServiceInMemory.js";
import type { LeaderboardSpec } from "@aie-matrix/shared-types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SPEC_A: LeaderboardSpec = {
  id: "top-earners",
  title: "Top Earners",
  description: "Ghosts who received the most tokens",
  resource: "tokens",
  aggregation: "sum",
  direction: "received",
  actorKind: "ghost",
};

const SPEC_B: LeaderboardSpec = {
  id: "top-givers",
  title: "Top Givers",
  description: "Ghosts who distributed the most tokens",
  resource: "tokens",
  aggregation: "sum",
  direction: "distributed",
  actorKind: "ghost",
};

function makeSvc() {
  return makeLeaderboardServiceInMemory();
}

async function run<A, E>(eff: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(eff as Effect.Effect<A, never, never>);
}

async function failEffect<E>(eff: Effect.Effect<unknown, E, never>): Promise<E> {
  return Effect.runPromise(Effect.flip(eff));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LeaderboardService (in-memory)", () => {
  it("listLeaderboards() returns [] before init()", async () => {
    const svc = makeSvc();
    const result = await run(svc.listLeaderboards());
    assert.deepEqual(result, []);
  });

  it("listLeaderboards() returns declared specs after init()", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A, SPEC_B]));
    const result = await run(svc.listLeaderboards());
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.id).sort(), ["top-earners", "top-givers"]);
  });

  it("getLeaderboard(id) returns empty entries when no data", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.id, "top-earners");
    assert.deepEqual(result.entries, []);
  });

  it("getLeaderboard('unknown') fails with LeaderboardNotFound", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    const err = await failEffect(svc.getLeaderboard("unknown"));
    assert.equal(err._tag, "LeaderboardError.NotFound");
    assert.equal((err as { leaderboardId: string }).leaderboardId, "unknown");
  });

  it("getLeaderboard(id) after seeding returns correct ranked entries (higher score first)", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    svc.seed("top-earners", [
      { actorId: "ghost-b", displayName: "Ghost B", score: 50, lastContributingAt: "2025-06-01T10:00:00Z" },
      { actorId: "ghost-a", displayName: "Ghost A", score: 100, lastContributingAt: "2025-06-01T09:00:00Z" },
      { actorId: "ghost-c", displayName: "Ghost C", score: 25, lastContributingAt: "2025-06-01T11:00:00Z" },
    ]);
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.entries.length, 3);
    assert.equal(result.entries[0]!.actorId, "ghost-a");
    assert.equal(result.entries[1]!.actorId, "ghost-b");
    assert.equal(result.entries[2]!.actorId, "ghost-c");
  });

  it("tie-breaking: two actors with equal score, earlier lastContributingAt ranks first", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    svc.seed("top-earners", [
      { actorId: "ghost-late", displayName: "Ghost Late", score: 100, lastContributingAt: "2025-06-01T12:00:00Z" },
      { actorId: "ghost-early", displayName: "Ghost Early", score: 100, lastContributingAt: "2025-06-01T08:00:00Z" },
    ]);
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.entries[0]!.actorId, "ghost-early");
    assert.equal(result.entries[1]!.actorId, "ghost-late");
  });

  it("finalizeLeaderboards() sets isFinal: true on subsequent getLeaderboard", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    await run(svc.finalizeLeaderboards());
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.isFinal, true);
  });

  it("finalizeLeaderboards() called twice is idempotent", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    await run(svc.finalizeLeaderboards());
    await run(svc.finalizeLeaderboards()); // should not throw
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.isFinal, true);
  });

  it("getLeaderboard returns isFinal: false when not yet finalized", async () => {
    const svc = makeSvc();
    await run(svc.init([SPEC_A]));
    svc.seed("top-earners", [
      { actorId: "ghost-a", displayName: "Ghost A", score: 10, lastContributingAt: "2025-06-01T09:00:00Z" },
    ]);
    const result = await run(svc.getLeaderboard("top-earners"));
    assert.equal(result.isFinal, false);
  });
});
