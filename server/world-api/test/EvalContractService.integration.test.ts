/**
 * Integration tests for EvalContractServiceLive (Neo4j-backed).
 * Skipped when NEO4J_URI is not set — run locally or in CI with a live Neo4j instance.
 *
 * To run:
 *   NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
 *     pnpm --filter @aie-matrix/server-world-api test:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import type { ItemSeed } from "../src/LedgerService.js";
import { makeLedgerServiceLive } from "../src/LedgerServiceLive.js";
import { LedgerService } from "../src/LedgerService.js";
import { GroupService } from "../src/GroupService.js";
import { GroupServiceInMemoryLayer } from "../src/GroupServiceInMemory.js";
import { makeEvalContractServiceLiveLayer } from "../src/EvalContractServiceLive.js";
import { EvalContractService } from "../src/EvalContractService.js";
import { Neo4jGraphService } from "../src/Neo4jGraphService.js";

const NEO4J_URI = process.env["NEO4J_URI"];
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "password";

const TRUST: ItemSeed = { itemRef: "TrustToken", qty: 1000 };

test.skip(!NEO4J_URI, "NEO4J_URI not set — skipping EvalContractService integration tests");

if (NEO4J_URI) {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

  async function setupLedgerSession(sessionId: string): Promise<void> {
    const s = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      await s.run(
        `MATCH (s:LiveSession { id: $id })-[r:LEDGER_HEAD|LEDGER_TIP]->() DELETE r`,
        { id: sessionId },
      );
      await s.run(`MERGE (s:LiveSession { id: $id })`, { id: sessionId });
    } finally {
      await s.close();
    }
  }

  async function cleanContracts(prefix: string): Promise<void> {
    const s = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      await s.run(
        `MATCH (c:EvalContract) WHERE c.clientId STARTS WITH $prefix OR c.contractorId STARTS WITH $prefix DETACH DELETE c`,
        { prefix },
      );
    } finally {
      await s.close();
    }
  }

  /**
   * Build a test runtime: real LedgerServiceLive + GroupServiceInMemory + EvalContractServiceLive.
   * The Neo4jGraphService dependency of makeEvalContractServiceLiveLayer is unused at runtime
   * (it's only wired at the index level for initialisation), so we provide a no-op stub.
   */
  function makeTestLayer(sessionId: string) {
    const ledgerLayer = Layer.succeed(LedgerService, makeLedgerServiceLive(driver, sessionId));
    const neo4jStub = Layer.succeed(Neo4jGraphService, null as unknown as Neo4jGraphService["Type"]);
    const evalLayer = makeEvalContractServiceLiveLayer(driver);
    const deps = Layer.merge(Layer.merge(ledgerLayer, GroupServiceInMemoryLayer), neo4jStub);

    // Layer.provide consumes LedgerService internally; merge it back so test
    // effects can yield* LedgerService directly (e.g. to call init()).
    return Layer.merge(
      Layer.provide(evalLayer, deps),
      ledgerLayer,
    );
  }

  async function run<A, E>(
    sessionId: string,
    eff: Effect.Effect<A, E, EvalContractService | LedgerService>,
  ): Promise<A> {
    const layer = makeTestLayer(sessionId);
    return Effect.runPromise(
      Effect.provide(eff as Effect.Effect<A, E, EvalContractService | LedgerService | GroupService | Neo4jGraphService>, layer as any),
    ) as Promise<A>;
  }

  test("openContract: contract created in Open state, client bag debited", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-open-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      // Give client some trust
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 100, from: "world", to: clientId }],
        cause: "test.seed",
        actors: [],
        ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const contract = yield* evalSvc.openContract({
        clientId,
        contractorId,
        evaluatorId,
        request: "Do the thing",
        stakeResource: "TrustToken",
        stakeAmount: 20,
        deadline: Date.now() + 60_000,
      });

      assert.equal(contract.state, "Open");
      assert.equal(contract.clientId, clientId);
      assert.equal(contract.stakeAmount, 20);

      // Client bag should be debited
      const bag = yield* ledger.bag(clientId);
      const trustHolding = bag.holdings.find(h => h.resource === "TrustToken");
      assert.equal(trustHolding?.qty, 80);
    }));
  });

  test("acceptContract: state transitions to Accepted", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-accept-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 50, from: "world", to: clientId }],
        cause: "test.seed",
        actors: [],
        ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Accept me",
        stakeResource: "TrustToken", stakeAmount: 10,
        deadline: Date.now() + 60_000,
      });

      const accepted = yield* evalSvc.acceptContract({ contractId: opened.id, callerId: contractorId });
      assert.equal(accepted.state, "Accepted");
    }));
  });

  test("declineContract: state transitions to Declined, escrow returned to client", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-decline-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 50, from: "world", to: clientId }],
        cause: "test.seed",
        actors: [],
        ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Decline me",
        stakeResource: "TrustToken", stakeAmount: 15,
        deadline: Date.now() + 60_000,
      });

      // Verify stake was moved out of client
      const bagBefore = yield* ledger.bag(clientId);
      assert.equal(bagBefore.holdings.find(h => h.resource === "TrustToken")?.qty, 35);

      const declined = yield* evalSvc.declineContract({ contractId: opened.id, callerId: contractorId });
      assert.equal(declined.state, "Declined");

      // Verify escrow returned to client
      const bagAfter = yield* ledger.bag(clientId);
      assert.equal(bagAfter.holdings.find(h => h.resource === "TrustToken")?.qty, 50);
    }));
  });

  test("submitContract: state transitions to Submitted, submission recorded", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-submit-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 50, from: "world", to: clientId }],
        cause: "test.seed", actors: [], ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Submit me",
        stakeResource: "TrustToken", stakeAmount: 10,
        deadline: Date.now() + 60_000,
      });

      yield* evalSvc.acceptContract({ contractId: opened.id, callerId: contractorId });

      const submitted = yield* evalSvc.submitContract({
        contractId: opened.id,
        callerId: contractorId,
        submission: "Here is my work",
      });

      assert.equal(submitted.state, "Submitted");
      assert.equal(submitted.submission, "Here is my work");
    }));
  });

  test("evaluateContract at v=1.0: state Settled, contractor receives full stake", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-eval-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 100, from: "world", to: clientId }],
        cause: "test.seed", actors: [], ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Evaluate me at full",
        stakeResource: "TrustToken", stakeAmount: 40,
        deadline: Date.now() + 60_000,
      });

      yield* evalSvc.acceptContract({ contractId: opened.id, callerId: contractorId });
      yield* evalSvc.submitContract({ contractId: opened.id, callerId: contractorId, submission: "Done" });

      const result = yield* evalSvc.evaluateContract({ contractId: opened.id, callerId: evaluatorId, verdict: 1.0 });

      assert.equal(result.state, "Settled");
      assert.equal(result.verdict, 1.0);
      assert.equal(result.contractorPayment, 40);
      assert.equal(result.clientRefund, 0);

      const contractorBag = yield* ledger.bag(contractorId);
      assert.equal(contractorBag.holdings.find(h => h.resource === "TrustToken")?.qty, 40);
    }));
  });

  test("getContract: returns contract to party, rejects non-party", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-get-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;
    const strangerId = `${prefix}-stranger`;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: 50, from: "world", to: clientId }],
        cause: "test.seed", actors: [], ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Get me",
        stakeResource: "TrustToken", stakeAmount: 5,
        deadline: Date.now() + 60_000,
      });

      // Party can retrieve
      const retrieved = yield* evalSvc.getContract({ contractId: opened.id, callerId: clientId });
      assert.equal(retrieved.id, opened.id);

      // Non-party gets error
      const result = yield* Effect.either(
        evalSvc.getContract({ contractId: opened.id, callerId: strangerId }),
      );
      assert.equal(result._tag, "Left");
      assert.equal((result.left as { _tag: string })._tag, "EvalContractError.NotAuthorized");
    }));
  });

  test("settlement invariant: contractor + client = stake at v=0.5", async () => {
    const sessionId = `test-${ulid()}`;
    const prefix = `ghost-inv-${ulid()}`;
    await setupLedgerSession(sessionId);
    await cleanContracts(prefix);

    const clientId = `${prefix}-client`;
    const contractorId = `${prefix}-contractor`;
    const evaluatorId = `${prefix}-evaluator`;
    const stakeAmount = 100;

    await run(sessionId, Effect.gen(function* () {
      const ledger = yield* LedgerService;
      yield* ledger.init([TRUST]);
      yield* ledger.commit({
        id: ulid(),
        transfers: [{ resource: "TrustToken", qty: stakeAmount, from: "world", to: clientId }],
        cause: "test.seed", actors: [], ts: Date.now(),
      });

      const evalSvc = yield* EvalContractService;
      const opened = yield* evalSvc.openContract({
        clientId, contractorId, evaluatorId,
        request: "Half and half",
        stakeResource: "TrustToken", stakeAmount,
        deadline: Date.now() + 60_000,
      });

      yield* evalSvc.acceptContract({ contractId: opened.id, callerId: contractorId });
      yield* evalSvc.submitContract({ contractId: opened.id, callerId: contractorId, submission: "Half done" });
      const result = yield* evalSvc.evaluateContract({ contractId: opened.id, callerId: evaluatorId, verdict: 0.5 });

      assert.equal(result.contractorPayment + result.clientRefund, stakeAmount,
        "contractor + client refund must equal stake (conservation)");

      const contractorBag = yield* ledger.bag(contractorId);
      const clientBag = yield* ledger.bag(clientId);
      const contractorQty = contractorBag.holdings.find(h => h.resource === "TrustToken")?.qty ?? 0;
      const clientQty = clientBag.holdings.find(h => h.resource === "TrustToken")?.qty ?? 0;

      assert.equal(contractorQty + clientQty, stakeAmount,
        "total resources conserved: contractor + client must equal original stake");
    }));
  });

  test.after(async () => {
    await driver.close();
  });
}
