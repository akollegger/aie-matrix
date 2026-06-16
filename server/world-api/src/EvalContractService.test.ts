import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { ulid } from "ulid";
import { makeLedgerServiceInMemory } from "./LedgerServiceInMemory.js";
import { makeGroupServiceInMemory } from "./GroupServiceInMemory.js";
import { makeEvalContractServiceInMemory } from "./EvalContractServiceInMemory.js";
import type { EvalContractServiceOps } from "./EvalContractService.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_RESOURCE = "tokens";
const STAKE = 100;
const DEADLINE_FUTURE = Date.now() + 60_000;
const DEADLINE_PAST = Date.now() - 1;

function makeSuite() {
  const ledger = makeLedgerServiceInMemory();
  const groups = makeGroupServiceInMemory();
  const svc: EvalContractServiceOps = makeEvalContractServiceInMemory(ledger, groups);
  return { ledger, groups, svc };
}

async function initLedger(ledger: ReturnType<typeof makeLedgerServiceInMemory>) {
  await Effect.runPromise(
    ledger.init([{ itemRef: TEST_RESOURCE, qty: 10_000 }]),
  );
  // Seed client with tokens from world bag
  await Effect.runPromise(
    ledger.commit({
      id: ulid(),
      transfers: [{ resource: TEST_RESOURCE, qty: 5_000, from: "world", to: "client" }],
      cause: "test.seed",
      actors: ["world"],
      ts: Date.now(),
    }),
  );
}

async function failEffect<E>(eff: Effect.Effect<unknown, E, never>): Promise<E> {
  return Effect.runPromise(Effect.flip(eff));
}

// ---------------------------------------------------------------------------
// US1: Client Opens a Contract
// ---------------------------------------------------------------------------

describe("US1: openContract", () => {
  it("happy path: contract is Open, client bag is debited, escrow is credited", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    assert.equal(contract.state, "Open");
    assert.equal(contract.clientId, "client");
    assert.equal(contract.contractorId, "contractor");
    assert.equal(contract.evaluatorId, "evaluator");
    assert.equal(contract.stakeAmount, STAKE);
    assert.equal(contract.submission, null);
    assert.deepEqual(contract.beneficiaries, []);
    assert.match(contract.escrowActorId, /^escrow:/);

    // Client bag should be debited
    const clientBag = await Effect.runPromise(ledger.bag("client"));
    const clientTokens = clientBag.holdings.find(h => h.resource === TEST_RESOURCE);
    assert.equal(clientTokens?.qty, 5_000 - STAKE);

    // Escrow should be credited
    const escrowBag = await Effect.runPromise(ledger.bag(contract.escrowActorId));
    const escrowTokens = escrowBag.holdings.find(h => h.resource === TEST_RESOURCE);
    assert.equal(escrowTokens?.qty, STAKE);
  });

  it("rejects when evaluator is the same as contractor", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const err = await failEffect(
      svc.openContract({
        clientId: "client",
        contractorId: "ghost1",
        evaluatorId: "ghost1",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );
    assert.equal((err as any)._tag, "EvalContractError.InvalidEvaluator");
  });

  it("rejects when client has insufficient funds", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const err = await failEffect(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: 99_999,
        deadline: DEADLINE_FUTURE,
      }),
    );
    assert.equal((err as any)._tag, "LedgerError.InsufficientFunds");
  });
});

