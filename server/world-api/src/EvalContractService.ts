import { Context, Effect } from "effect";
import type { EvalContract, EvalContractId, EvalContractState } from "@aie-matrix/shared-types";
import type {
  EvalContractDeadlineExpired,
  EvalContractInvalidEvaluator,
  EvalContractNotAuthorized,
  EvalContractNotFound,
  EvalContractPersistenceError,
  EvalContractWrongState,
} from "./eval-contract-errors.js";
import type {
  LedgerConservationViolation,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
  LedgerPersistenceError,
  LedgerUnknownResource,
} from "./ledger-errors.js";
import type { GroupNotFound } from "./group-errors.js";

export type LedgerCommitError =
  | LedgerInsufficientFunds
  | LedgerConservationViolation
  | LedgerDuplicateTransaction
  | LedgerUnknownResource
  | LedgerPersistenceError;

export interface EvalContractServiceOps {
  /**
   * Open a new eval contract. The caller becomes the client;
   * the staked amount is immediately debited from the caller's resource bag.
   */
  openContract(params: {
    clientId: string;
    contractorId: string;
    evaluatorId: string;
    request: string;
    stakeResource: string;
    stakeAmount: number;
    deadline: number;
    artifactRef?: string;
    disclosureRef?: string;
  }): Effect.Effect<
    EvalContract,
    EvalContractInvalidEvaluator | EvalContractPersistenceError | LedgerCommitError
  >;

  /**
   * Contractor accepts an open contract.
   * For group contractors, the member list is frozen as beneficiaries.
   */
  acceptContract(params: {
    contractId: EvalContractId;
    callerId: string;
  }): Effect.Effect<
    EvalContract,
    EvalContractNotFound | EvalContractWrongState | EvalContractNotAuthorized | EvalContractPersistenceError | GroupNotFound
  >;

  /**
   * Contractor declines an open contract.
   * The client's stake is returned from escrow.
   */
  declineContract(params: {
    contractId: EvalContractId;
    callerId: string;
  }): Effect.Effect<
    EvalContract,
    EvalContractNotFound | EvalContractWrongState | EvalContractNotAuthorized | EvalContractPersistenceError | LedgerCommitError
  >;

  /**
   * Contractor submits a response. Immutable once recorded.
   * If the deadline has passed, the contract transitions to Expired and the stake is returned.
   */
  submitContract(params: {
    contractId: EvalContractId;
    callerId: string;
    submission: string;
  }): Effect.Effect<
    EvalContract,
    EvalContractNotFound | EvalContractWrongState | EvalContractNotAuthorized | EvalContractDeadlineExpired | EvalContractPersistenceError | LedgerCommitError
  >;

  /**
   * Evaluator issues a verdict v ∈ [0,1].
   * Settlement executes atomically immediately after.
   */
  evaluateContract(params: {
    contractId: EvalContractId;
    callerId: string;
    verdict: number;
  }): Effect.Effect<
    EvalContract & { contractorPayment: number; clientRefund: number; movements: Array<{ from: string; to: string; amount: number }> },
    EvalContractNotFound | EvalContractWrongState | EvalContractNotAuthorized | EvalContractInvalidEvaluator | EvalContractPersistenceError | LedgerCommitError
  >;

  /**
   * Read the current state of a contract.
   * Caller must be the named client, contractor, or evaluator.
   */
  getContract(params: {
    contractId: EvalContractId;
    callerId: string;
  }): Effect.Effect<
    EvalContract,
    EvalContractNotFound | EvalContractNotAuthorized | EvalContractPersistenceError | LedgerCommitError
  >;

  /**
   * List contracts visible to the caller.
   * Optionally filter by state.
   */
  listContracts(params: {
    callerId: string;
    state?: EvalContractState;
  }): Effect.Effect<EvalContract[], EvalContractPersistenceError | LedgerCommitError>;
}

export class EvalContractService extends Context.Tag("world-api/EvalContractService")<
  EvalContractService,
  EvalContractServiceOps
>() {}
