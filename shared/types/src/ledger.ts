/** Actor identifier — ghost id, "world", "world@{h3Index}", NPC id, etc. */
export type ActorId = string;

/**
 * Resource / item identifier.
 * For items this is the Pascal-case `ItemTypeDef.typeName` (e.g. "BrassKey", "GoldCoin").
 * For abstract resources it is a plain string (e.g. "eval-token").
 */
export type ResourceId = string;

/**
 * Transaction ID; also the idempotency key.
 * Normal transactions use ULID. Idempotent spawn-grant transactions use a
 * truncated SHA-256 hex string derived from `ghostId:role:itemRef` to ensure
 * stable deduplication across reconnects. Callers MUST NOT assume ULID ordering.
 */
export type TransactionId = string;

/** A single double-entry resource transfer between two actor bags. */
export interface Transfer {
  resource: ResourceId;
  /** Positive integer. Direction expressed by from/to, never by sign. */
  qty: number;
  /** Bag that loses qty. */
  from: ActorId;
  /** Bag that gains qty. */
  to: ActorId;
  /** Set when a world-owned item moves to/from a map tile (take/drop). */
  location?: { h3Index: string };
}

export interface Transaction {
  /** ULID; idempotency key. */
  id: TransactionId;
  transfers: Transfer[];
  /**
   * What authored this transaction.
   * Valid values: "take" | "drop" | "spawn-grant" | "eval-payout" | "trade" |
   *   "group-formation" | "group-leave" | "seed"
   * Note: "agent.resource-grant" was removed in 027-resource-lifecycle; use "spawn-grant".
   */
  cause: string;
  /** Actors whose consent this transaction carries. */
  actors: ActorId[];
  /** Server timestamp (ms since epoch). */
  ts: number;
  /** SHA-256 of predecessor; "" for genesis. */
  prevHash: string;
  /** SHA-256(canonical body + prevHash). */
  hash: string;
}

/** Per-actor materialized holdings cache entry. */
export interface BagEntry {
  actorId: ActorId;
  resource: ResourceId;
  qty: number;
}

/** Result of an inventory lookup. */
export interface BagResult {
  actorId: ActorId;
  holdings: Array<{ resource: ResourceId; qty: number; label: string }>;
}

/** Cost declared on a :GO rule edge. */
export interface ActionCost {
  resource: ResourceId;
  qty: number;
  /** Defaults to "world". */
  payee: ActorId;
}

/** Quote returned before a costed action commits. */
export interface CostQuote {
  /** Pre-generated ULID for the pending transaction. */
  transactionId: TransactionId;
  costs: ActionCost[];
}

/** A pending ghost-to-ghost trade proposal. */
export interface Proposal {
  proposalId: string;
  initiatorId: ActorId;
  counterpartyId: ActorId;
  /** What the initiator gives. */
  give: { resource: ResourceId; qty: number };
  /** What the initiator wants in return. */
  want: { resource: ResourceId; qty: number };
  /** Unix ms expiry timestamp. */
  expiresAt: number;
  status: "pending" | "agreed" | "declined" | "expired";
  /** When true, both contributions go to a newly created group bag (group formation). */
  shared?: boolean;
}

/** Per-actor balance change emitted in ledger:transaction:committed event. */
export interface LedgerBalanceChange {
  actorId: ActorId;
  resource: ResourceId;
  newBalance: number;
  delta: number;
}
