import { Context, Effect } from "effect";
import type {
  ActionCost,
  ActorId,
  BagResult,
  CostQuote,
  Transaction,
} from "@aie-matrix/shared-types";
import type {
  LedgerChainTamperedError,
  LedgerConservationViolation,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
  LedgerPersistenceError,
  LedgerUnknownActor,
  LedgerUnknownResource,
} from "./ledger-errors.js";

/**
 * Seed entry for ledger initialisation.
 * Derived at session start by summing ParsedItemPlacement.qty per (itemRef, h3Index).
 * `h3Index` present → actor "world@{h3Index}"; absent → actor "world" (spawn-grant pool).
 */
export interface ItemSeed {
  itemRef: string;
  qty: number;
  h3Index?: string;
}

export interface LedgerServiceOps {
  /**
   * Initialise the ledger for a session: replay the persisted chain to rebuild
   * the bag cache, and append the genesis seed transaction if the chain is empty.
   * Seeds are derived from map item placements (not ResourceType declarations).
   * Must be called once after the session is established.
   */
  init(seed: ItemSeed[]): Effect.Effect<void, LedgerPersistenceError>;

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
   * constraints, and duplicate ULID. Updates in-memory bag cache
   * and persists atomically. Rolls back cache on persistence failure.
   */
  commit(
    tx: Omit<Transaction, "prevHash" | "hash">
  ): Effect.Effect<
    Transaction,
    | LedgerInsufficientFunds
    | LedgerConservationViolation
    | LedgerDuplicateTransaction
    | LedgerUnknownResource
    | LedgerPersistenceError
  >;

  /**
   * Re-walk the hash chain from genesis and verify every entry.
   * Returns the number of entries verified, or the first tamper violation.
   */
  verify(): Effect.Effect<{ entries: number }, LedgerChainTamperedError>;
}

export class LedgerService extends Context.Tag("world-api/LedgerService")<
  LedgerService,
  LedgerServiceOps
>() {}
