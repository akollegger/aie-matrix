import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import type { EvalContract, EvalContractId, EvalContractState } from "@aie-matrix/shared-types";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import {
  EvalContractDeadlineExpired,
  EvalContractInvalidEvaluator,
  EvalContractNotAuthorized,
  EvalContractNotFound,
  EvalContractPersistenceError,
  EvalContractWrongState,
} from "./eval-contract-errors.js";
import { EvalContractService, type EvalContractServiceOps } from "./EvalContractService.js";
import { LedgerService } from "./LedgerService.js";
import { GroupService } from "./GroupService.js";
import { Neo4jGraphService } from "./Neo4jGraphService.js";

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v !== null && typeof v === "object" && typeof (v as { toNumber?(): number }).toNumber === "function") {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

function rowToContract(r: Neo4jRecord): EvalContract {
  return {
    id: r.get("id") as EvalContractId,
    clientId: r.get("clientId") as string,
    contractorId: r.get("contractorId") as string,
    evaluatorId: r.get("evaluatorId") as string,
    request: r.get("request") as string,
    submission: (r.get("submission") as string | null) ?? null,
    stakeResource: r.get("stakeResource") as string,
    stakeAmount: toNumber(r.get("stakeAmount")),
    deadline: toNumber(r.get("deadline")),
    state: r.get("state") as EvalContractState,
    verdict: r.get("verdict") == null ? null : toNumber(r.get("verdict")),
    beneficiaries: (r.get("beneficiaries") as string[] | null) ?? [],
    openedAt: toNumber(r.get("openedAt")),
    escrowActorId: r.get("escrowActorId") as string,
    artifactRef: (r.get("artifactRef") as string | null) ?? null,
    disclosureRef: (r.get("disclosureRef") as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cypher constants
// ---------------------------------------------------------------------------

const UPSERT_CYPHER = `
MERGE (c:EvalContract {id: $id})
SET c.clientId = $clientId,
    c.contractorId = $contractorId,
    c.evaluatorId = $evaluatorId,
    c.request = $request,
    c.submission = $submission,
    c.stakeResource = $stakeResource,
    c.stakeAmount = $stakeAmount,
    c.deadline = $deadline,
    c.state = $state,
    c.verdict = $verdict,
    c.beneficiaries = $beneficiaries,
    c.openedAt = $openedAt,
    c.escrowActorId = $escrowActorId,
    c.artifactRef = $artifactRef,
    c.disclosureRef = $disclosureRef
`;

const SELECT_BY_ID_CYPHER = `
MATCH (c:EvalContract {id: $id})
RETURN c.id AS id, c.clientId AS clientId, c.contractorId AS contractorId,
       c.evaluatorId AS evaluatorId, c.request AS request,
       c.submission AS submission, c.stakeResource AS stakeResource,
       c.stakeAmount AS stakeAmount, c.deadline AS deadline,
       c.state AS state, c.verdict AS verdict, c.beneficiaries AS beneficiaries,
       c.openedAt AS openedAt, c.escrowActorId AS escrowActorId,
       c.artifactRef AS artifactRef, c.disclosureRef AS disclosureRef
`;

function contractParams(c: EvalContract) {
  return {
    id: c.id,
    clientId: c.clientId,
    contractorId: c.contractorId,
    evaluatorId: c.evaluatorId,
    request: c.request,
    submission: c.submission ?? null,
    stakeResource: c.stakeResource,
    stakeAmount: c.stakeAmount,
    deadline: c.deadline,
    state: c.state,
    verdict: c.verdict ?? null,
    beneficiaries: c.beneficiaries,
    openedAt: c.openedAt,
    escrowActorId: c.escrowActorId,
    artifactRef: c.artifactRef ?? null,
    disclosureRef: c.disclosureRef ?? null,
  };
}

// ---------------------------------------------------------------------------
// Lazy expiry helper
// ---------------------------------------------------------------------------

async function checkAndApplyExpiry(
  contract: EvalContract,
  driver: Driver,
  ledger: LedgerService["Type"],
): Promise<EvalContract> {
  if (contract.state !== "Accepted") return contract;
  if (Date.now() <= contract.deadline) return contract;

  // Transition to Expired: return escrow to client (skip if zero-stake)
  if (contract.stakeAmount > 0) {
    try {
      await Effect.runPromise(
        ledger.commit({
          id: ulid(),
          transfers: [
            {
              resource: contract.stakeResource,
              qty: contract.stakeAmount,
              from: contract.escrowActorId,
              to: contract.clientId,
            },
          ],
          cause: "eval-contract.expired",
          actors: [contract.clientId, contract.contractorId],
          ts: Date.now(),
        }),
      );
    } catch {
      // If ledger commit fails (e.g. already refunded), still mark as expired
    }
  }

  const expired: EvalContract = { ...contract, state: "Expired" };
  const session = driver.session();
  try {
    await session.executeWrite((tx) => tx.run(UPSERT_CYPHER, contractParams(expired)));
  } finally {
    await session.close();
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Live Neo4j-backed implementation
// ---------------------------------------------------------------------------

function makeEvalContractServiceLive(
  driver: Driver,
  ledger: LedgerService["Type"],
  groups: GroupService["Type"],
): EvalContractServiceOps {
  async function persist(contract: EvalContract): Promise<void> {
    const session = driver.session();
    try {
      await session.executeWrite((tx) => tx.run(UPSERT_CYPHER, contractParams(contract)));
    } finally {
      await session.close();
    }
  }

  async function load(contractId: EvalContractId): Promise<EvalContract | null> {
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(SELECT_BY_ID_CYPHER, { id: contractId }),
      );
      if (result.records.length === 0) return null;
      return rowToContract(result.records[0]!);
    } finally {
      await session.close();
    }
  }

  const persistEff = (contract: EvalContract) =>
    Effect.tryPromise({
      try: () => persist(contract),
      catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
    });

  const loadEff = (contractId: EvalContractId) =>
    Effect.tryPromise({
      try: () => load(contractId),
      catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
    });

  const expiryEff = (contract: EvalContract) =>
    Effect.tryPromise({
      try: () => checkAndApplyExpiry(contract, driver, ledger),
      catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
    });

  return {
    openContract({ clientId, contractorId, evaluatorId, request, stakeResource, stakeAmount, deadline, artifactRef, disclosureRef }) {
      return Effect.gen(function* () {
        if (evaluatorId === contractorId) {
          return yield* Effect.fail(
            new EvalContractInvalidEvaluator({
              evaluatorId,
              reason: "Evaluator cannot be the same as the contractor",
            }),
          );
        }

        const id: EvalContractId = ulid();
        const escrowActorId = `escrow:${id}`;
        const openedAt = Date.now();

        // Debit stake from client to escrow (skip if zero-stake — ledger requires qty > 0)
        if (stakeAmount > 0) {
          yield* ledger.commit({
            id: ulid(),
            transfers: [
              { resource: stakeResource, qty: stakeAmount, from: clientId, to: escrowActorId },
            ],
            cause: "eval-contract.open",
            actors: [clientId],
            ts: openedAt,
          });
        }

        const contract: EvalContract = {
          id,
          clientId,
          contractorId,
          evaluatorId,
          request,
          submission: null,
          stakeResource,
          stakeAmount,
          deadline,
          state: "Open",
          verdict: null,
          beneficiaries: [],
          openedAt,
          escrowActorId,
          artifactRef: artifactRef ?? null,
          disclosureRef: disclosureRef ?? null,
        };

        yield* persistEff(contract);
        return contract;
      });
    },

    acceptContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = yield* loadEff(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        if (raw.state !== "Open") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Open", actual: raw.state }),
          );
        }

        // Authorization: caller must be the contractorId (ghost) or a current member of the group
        if (callerId !== raw.contractorId) {
          const membersEither = yield* Effect.either(groups.getGroupMembers(raw.contractorId));
          if (membersEither._tag !== "Right" || !membersEither.right.includes(callerId)) {
            return yield* Effect.fail(
              new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the contractor can accept" }),
            );
          }
        }

        let beneficiaries: string[] = [];
        const groupMembers = yield* Effect.either(groups.getGroupMembers(raw.contractorId));
        if (groupMembers._tag === "Right") {
          beneficiaries = groupMembers.right;
        }

        const updated: EvalContract = { ...raw, state: "Accepted", beneficiaries };
        yield* persistEff(updated);
        return updated;
      });
    },

    declineContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = yield* loadEff(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        if (raw.state !== "Open") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Open", actual: raw.state }),
          );
        }

        // Authorization: caller must be the contractorId (ghost) or a current member of the group
        if (callerId !== raw.contractorId) {
          const membersEither = yield* Effect.either(groups.getGroupMembers(raw.contractorId));
          if (membersEither._tag !== "Right" || !membersEither.right.includes(callerId)) {
            return yield* Effect.fail(
              new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the contractor can decline" }),
            );
          }
        }

        // Return escrow to client (skip if zero-stake)
        if (raw.stakeAmount > 0) {
          yield* ledger.commit({
            id: ulid(),
            transfers: [
              {
                resource: raw.stakeResource,
                qty: raw.stakeAmount,
                from: raw.escrowActorId,
                to: raw.clientId,
              },
            ],
            cause: "eval-contract.declined",
            actors: [raw.clientId, raw.contractorId],
            ts: Date.now(),
          });
        }

        const updated: EvalContract = { ...raw, state: "Declined" };
        yield* persistEff(updated);
        return updated;
      });
    },

    submitContract({ contractId, callerId, submission }) {
      return Effect.gen(function* () {
        const raw = yield* loadEff(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        const contract = yield* expiryEff(raw);

        if (contract.state === "Expired") {
          return yield* Effect.fail(
            new EvalContractDeadlineExpired({ contractId, deadline: contract.deadline }),
          );
        }

        if (contract.state !== "Accepted") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Accepted", actual: contract.state }),
          );
        }

        // Authorization: contractor, any frozen beneficiary, or evaluator (trusted exam scenario).
        // Evaluator submit is intentional: quizmaster collects answers and submits on behalf of the
        // contestant, maintaining the commit-reveal audit trail without requiring client-side tooling.
        const allowedCallers = contract.beneficiaries.length > 0
          ? [...contract.beneficiaries, contract.contractorId, contract.evaluatorId]
          : [contract.contractorId, contract.evaluatorId];
        if (!allowedCallers.includes(callerId)) {
          return yield* Effect.fail(
            new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the contractor or evaluator can submit" }),
          );
        }

        const updated: EvalContract = { ...contract, state: "Submitted", submission };
        yield* persistEff(updated);
        return updated;
      });
    },

    evaluateContract({ contractId, callerId, verdict }) {
      return Effect.gen(function* () {
        const raw = yield* loadEff(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        if (raw.state !== "Submitted") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Submitted", actual: raw.state }),
          );
        }

        if (callerId !== raw.evaluatorId) {
          return yield* Effect.fail(
            new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the evaluator can evaluate" }),
          );
        }

        if (callerId === raw.contractorId) {
          return yield* Effect.fail(
            new EvalContractInvalidEvaluator({ evaluatorId: callerId, reason: "Evaluator cannot be the contractor" }),
          );
        }

        if (raw.beneficiaries.includes(callerId)) {
          return yield* Effect.fail(
            new EvalContractInvalidEvaluator({ evaluatorId: callerId, reason: "Evaluator cannot be a beneficiary" }),
          );
        }

        const stake = raw.stakeAmount;
        const escrow = raw.escrowActorId;
        const resource = raw.stakeResource;
        const movements: Array<{ from: string; to: string; amount: number }> = [];

        // Deterministic settlement tx ID for idempotency
        const settleTxId = createHash("sha256")
          .update("settle:" + contractId)
          .digest("hex")
          .slice(0, 26)
          .toUpperCase();

        // Build a single transfers array for atomic settlement
        const transfers: Array<{ resource: string; qty: number; from: string; to: string }> = [];

        let contractorPayment: number;
        let clientRefund: number;

        if (raw.beneficiaries.length > 0) {
          const n = raw.beneficiaries.length;
          const perShare = Math.floor((stake * verdict) / n);
          const totalPaid = perShare * n;
          clientRefund = stake - totalPaid;
          contractorPayment = totalPaid;

          for (const beneficiary of raw.beneficiaries) {
            if (perShare > 0) {
              transfers.push({ resource, qty: perShare, from: escrow, to: beneficiary });
              movements.push({ from: escrow, to: beneficiary, amount: perShare });
            }
          }
        } else {
          contractorPayment = Math.floor(stake * verdict);
          clientRefund = stake - contractorPayment;

          if (contractorPayment > 0) {
            transfers.push({ resource, qty: contractorPayment, from: escrow, to: raw.contractorId });
            movements.push({ from: escrow, to: raw.contractorId, amount: contractorPayment });
          }
        }

        if (clientRefund > 0) {
          transfers.push({ resource, qty: clientRefund, from: escrow, to: raw.clientId });
          movements.push({ from: escrow, to: raw.clientId, amount: clientRefund });
        }

        // Single atomic commit with all transfers
        if (transfers.length > 0) {
          yield* ledger.commit({
            id: settleTxId,
            transfers,
            cause: "eval-contract.settle",
            actors: [raw.evaluatorId, raw.contractorId, raw.clientId],
            ts: Date.now(),
          });
        }

        const settled: EvalContract = { ...raw, state: "Settled", verdict };
        yield* persistEff(settled);

        return { ...settled, contractorPayment, clientRefund, movements };
      });
    },

    getContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = yield* loadEff(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        const contract = yield* expiryEff(raw);

        // Authorization: client and evaluator always authorized
        if (callerId === contract.clientId || callerId === contract.evaluatorId) {
          return contract;
        }
        // Ghost contractor authorized
        if (callerId === contract.contractorId) {
          return contract;
        }
        // Frozen beneficiary authorized (Accepted+)
        if (contract.beneficiaries.includes(callerId)) {
          return contract;
        }
        // For Open contracts, check live group membership
        if (contract.state === "Open") {
          const membersEither = yield* Effect.either(groups.getGroupMembers(contract.contractorId));
          if (membersEither._tag === "Right" && membersEither.right.includes(callerId)) {
            return contract;
          }
        }

        return yield* Effect.fail(
          new EvalContractNotAuthorized({ contractId, callerId, reason: "Not a party to this contract" }),
        );
      });
    },

    listContracts({ callerId, state }) {
      return Effect.gen(function* () {
        // Get caller's group memberships to include group contracts
        const membershipsEither = yield* Effect.either(groups.listMemberships(callerId));
        const callerGroupIds: string[] = membershipsEither._tag === "Right"
          ? membershipsEither.right.map((g) => g.groupId)
          : [];

        const contracts = yield* Effect.tryPromise({
          try: async () => {
            const session = driver.session();
            try {
              const result = await session.executeRead((tx) =>
                tx.run(
                  `MATCH (c:EvalContract)
                   WHERE c.clientId = $callerId
                      OR c.contractorId = $callerId
                      OR c.evaluatorId = $callerId
                      OR ANY(gid IN $callerGroupIds WHERE c.contractorId = gid)
                      OR ANY(b IN c.beneficiaries WHERE b = $callerId)
                   RETURN c.id AS id, c.clientId AS clientId, c.contractorId AS contractorId,
                          c.evaluatorId AS evaluatorId, c.request AS request,
                          c.submission AS submission, c.stakeResource AS stakeResource,
                          c.stakeAmount AS stakeAmount, c.deadline AS deadline,
                          c.state AS state, c.verdict AS verdict, c.beneficiaries AS beneficiaries,
                          c.openedAt AS openedAt, c.escrowActorId AS escrowActorId,
                          c.artifactRef AS artifactRef, c.disclosureRef AS disclosureRef`,
                  { callerId, callerGroupIds },
                ),
              );
              return result.records.map(rowToContract);
            } finally {
              await session.close();
            }
          },
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });

        const result: EvalContract[] = [];
        for (const raw of contracts) {
          const contract = yield* expiryEff(raw);
          if (state !== undefined && contract.state !== state) continue;
          result.push(contract);
        }
        return result;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const makeEvalContractServiceLiveLayer = (
  driver: Driver,
): Layer.Layer<EvalContractService, never, Neo4jGraphService | LedgerService | GroupService> =>
  Layer.effect(
    EvalContractService,
    Effect.gen(function* () {
      const ledger = yield* LedgerService;
      const groups = yield* GroupService;
      return makeEvalContractServiceLive(driver, ledger, groups);
    }),
  );
