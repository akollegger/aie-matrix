import { Effect, Layer } from "effect";
import type { EvalContract } from "@aie-matrix/shared-types";
import type { Driver } from "neo4j-driver";
import { EvalContractPersistenceError } from "./eval-contract-errors.js";
import { EvalContractService, type EvalContractServiceOps } from "./EvalContractService.js";
import { LedgerService } from "./LedgerService.js";
import { GroupService } from "./GroupService.js";
import { Neo4jGraphService } from "./Neo4jGraphService.js";
import { makeEvalContractServiceInMemory } from "./EvalContractServiceInMemory.js";

// ---------------------------------------------------------------------------
// Live Neo4j-backed implementation
// ---------------------------------------------------------------------------
// Phase 7 note: This implementation currently delegates to the in-memory
// service for business logic while persisting to Neo4j for durability.
// Full Cypher-native persistence is tracked in T028 (Polish phase).
// ---------------------------------------------------------------------------

function makeEvalContractServiceLive(
  driver: Driver,
  ledger: LedgerService["Type"],
  groups: GroupService["Type"],
): EvalContractServiceOps {
  // Delegate business logic to the in-memory implementation
  const inMemory = makeEvalContractServiceInMemory(ledger, groups);

  async function persistContract(contract: EvalContract): Promise<void> {
    const session = driver.session();
    try {
      await session.executeWrite((tx) =>
        tx.run(
          `MERGE (c:EvalContract {id: $id})
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
               c.escrowActorId = $escrowActorId`,
          {
            id: contract.id,
            clientId: contract.clientId,
            contractorId: contract.contractorId,
            evaluatorId: contract.evaluatorId,
            request: contract.request,
            submission: contract.submission ?? null,
            stakeResource: contract.stakeResource,
            stakeAmount: contract.stakeAmount,
            deadline: contract.deadline,
            state: contract.state,
            verdict: contract.verdict ?? null,
            beneficiaries: contract.beneficiaries,
            openedAt: contract.openedAt,
            escrowActorId: contract.escrowActorId,
          },
        ),
      );
    } finally {
      await session.close();
    }
  }

  return {
    openContract(params) {
      return Effect.gen(function* () {
        const contract = yield* inMemory.openContract(params);
        yield* Effect.tryPromise({
          try: () => persistContract(contract),
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });
        return contract;
      });
    },

    acceptContract(params) {
      return Effect.gen(function* () {
        const contract = yield* inMemory.acceptContract(params);
        yield* Effect.tryPromise({
          try: () => persistContract(contract),
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });
        return contract;
      });
    },

    declineContract(params) {
      return Effect.gen(function* () {
        const contract = yield* inMemory.declineContract(params);
        yield* Effect.tryPromise({
          try: () => persistContract(contract),
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });
        return contract;
      });
    },

    submitContract(params) {
      return Effect.gen(function* () {
        const contract = yield* inMemory.submitContract(params);
        yield* Effect.tryPromise({
          try: () => persistContract(contract),
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });
        return contract;
      });
    },

    evaluateContract(params) {
      return Effect.gen(function* () {
        const result = yield* inMemory.evaluateContract(params);
        yield* Effect.tryPromise({
          try: () => persistContract(result),
          catch: (e) => new EvalContractPersistenceError({ cause: String(e) }),
        });
        return result;
      });
    },

    getContract(params) {
      return inMemory.getContract(params);
    },

    listContracts(params) {
      return inMemory.listContracts(params);
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
