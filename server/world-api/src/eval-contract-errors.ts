import { Data } from "effect";
import type { EvalContractId, EvalContractState } from "@aie-matrix/shared-types";

export class EvalContractNotFound extends Data.TaggedError("EvalContractError.NotFound")<{
  readonly contractId: EvalContractId;
}> {}

export class EvalContractWrongState extends Data.TaggedError("EvalContractError.WrongState")<{
  readonly contractId: EvalContractId;
  readonly expected: EvalContractState | EvalContractState[];
  readonly actual: EvalContractState;
}> {}

export class EvalContractNotAuthorized extends Data.TaggedError("EvalContractError.NotAuthorized")<{
  readonly contractId: EvalContractId;
  readonly callerId: string;
  readonly reason: string;
}> {}

export class EvalContractInvalidEvaluator extends Data.TaggedError("EvalContractError.InvalidEvaluator")<{
  readonly evaluatorId: string;
  readonly reason: string;
}> {}

export class EvalContractDeadlineExpired extends Data.TaggedError("EvalContractError.DeadlineExpired")<{
  readonly contractId: EvalContractId;
  readonly deadline: number;
}> {}

export class EvalContractPersistenceError extends Data.TaggedError("EvalContractError.PersistenceError")<{
  readonly cause: string;
}> {}

export type EvalContractError =
  | EvalContractNotFound
  | EvalContractWrongState
  | EvalContractNotAuthorized
  | EvalContractInvalidEvaluator
  | EvalContractDeadlineExpired
  | EvalContractPersistenceError;
