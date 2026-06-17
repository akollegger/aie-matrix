import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver, type Session } from "neo4j-driver";
import { Effect, Layer } from "effect";
import { makeLeaderboardServiceLiveLayer } from "./LeaderboardServiceLive.js";
import { LeaderboardService } from "./LeaderboardService.js";
import { WorldBridgeService } from "./WorldBridgeService.js";
import type { ColyseusWorldBridge } from "./colyseus-bridge.js";
import type { LeaderboardSpec } from "@aie-matrix/shared-types";
import { ulid } from "ulid";

const NEO4J_URI = process.env.NEO4J_URI;

// ---------------------------------------------------------------------------
// Stub WorldBridgeService — satisfies full ColyseusWorldBridge interface
// ---------------------------------------------------------------------------

const noop = () => {};
const stubBridge: ColyseusWorldBridge = {
  getLoadedMap: () => ({ cells: [], rules: [] } as any),
  setLoadedMap: noop,
  getGhostCell: () => undefined,
  setGhostCell: noop,
  removeGhostCell: noop,
  listOccupantsOnCell: () => [],
  listAllGhostCells: () => [],
  setGhostMode: noop,
  getGhostMode: () => "normal",
  setTileItems: noop,
  setGhostInventory: noop,
  setGhostLastAction: noop,
  setGhostLabels: noop,
  setGhostGlyph: noop,
  fanoutWorldV1: noop,
};
const stubBridgeLayer = Layer.succeed(WorldBridgeService, stubBridge);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withSession<T>(driver: Driver, fn: (s: Session) => Promise<T>): Promise<T> {
  const s = driver.session();
  try { return await fn(s); } finally { await s.close(); }
}

/** Write a minimal LiveSession + LedgerEntry chain into Neo4j. Returns sessionId. */
async function seedSession(
  driver: Driver,
  sessionId: string,
  transfers: Array<{ resource: string; qty: number; from: string; to: string; cause?: string }>,
): Promise<void> {
  await withSession(driver, async (s) => {
    await s.executeWrite((tx) =>
      tx.run(
        `MERGE (sess:LiveSession { id: $sessionId })
         SET sess.status = "active"`,
        { sessionId },
      ),
    );

    for (let i = 0; i < transfers.length; i++) {
      const t = transfers[i]!;
      const entryId = `entry-${sessionId}-${i}`;
      const ts = Date.now() + i;
      await s.executeWrite((tx) =>
        tx.run(
          `MATCH (sess:LiveSession { id: $sessionId })
           CREATE (e:LedgerEntry {
             id: $entryId,
             cause: $cause,
             transfers: $transfersJson,
             ts: $ts,
             actors: $actors,
             prevHash: "",
             hash: $entryId
           })
           ${i === 0
             ? "MERGE (sess)-[:LEDGER_HEAD]->(e) MERGE (sess)-[:LEDGER_TIP]->(e)"
             : `WITH e
                MATCH (sess)-[:LEDGER_TIP]->(tip)
                MERGE (tip)-[:NEXT_ENTRY]->(e)
                MERGE (sess)-[:LEDGER_TIP]->(e)`
           }`,
          {
            sessionId,
            entryId,
            cause: t.cause ?? "test",
            transfersJson: JSON.stringify([{ resource: t.resource, qty: t.qty, from: t.from, to: t.to }]),
            ts,
            actors: [t.from, t.to],
          },
        ),
      );
    }
  });
}

