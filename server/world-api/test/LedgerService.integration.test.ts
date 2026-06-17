/**
 * Integration tests for LedgerServiceLive (Neo4j-backed).
 * Skipped when NEO4J_URI is not set — run locally or in CI with a live Neo4j instance.
 *
 * To run:
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
 *     pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ItemSeed } from "../src/LedgerService.js";
import { makeLedgerServiceLive } from "../src/LedgerServiceLive.js";

const NEO4J_URI = process.env["NEO4J_URI"];
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "password";

const GOLD: ItemSeed = { itemRef: "GoldCoin", qty: 100 };

test.skip(!NEO4J_URI, "NEO4J_URI not set — skipping integration tests");

if (NEO4J_URI) {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

  async function setupSession(sessionId: string): Promise<void> {
    const s = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      // Remove any stale ledger entries from a previous run
      await s.run(
        `MATCH (n:LedgerEntry) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: sessionId }
      );
      await s.run(
        `MATCH (s:LiveSession { id: $id })-[r:LEDGER_HEAD|LEDGER_TIP]->() DELETE r`,
        { id: sessionId }
      );
      // Ensure the LiveSession node exists — LedgerServiceLive requires it
      await s.run(
        `MERGE (s:LiveSession { id: $id })`,
        { id: sessionId }
      );
    } finally {
      await s.close();
    }
  }

  test("genesis seed written to Neo4j on init", async () => {
    const sessionId = `test-${ulid()}`;
    await setupSession(sessionId);
    const svc = makeLedgerServiceLive(driver, sessionId);
    await Effect.runPromise(svc.init([GOLD]));

    const rs = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await rs.run(
        `MATCH (e:LedgerEntry { cause: "seed" }) WHERE e.id IS NOT NULL RETURN e.id LIMIT 1`
      );
      assert.ok(result.records.length > 0, "genesis LedgerEntry should exist in Neo4j");
    } finally {
      await rs.close();
    }
  });

  test("balances survive restart: replay from genesis", async () => {
    const sessionId = `test-${ulid()}`;
    await setupSession(sessionId);

    // First instance — init and commit a reward
    const svc1 = makeLedgerServiceLive(driver, sessionId);
    await Effect.runPromise(svc1.init([GOLD]));
    await Effect.runPromise(svc1.commit({
      id: ulid(), transfers: [{ from: "world", to: "ghost-001", resource: "GoldCoin", qty: 20 }],
      cause: "reward", actors: ["ghost-001"], ts: Date.now()
    }));
    const pre = await Effect.runPromise(svc1.bag("ghost-001"));
    assert.equal(pre.holdings.find(h => h.resource === "GoldCoin")?.qty, 20);

    // Second instance — replays from Neo4j
    const svc2 = makeLedgerServiceLive(driver, sessionId);
    await Effect.runPromise(svc2.init([GOLD]));
    const post = await Effect.runPromise(svc2.bag("ghost-001"));
    assert.equal(post.holdings.find(h => h.resource === "GoldCoin")?.qty, 20,
      "balance should survive restart via Neo4j replay");
  });

  test("LEDGER_HEAD and LEDGER_TIP relationships correct after N appends", async () => {
    const sessionId = `test-${ulid()}`;
    await setupSession(sessionId);
    const svc = makeLedgerServiceLive(driver, sessionId);
    await Effect.runPromise(svc.init([GOLD]));

    const id1 = ulid();
    const id2 = ulid();
    await Effect.runPromise(svc.commit({ id: id1, transfers: [{ from: "world", to: "ghost-a", resource: "GoldCoin", qty: 10 }], cause: "r1", actors: [], ts: Date.now() }));
    await Effect.runPromise(svc.commit({ id: id2, transfers: [{ from: "world", to: "ghost-b", resource: "GoldCoin", qty: 5 }],  cause: "r2", actors: [], ts: Date.now() }));

    const rs = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await rs.run(
        `MATCH (s:LiveSession { id: $sessionId })
         MATCH (s)-[:LEDGER_HEAD]->(head)
         MATCH (s)-[:LEDGER_TIP]->(tip)
         RETURN head.cause AS headCause, tip.id AS tipId`,
        { sessionId }
      );
      const rec = result.records[0];
      assert.equal(rec?.get("headCause"), "seed", "LEDGER_HEAD should point to genesis");
      assert.equal(rec?.get("tipId"), id2, "LEDGER_TIP should point to last committed entry");
    } finally {
      await rs.close();
    }
  });

  test("verify() passes on persisted chain", async () => {
    const sessionId = `test-${ulid()}`;
    await setupSession(sessionId);
    const svc = makeLedgerServiceLive(driver, sessionId);
    await Effect.runPromise(svc.init([GOLD]));
    await Effect.runPromise(svc.commit({ id: ulid(), transfers: [{ from: "world", to: "ghost-x", resource: "GoldCoin", qty: 10 }], cause: "test", actors: [], ts: Date.now() }));
    const result = await Effect.runPromise(svc.verify());
    assert.ok(result.entries >= 2, "should have genesis + 1 commit entries");
  });

  test.after(async () => {
    await driver.close();
  });
}