describe("US1: getContract", () => {
  it("client can get contract", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const retrieved = await Effect.runPromise(
      svc.getContract({ contractId: contract.id, callerId: "client" }),
    );
    assert.equal(retrieved.id, contract.id);
  });

  it("contractor can get contract", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const retrieved = await Effect.runPromise(
      svc.getContract({ contractId: contract.id, callerId: "contractor" }),
    );
    assert.equal(retrieved.id, contract.id);
  });

  it("evaluator can get contract", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const retrieved = await Effect.runPromise(
      svc.getContract({ contractId: contract.id, callerId: "evaluator" }),
    );
    assert.equal(retrieved.id, contract.id);
  });

  it("non-party cannot get contract", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const err = await failEffect(
      svc.getContract({ contractId: contract.id, callerId: "random-ghost" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotAuthorized");
  });

  it("returns NotFound for unknown contract", async () => {
    const { svc } = makeSuite();
    const err = await failEffect(
      svc.getContract({ contractId: "UNKNOWN", callerId: "client" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotFound");
  });
});

describe("US1: listContracts", () => {
  it("filters by caller role", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const clientList = await Effect.runPromise(svc.listContracts({ callerId: "client" }));
    assert.equal(clientList.length, 1);
    assert.equal(clientList[0]!.id, contract.id);

    const outsiderList = await Effect.runPromise(svc.listContracts({ callerId: "random-ghost" }));
    assert.equal(outsiderList.length, 0);
  });

  it("filters by state", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const openList = await Effect.runPromise(svc.listContracts({ callerId: "client", state: "Open" }));
    assert.equal(openList.length, 1);

    const acceptedList = await Effect.runPromise(svc.listContracts({ callerId: "client", state: "Accepted" }));
    assert.equal(acceptedList.length, 0);
  });
});

// ---------------------------------------------------------------------------
// US2: Contractor Accepts and Submits
// ---------------------------------------------------------------------------

describe("US2: acceptContract", () => {
  it("happy path: transitions to Accepted", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const accepted = await Effect.runPromise(
      svc.acceptContract({ contractId: contract.id, callerId: "contractor" }),
    );
    assert.equal(accepted.state, "Accepted");
    assert.deepEqual(accepted.beneficiaries, []);
  });

  it("rejects when caller is not the contractor", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const err = await failEffect(
      svc.acceptContract({ contractId: contract.id, callerId: "wrong-ghost" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotAuthorized");
  });

  it("rejects when contract is not in Open state", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));

    const err = await failEffect(
      svc.acceptContract({ contractId: contract.id, callerId: "contractor" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.WrongState");
  });
});

describe("US2: declineContract", () => {
  it("happy path: transitions to Declined, escrow returned to client", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const declined = await Effect.runPromise(
      svc.declineContract({ contractId: contract.id, callerId: "contractor" }),
    );
    assert.equal(declined.state, "Declined");

    const clientBag = await Effect.runPromise(ledger.bag("client"));
    const clientTokens = clientBag.holdings.find(h => h.resource === TEST_RESOURCE);
    assert.equal(clientTokens?.qty, 5_000);
  });

  it("rejects when caller is not the contractor", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const err = await failEffect(
      svc.declineContract({ contractId: contract.id, callerId: "wrong-ghost" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotAuthorized");
  });
});

describe("US2: submitContract", () => {
  it("happy path: transitions to Submitted", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));

    const submitted = await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "my answer" }),
    );
    assert.equal(submitted.state, "Submitted");
    assert.equal(submitted.submission, "my answer");
  });

  it("rejects submission past deadline (transitions to Expired)", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_PAST,
      }),
    );

    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));

    const err = await failEffect(
      svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "late" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.DeadlineExpired");

    // Contract should now be Expired
    const expired = await Effect.runPromise(
      svc.getContract({ contractId: contract.id, callerId: "client" }),
    );
    assert.equal(expired.state, "Expired");
  });

  it("rejects when caller is not the contractor", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));

    const err = await failEffect(
      svc.submitContract({ contractId: contract.id, callerId: "wrong-ghost", submission: "answer" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotAuthorized");
  });

  it("rejects re-submission (wrong state)", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "first" }),
    );

    const err = await failEffect(
      svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "second" }),
    );
    assert.equal((err as any)._tag, "EvalContractError.WrongState");
  });
});

// ---------------------------------------------------------------------------
// US3: Evaluator Issues Verdict and Contract Settles
// ---------------------------------------------------------------------------

async function openAcceptSubmit(svc: EvalContractServiceOps, ledger: ReturnType<typeof makeLedgerServiceInMemory>) {
  await initLedger(ledger);
  const contract = await Effect.runPromise(
    svc.openContract({
      clientId: "client",
      contractorId: "contractor",
      evaluatorId: "evaluator",
      request: "do something",
      stakeResource: TEST_RESOURCE,
      stakeAmount: STAKE,
      deadline: DEADLINE_FUTURE,
    }),
  );
  await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));
  await Effect.runPromise(
    svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "my answer" }),
  );
  return contract;
}