async function cleanupSession(driver: Driver, sessionId: string): Promise<void> {
  await withSession(driver, (s) =>
    s.executeWrite((tx) =>
      tx.run(
        `MATCH (sess:LiveSession { id: $sessionId })
         OPTIONAL MATCH (sess)-[:LEDGER_HEAD|LEDGER_TIP|SNAPSHOT_OF*0..1]-(n)
         OPTIONAL MATCH (n)-[:NEXT_ENTRY*0..]->(e:LedgerEntry)
         DETACH DELETE sess, n, e`,
        { sessionId },
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LeaderboardServiceLive (integration)", { skip: !NEO4J_URI }, () => {
  let driver: Driver;
  let sessionId: string;
  const goldSpec: LeaderboardSpec = {
    id: "gold-board",
    title: "Gold Board",
    description: "Who got the most gold",
    resource: "gold",
    aggregation: "sum",
    direction: "received",
    actorKind: "ghost",
  };

  before(async () => {
    driver = neo4j.driver(NEO4J_URI!, neo4j.auth.basic(
      process.env.NEO4J_USER ?? "neo4j",
      process.env.NEO4J_PASSWORD ?? "devpassword",
    ));
    sessionId = `test-lb-${ulid()}`;
    await seedSession(driver, sessionId, [
      { resource: "gold", qty: 10, from: "ghost-a", to: "ghost-b" },
      { resource: "gold", qty: 5,  from: "ghost-a", to: "ghost-c" },
      { resource: "gold", qty: 15, from: "ghost-b", to: "ghost-a" },
    ]);
  });

  after(async () => {
    await cleanupSession(driver, sessionId);
    await driver.close();
  });

  function makeLayer() {
    return Layer.provide(makeLeaderboardServiceLiveLayer(driver), stubBridgeLayer);
  }

  it("listLeaderboards returns declared specs", async () => {
    const result = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([goldSpec]);
            return yield* svc.listLeaderboards();
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "gold-board");
  });

  it("getLeaderboard returns ranked entries from real ledger data", async () => {
    const result = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([goldSpec]);
            return yield* svc.getLeaderboard("gold-board");
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    // ghost-a received 15; ghost-b received 10; ghost-c received 5
    assert.equal(result.isFinal, false);
    assert.ok(result.entries.length >= 1, "should have at least one entry");
    // Higher score first
    for (let i = 1; i < result.entries.length; i++) {
      assert.ok(result.entries[i - 1]!.score >= result.entries[i]!.score);
    }
  });

  it("getLeaderboard returns empty entries when no matching ledger data", async () => {
    const emptySpec: LeaderboardSpec = {
      id: "empty-board",
      title: "Empty",
      description: "",
      resource: "rare-token",
      aggregation: "sum",
      direction: "received",
      actorKind: "ghost",
    };
    const result = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([emptySpec]);
            return yield* svc.getLeaderboard("empty-board");
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    assert.deepEqual(result.entries, []);
    assert.equal(result.isFinal, false);
  });

  it("finalizeLeaderboards persists snapshot with isFinal: true", async () => {
    const result = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([goldSpec]);
            yield* svc.finalizeLeaderboards();
            return yield* svc.getLeaderboard("gold-board");
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    assert.equal(result.isFinal, true);

    // Verify :LeaderboardSnapshot node was persisted
    const snapCount = await withSession(driver, (s) =>
      s.executeRead((tx) =>
        tx.run(
          `MATCH (snap:LeaderboardSnapshot { leaderboardId: "gold-board", isFinal: true })
           RETURN count(snap) AS n`,
        ),
      ).then((r) => (r.records[0]!.get("n") as any).toNumber?.() ?? Number(r.records[0]!.get("n"))),
    );
    assert.ok(snapCount >= 1, "snapshot node should exist in Neo4j");
  });

  it("getLeaderboard after finalization returns frozen snapshot (no recompute)", async () => {
    const [first, second] = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([goldSpec]);
            yield* svc.finalizeLeaderboards();
            const r1 = yield* svc.getLeaderboard("gold-board");
            const r2 = yield* svc.getLeaderboard("gold-board");
            return [r1, r2] as const;
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    assert.equal(first!.isFinal, true);
    assert.equal(second!.isFinal, true);
    // computedAt must be identical — frozen snapshot, no recompute
    assert.equal(first!.computedAt, second!.computedAt);
  });

  it("finalizeLeaderboards is idempotent (calling twice is a no-op)", async () => {
    const [r1, r2] = await Effect.runPromise(
      LeaderboardService.pipe(
        Effect.flatMap((svc) =>
          Effect.gen(function* () {
            yield* svc.init([goldSpec]);
            yield* svc.finalizeLeaderboards();
            const first = yield* svc.getLeaderboard("gold-board");
            yield* svc.finalizeLeaderboards(); // second call must be no-op
            const second = yield* svc.getLeaderboard("gold-board");
            return [first, second] as const;
          }),
        ),
        Effect.provide(makeLayer()),
      ),
    );
    assert.equal(r1!.isFinal, true);
    assert.equal(r2!.isFinal, true);
    assert.equal(r1!.computedAt, r2!.computedAt, "computedAt must not change on second finalize");
  });
});
