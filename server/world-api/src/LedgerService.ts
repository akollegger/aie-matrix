import { Context, Effect } from "effect";
import type {
  ActionCost,
  ActorId,
  BagResult,
  CostQuote,
  ResourceType,
  Transaction,
} from "@aie-matrix/shared-types";
import type {
  LedgerChainTamperedError,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
  LedgerMonotonicTradeRejected,
  LedgerPersistenceError,
  LedgerUnknownActor,
  LedgerUnknownResource,
} from "./ledger-errors.js";

export interface LedgerServiceOps {
  /**
   * Initialise the ledger for a session: register ResourceType declarations,
   * replay the persisted chain to rebuild the bag cache, and append the genesis
   * seed transaction if the chain is empty.
   * Must be called once after the session is established.
   */
  init(seed: ResourceType[]): Effect.Effect<void, LedgerPersistenceError>;

  /** Return the current bag holdings for an actor. O(1) — memory cache. */
  bag(actorId: ActorId): Effect.Effect<BagResult, LedgerUnknownActor>;

  /**
   * Validate proposed costs against the actor's current bag.
   * Returns a CostQuote on success. Does NOT commit anything.
   */
  quote(
    actorId: ActorId,
    costs: ActionCost[]
  ): Effect.Effect<CostQuote, LedgerInsufficientFunds | LedgerUnknownResource>;

  /**
   * Append a transaction to the ledger. Validates conservation, floor
   * constraints, duplicate ULID, unknown resources. Updates in-memory bag cache
   * and persists atomically. Rolls back cache on persistence failure.
   */
  commit(
    tx: Omit<Transaction, "prevHash" | "hash">
  ): Effect.Effect<
    Transaction,
    | LedgerInsufficientFunds
    | LedgerDuplicateTransaction
    | LedgerUnknownResource
    | LedgerMonotonicTradeRejected
    | LedgerPersistenceError
  >;

  /**
   * Re-walk the hash chain from genesis and verify every entry.
   * Returns the number of entries verified, or the first tamper violation.
   */
  verify(): Effect.Effect<{ entries: number }, LedgerChainTamperedError>;

  /** Return all resource types registered for this session. */
  resourceTypes(): Effect.Effect<ResourceType[]>;
}

export class LedgerService extends Context.Tag("world-api/LedgerService")<
  LedgerService,
  LedgerServiceOps
>() {}
