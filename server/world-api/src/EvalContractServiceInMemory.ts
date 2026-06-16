import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import type { EvalContract, EvalContractId } from "@aie-matrix/shared-types";
import {
  EvalContractDeadlineExpired,
  EvalContractInvalidEvaluator,
  EvalContractNotAuthorized,
  EvalContractNotFound,
  EvalContractWrongState,
} from "./eval-contract-errors.js";
import { EvalContractService, type EvalContractServiceOps } from "./EvalContractService.js";
import { LedgerService } from "./LedgerService.js";
import { GroupService } from "./GroupService.js";

// ---------------------------------------------------------------------------
// Settlement result shape (extends EvalContract)
// ---------------------------------------------------------------------------

type SettlementResult = EvalContract & {
  contractorPayment: number;
  clientRefund: number;
  movements: Array<{ from: string; to: string; amount: number }>;
};

// ---------------------------------------------------------------------------
// Lazy expiry helper
// ---------------------------------------------------------------------------

/**
 * Check if an Accepted contract has passed its deadline.
 * If so, return escrow to client, transition to Expired, and update the record in-place.
 * Returns the (possibly updated) contract.
 */
async function checkAndApplyExpiry(
  contract: EvalContract,
  contracts: Map<EvalContractId, EvalContract>,
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
  contracts.set(contract.id, expired);
  return expired;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeEvalContractServiceInMemory(
  ledger: LedgerService["Type"],
  groups: GroupService["Type"],
): EvalContractServiceOps {
  const contracts = new Map<EvalContractId, EvalContract>();

  return {
    openContract({ clientId, contractorId, evaluatorId, request, stakeResource, stakeAmount, deadline, artifactRef, disclosureRef }) {
      return Effect.gen(function* () {
        // Validate: evaluator must not be the contractor
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
        contracts.set(id, contract);
        return contract;
      });
    },

    acceptContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = contracts.get(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        // Lazy expiry check (only applies to Accepted state, not Open, so this is a no-op here)
        const contract = raw;

        if (contract.state !== "Open") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Open", actual: contract.state }),
          );
        }

        // Authorization: caller must be the contractorId (ghost) or a current member of the group
        if (callerId !== contract.contractorId) {
          const membersEither = yield* Effect.either(groups.getGroupMembers(contract.contractorId));
          if (membersEither._tag !== "Right" || !membersEither.right.includes(callerId)) {
            return yield* Effect.fail(
              new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the contractor can accept" }),
            );
          }
        }

        // Freeze beneficiaries if contractor is a group
        let beneficiaries: string[] = [];
        const groupMembers = yield* Effect.either(groups.getGroupMembers(contract.contractorId));
        if (groupMembers._tag === "Right") {
          beneficiaries = groupMembers.right;
        }
        // If GroupNotFound, contractorId is a ghost (not a group) — leave beneficiaries empty

        const updated: EvalContract = { ...contract, state: "Accepted", beneficiaries };
        contracts.set(contractId, updated);
        return updated;
      });
    },

    declineContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = contracts.get(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        const contract = raw;
        if (contract.state !== "Open") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Open", actual: contract.state }),
          );
        }

        // Authorization: caller must be the contractorId (ghost) or a current member of the group
        if (callerId !== contract.contractorId) {
          const membersEither = yield* Effect.either(groups.getGroupMembers(contract.contractorId));
          if (membersEither._tag !== "Right" || !membersEither.right.includes(callerId)) {
            return yield* Effect.fail(
              new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the contractor can decline" }),
            );
          }
        }

        // Return escrow to client (skip if zero-stake)
        if (contract.stakeAmount > 0) {
          yield* ledger.commit({
            id: ulid(),
            transfers: [
              {
                resource: contract.stakeResource,
                qty: contract.stakeAmount,
                from: contract.escrowActorId,
                to: contract.clientId,
              },
            ],
            cause: "eval-contract.declined",
            actors: [contract.clientId, contract.contractorId],
            ts: Date.now(),
          });
        }

        const updated: EvalContract = { ...contract, state: "Declined" };
        contracts.set(contractId, updated);
        return updated;
      });
    },

    submitContract({ contractId, callerId, submission }) {
      return Effect.gen(function* () {
        const raw = contracts.get(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        // Lazy expiry check
        const contract = yield* Effect.promise(() =>
          checkAndApplyExpiry(raw, contracts, ledger),
        );

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
        contracts.set(contractId, updated);
        return updated;
      });
    },

    evaluateContract({ contractId, callerId, verdict }) {
      return Effect.gen(function* () {
        const raw = contracts.get(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        const contract = raw;

        if (contract.state !== "Submitted") {
          return yield* Effect.fail(
            new EvalContractWrongState({ contractId, expected: "Submitted", actual: contract.state }),
          );
        }

        if (callerId !== contract.evaluatorId) {
          return yield* Effect.fail(
            new EvalContractNotAuthorized({ contractId, callerId, reason: "Only the evaluator can evaluate" }),
          );
        }

        // Evaluator cannot be the contractor
        if (callerId === contract.contractorId) {
          return yield* Effect.fail(
            new EvalContractInvalidEvaluator({ evaluatorId: callerId, reason: "Evaluator cannot be the contractor" }),
          );
        }

        // Evaluator cannot be a beneficiary
        if (contract.beneficiaries.includes(callerId)) {
          return yield* Effect.fail(
            new EvalContractInvalidEvaluator({ evaluatorId: callerId, reason: "Evaluator cannot be a beneficiary" }),
          );
        }

        const stake = contract.stakeAmount;
        const escrow = contract.escrowActorId;
        const resource = contract.stakeResource;
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

        if (contract.beneficiaries.length > 0) {
          // Group contractor: split evenly among beneficiaries
          const n = contract.beneficiaries.length;
          const perShare = Math.floor((stake * verdict) / n);
          const totalPaid = perShare * n;
          clientRefund = stake - totalPaid;
          contractorPayment = totalPaid;

          for (const beneficiary of contract.beneficiaries) {
            if (perShare > 0) {
              transfers.push({ resource, qty: perShare, from: escrow, to: beneficiary });
              movements.push({ from: escrow, to: beneficiary, amount: perShare });
            }
          }
        } else {
          // Ghost contractor: single payment
          contractorPayment = Math.floor(stake * verdict);
          clientRefund = stake - contractorPayment;

          if (contractorPayment > 0) {
            transfers.push({ resource, qty: contractorPayment, from: escrow, to: contract.contractorId });
            movements.push({ from: escrow, to: contract.contractorId, amount: contractorPayment });
          }
        }

        if (clientRefund > 0) {
          transfers.push({ resource, qty: clientRefund, from: escrow, to: contract.clientId });
          movements.push({ from: escrow, to: contract.clientId, amount: clientRefund });
        }

        // Single atomic commit with all transfers
        if (transfers.length > 0) {
          yield* ledger.commit({
            id: settleTxId,
            transfers,
            cause: "eval-contract.settle",
            actors: [contract.evaluatorId, contract.contractorId, contract.clientId],
            ts: Date.now(),
          });
        }

        const settled: EvalContract = { ...contract, state: "Settled", verdict };
        contracts.set(contractId, settled);

        return { ...settled, contractorPayment, clientRefund, movements } as SettlementResult;
      });
    },

    getContract({ contractId, callerId }) {
      return Effect.gen(function* () {
        const raw = contracts.get(contractId);
        if (!raw) return yield* Effect.fail(new EvalContractNotFound({ contractId }));

        // Lazy expiry check
        const contract = yield* Effect.promise(() =>
          checkAndApplyExpiry(raw, contracts, ledger),
        );

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

        const result: EvalContract[] = [];
        for (const [, raw] of contracts) {
          // Check if caller is a party (direct or via group membership or beneficiary)
          const isDirectParty =
            callerId === raw.clientId ||
            callerId === raw.contractorId ||
            callerId === raw.evaluatorId;
          const isGroupParty = callerGroupIds.includes(raw.contractorId);
          const isBeneficiary = raw.beneficiaries.includes(callerId);

          if (!isDirectParty && !isGroupParty && !isBeneficiary) {
            continue;
          }

          // Lazy expiry check
          const contract = yield* Effect.promise(() =>
            checkAndApplyExpiry(raw, contracts, ledger),
          );

          // Optional state filter
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

export const EvalContractServiceInMemoryLayer: Layer.Layer<
  EvalContractService,
  never,
  LedgerService | GroupService
> = Layer.effect(
  EvalContractService,
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    const groups = yield* GroupService;
    return makeEvalContractServiceInMemory(ledger, groups);
  }),
);
