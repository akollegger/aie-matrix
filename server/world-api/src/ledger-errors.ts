import { Data } from "effect";
import type { ActorId, ResourceId, TransactionId } from "@aie-matrix/shared-types";

export class LedgerInsufficientFunds extends Data.TaggedError("LedgerError.InsufficientFunds")<{
  readonly actorId: ActorId;
  readonly resource: ResourceId;
  readonly required: number;
  readonly available: number;
}> {}

export class LedgerConservationViolation extends Data.TaggedError("LedgerError.ConservationViolation")<{
  readonly resource: ResourceId;
  readonly expected: number;
  readonly actual: number;
}> {}

export class LedgerDuplicateTransaction extends Data.TaggedError("LedgerError.DuplicateTransaction")<{
  readonly id: TransactionId;
}> {}

export class LedgerUnknownResource extends Data.TaggedError("LedgerError.UnknownResource")<{
  readonly resource: ResourceId;
}> {}

export class LedgerUnknownActor extends Data.TaggedError("LedgerError.UnknownActor")<{
  readonly actorId: ActorId;
}> {}

export class LedgerChainTamperedError extends Data.TaggedError("LedgerError.ChainTampered")<{
  readonly atId: TransactionId;
  readonly expectedHash: string;
  readonly actualHash: string;
}> {}

export class LedgerPersistenceError extends Data.TaggedError("LedgerError.PersistenceError")<{
  readonly cause: string;
}> {}

export class LedgerConsentRequired extends Data.TaggedError("LedgerError.ConsentRequired")<{
  readonly transactionId: TransactionId;
  readonly costs: Array<{ resource: ResourceId; qty: number; payee: ActorId }>;
}> {}

export class LedgerProposalNotFound extends Data.TaggedError("LedgerError.ProposalNotFound")<{
  readonly proposalId: string;
}> {}

export class LedgerSelfAgreeDenied extends Data.TaggedError("LedgerError.SelfAgreeDenied")<{
  readonly proposalId: string;
  readonly actorId: ActorId;
}> {}

export class LedgerProposalExpired extends Data.TaggedError("LedgerError.ProposalExpired")<{
  readonly proposalId: string;
}> {}

export class LedgerCounterpartyNotNearby extends Data.TaggedError("LedgerError.CounterpartyNotNearby")<{
  readonly initiatorId: ActorId;
  readonly counterpartyId: ActorId;
}> {}

export type LedgerError =
  | LedgerInsufficientFunds
  | LedgerConservationViolation
  | LedgerDuplicateTransaction
  | LedgerUnknownResource
  | LedgerUnknownActor
  | LedgerChainTamperedError
  | LedgerPersistenceError
  | LedgerConsentRequired
  | LedgerProposalNotFound
  | LedgerSelfAgreeDenied
  | LedgerProposalExpired
  | LedgerCounterpartyNotNearby;