describe("US3: evaluateContract", () => {
  it("verdict=1.0: contractor receives full stake", async () => {
    const { ledger, svc } = makeSuite();
    const contract = await openAcceptSubmit(svc, ledger);

    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 1.0 }),
    );
    assert.equal(result.state, "Settled");
    assert.equal(result.verdict, 1.0);
    assert.equal(result.contractorPayment, STAKE);
    assert.equal(result.clientRefund, 0);
    assert.equal(result.contractorPayment + result.clientRefund, STAKE);
  });

  it("verdict=0.0: client receives full refund", async () => {
    const { ledger, svc } = makeSuite();
    const contract = await openAcceptSubmit(svc, ledger);

    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 0.0 }),
    );
    assert.equal(result.state, "Settled");
    assert.equal(result.contractorPayment, 0);
    assert.equal(result.clientRefund, STAKE);
    assert.equal(result.contractorPayment + result.clientRefund, STAKE);
  });

  it("verdict=0.75: proportional split, settlement invariant holds", async () => {
    const { ledger, svc } = makeSuite();
    const contract = await openAcceptSubmit(svc, ledger);

    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 0.75 }),
    );
    assert.equal(result.contractorPayment, Math.floor(STAKE * 0.75));
    assert.equal(result.clientRefund, STAKE - Math.floor(STAKE * 0.75));
    assert.equal(result.contractorPayment + result.clientRefund, STAKE);
  });

  it("settlement invariant: contractor + client === stake for many verdicts", async () => {
    for (const verdict of [0.0, 0.1, 0.33, 0.5, 0.67, 0.75, 0.9, 1.0]) {
      const { ledger, svc } = makeSuite();
      const contract = await openAcceptSubmit(svc, ledger);
      const result = await Effect.runPromise(
        svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict }),
      );
      assert.equal(
        result.contractorPayment + result.clientRefund,
        STAKE,
        `invariant failed for verdict=${verdict}`,
      );
    }
  });

  it("rejects when caller is not the evaluator", async () => {
    const { ledger, svc } = makeSuite();
    const contract = await openAcceptSubmit(svc, ledger);

    const err = await failEffect(
      svc.evaluateContract({ contractId: contract.id, callerId: "wrong-ghost", verdict: 0.5 }),
    );
    assert.equal((err as any)._tag, "EvalContractError.NotAuthorized");
  });

  it("rejects evaluation in wrong state (not Submitted)", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    const err = await failEffect(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 0.5 }),
    );
    assert.equal((err as any)._tag, "EvalContractError.WrongState");
  });
});

// ---------------------------------------------------------------------------
// US4: Group Contractor Receives Proportional Shares
// ---------------------------------------------------------------------------

describe("US4: group contractor", () => {
  it("beneficiaries frozen at accept, not at open", async () => {
    const { ledger, svc, groups } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      groups.createGroup({
        groupId: "group1",
        ghostA: "memberA",
        ghostB: "memberB",
        resource: TEST_RESOURCE,
        amount: 0,
        formationTxId: ulid(),
      }),
    );

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "group1",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    assert.deepEqual(contract.beneficiaries, []);

    const accepted = await Effect.runPromise(
      svc.acceptContract({ contractId: contract.id, callerId: "group1" }),
    );
    assert.equal(accepted.beneficiaries.length, 2);
    assert.ok(accepted.beneficiaries.includes("memberA"));
    assert.ok(accepted.beneficiaries.includes("memberB"));
  });

  it("settlement with N=2: correct per-share and remainder", async () => {
    const { ledger, svc, groups } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      groups.createGroup({
        groupId: "group2",
        ghostA: "memberA",
        ghostB: "memberB",
        resource: TEST_RESOURCE,
        amount: 0,
        formationTxId: ulid(),
      }),
    );

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "group2",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: 100,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "group2" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "group2", submission: "group answer" }),
    );

    // verdict=0.75, stake=100, N=2: perShare=floor(100*0.75/2)=floor(37.5)=37
    // total paid = 74, clientRefund = 26
    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 0.75 }),
    );

    const perShare = Math.floor(100 * 0.75 / 2);
    assert.equal(result.contractorPayment, perShare * 2);
    assert.equal(result.clientRefund, 100 - perShare * 2);
    assert.equal(result.contractorPayment + result.clientRefund, 100);
    assert.equal(result.movements.filter(m => m.to !== "client").length, 2);
  });

  it("odd-remainder: 11-token stake, verdict=1, 2 members → 5 each + 1 refund to client", async () => {
    const { ledger, svc, groups } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      groups.createGroup({
        groupId: "group-odd",
        ghostA: "odd-memberA",
        ghostB: "odd-memberB",
        resource: TEST_RESOURCE,
        amount: 0,
        formationTxId: ulid(),
      }),
    );

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "group-odd",
        evaluatorId: "evaluator",
        request: "odd payout test",
        stakeResource: TEST_RESOURCE,
        stakeAmount: 11,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "group-odd" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "group-odd", submission: "answer" }),
    );

    // verdict=1, stake=11, N=2: perShare=floor(11*1/2)=floor(5.5)=5
    // total paid = 10, clientRefund = 1
    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 1 }),
    );

    assert.equal(result.contractorPayment, 10, "2 members × 5 = 10");
    assert.equal(result.clientRefund, 1, "remainder 1 returned to client");
    assert.equal(result.contractorPayment + result.clientRefund, 11, "conservation holds");

    // Verify ledger bags
    const bagA = await Effect.runPromise(ledger.bag("odd-memberA"));
    const bagB = await Effect.runPromise(ledger.bag("odd-memberB"));
    assert.equal(bagA.holdings.find(h => h.resource === TEST_RESOURCE)?.qty, 5, "memberA receives 5");
    assert.equal(bagB.holdings.find(h => h.resource === TEST_RESOURCE)?.qty, 5, "memberB receives 5");
  });

  it("evaluator=beneficiary is rejected", async () => {
    const { ledger, svc, groups } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      groups.createGroup({
        groupId: "group3",
        ghostA: "memberA",
        ghostB: "memberB",
        resource: TEST_RESOURCE,
        amount: 0,
        formationTxId: ulid(),
      }),
    );

    // evaluatorId is "memberA" who will be frozen as a beneficiary at accept
    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "group3",
        evaluatorId: "memberA",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "group3" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "group3", submission: "answer" }),
    );

    const err = await failEffect(
      svc.evaluateContract({ contractId: contract.id, callerId: "memberA", verdict: 0.5 }),
    );
    assert.equal((err as any)._tag, "EvalContractError.InvalidEvaluator");
  });

  it("N=1 edge case: single beneficiary receives per-share", async () => {
    const { ledger, svc, groups } = makeSuite();
    await initLedger(ledger);

    await Effect.runPromise(
      groups.createGroup({
        groupId: "group4",
        ghostA: "soloMember",
        ghostB: "memberB",
        resource: TEST_RESOURCE,
        amount: 0,
        formationTxId: ulid(),
      }),
    );
    await Effect.runPromise(
      groups.leave({ groupId: "group4", ghostId: "memberB", leaveTxId: ulid() }),
    );

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "group4",
        evaluatorId: "evaluator",
        request: "do something",
        stakeResource: TEST_RESOURCE,
        stakeAmount: 100,
        deadline: DEADLINE_FUTURE,
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "group4" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "group4", submission: "solo answer" }),
    );

    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "evaluator", verdict: 1.0 }),
    );
    assert.equal(result.contractorPayment, 100);
    assert.equal(result.clientRefund, 0);
    assert.equal(result.contractorPayment + result.clientRefund, 100);
  });
});

// ---------------------------------------------------------------------------
// Exam contract path: artifactRef / disclosureRef
// ---------------------------------------------------------------------------

describe("Exam contract: artifactRef and disclosureRef", () => {
  it("quizmaster path: artifactRef and disclosureRef are stored on open", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "client",
        request: "exam",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
        artifactRef: "aaaa1111",
        disclosureRef: "bbbb2222",
      }),
    );

    assert.equal(contract.artifactRef, "aaaa1111");
    assert.equal(contract.disclosureRef, "bbbb2222");
  });

  it("broker path: artifactRef and disclosureRef default to null when not provided", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "evaluator",
        request: "broker question",
        stakeResource: TEST_RESOURCE,
        stakeAmount: STAKE,
        deadline: DEADLINE_FUTURE,
      }),
    );

    assert.equal(contract.artifactRef, null);
    assert.equal(contract.disclosureRef, null);
  });

  it("proportional settlement: verdict 0.67 on stake 3 yields ceil(0.67 × 3) = 3", async () => {
    const { ledger, svc } = makeSuite();
    await initLedger(ledger);

    const contract = await Effect.runPromise(
      svc.openContract({
        clientId: "client",
        contractorId: "contractor",
        evaluatorId: "client",
        request: "exam",
        stakeResource: TEST_RESOURCE,
        stakeAmount: 3,
        deadline: DEADLINE_FUTURE,
        artifactRef: "aaaa1111",
        disclosureRef: "bbbb2222",
      }),
    );
    await Effect.runPromise(svc.acceptContract({ contractId: contract.id, callerId: "contractor" }));
    await Effect.runPromise(
      svc.submitContract({ contractId: contract.id, callerId: "contractor", submission: "answers" }),
    );

    const result = await Effect.runPromise(
      svc.evaluateContract({ contractId: contract.id, callerId: "client", verdict: 2 / 3 }),
    );
    assert.equal(result.contractorPayment, 2);
    assert.equal(result.clientRefund, 1);
  });
});
