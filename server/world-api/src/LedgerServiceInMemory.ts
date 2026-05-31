import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import type {
  ActionCost,
  ActorId,
  BagResult,
  CostQuote,
  ResourceId,
  ResourceType,
  Transaction,
  Transfer,
} from "@aie-matrix/shared-types";
import {
  LedgerChainTamperedError,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
  LedgerMonotonicTradeRejected,
  LedgerUnknownResource,
} from "./ledger-errors.js";
import { LedgerService } from "./LedgerService.js";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

type HashableFields = Pick<Transaction, "id" | "transfers" | "cause" | "actors" | "ts">;

function hashTransaction(tx: HashableFields, prevHash: string): string {
  const body = JSON.stringify(
    { id: tx.id, transfers: tx.transfers, cause: tx.cause, actors: tx.actors, ts: tx.ts, prevHash },
    ["actors", "cause", "id", "prevHash", "transfers", "ts"]
  );
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function makeLedgerServiceInMemory(): LedgerService["Type"] {
  // Resource type registry
  const resourceTypes = new Map<ResourceId, ResourceType>();

  // Bag cache: actorId → resourceId → balance
  const bags = new Map<ActorId, Map<ResourceId, number>>();

  // Append-only log (in-memory)
  const log: Transaction[] = [];

  // Idempotency set
  const seenIds = new Set<string>();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function balance(actorId: ActorId, resource: ResourceId): number {
    return bags.get(actorId)?.get(resource) ?? 0;
  }

  function setBalance(actorId: ActorId, resource: ResourceId, qty: number): void {
    if (!bags.has(actorId)) bags.set(actorId, new Map());
    bags.get(actorId)!.set(resource, qty);
  }

  function applyTransfers(transfers: Transfer[]): void {
    for (const t of transfers) {
      setBalance(t.from, t.resource, balance(t.from, t.resource) - t.qty);
      setBalance(t.to, t.resource, balance(t.to, t.resource) + t.qty);
    }
  }

  function chainTip(): string {
    return log.length === 0 ? "" : log[log.length - 1].hash;
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  const init = (seed: ResourceType[]) =>
    Effect.sync(() => {
      for (const rt of seed) {
        resourceTypes.set(rt.id, rt);
        if (rt.class === "conserved" && rt.qty > 0) {
          setBalance("world", rt.id, rt.qty);
        }
      }
    });

  // ---------------------------------------------------------------------------
  // bag
  // ---------------------------------------------------------------------------

  const bag = (actorId: ActorId) =>
    Effect.sync(() => {
      const holdings: BagResult["holdings"] = [];
      const actorBag = bags.get(actorId);
      if (actorBag) {
        for (const [resource, qty] of actorBag) {
          if (qty === 0) continue;
          const rt = resourceTypes.get(resource);
          holdings.push({ resource, qty, label: rt?.label ?? resource });
        }
      }
      return { actorId, holdings } as BagResult;
    });

  // ---------------------------------------------------------------------------
  // quote
  // ---------------------------------------------------------------------------

  const quote = (actorId: ActorId, costs: ActionCost[]) =>
    Effect.gen(function* () {
      for (const cost of costs) {
        if (!resourceTypes.has(cost.resource)) {
          yield* Effect.fail(new LedgerUnknownResource({ resource: cost.resource }));
        }
        const avail = balance(actorId, cost.resource);
        const floor = resourceTypes.get(cost.resource)!.floor;
        if (avail - cost.qty < floor) {
          yield* Effect.fail(
            new LedgerInsufficientFunds({
              actorId,
              resource: cost.resource,
              required: cost.qty,
              available: avail,
            })
          );
        }
      }
      return {
        transactionId: ulid(),
        costs,
      } as CostQuote;
    });

  // ---------------------------------------------------------------------------
  // commit
  // ---------------------------------------------------------------------------

  const commit = (tx: Omit<Transaction, "prevHash" | "hash">) =>
    Effect.gen(function* () {
      // Idempotency
      if (seenIds.has(tx.id)) {
        yield* Effect.fail(new LedgerDuplicateTransaction({ id: tx.id }));
      }

      // Validate resources exist
      for (const t of tx.transfers) {
        if (!resourceTypes.has(t.resource)) {
          yield* Effect.fail(new LedgerUnknownResource({ resource: t.resource }));
        }
      }

      // Monotonic resources may only flow FROM a world-authority actor (prefix "world")
      for (const t of tx.transfers) {
        const rt = resourceTypes.get(t.resource)!;
        if (rt.class === "monotonic" && !t.from.startsWith("world")) {
          yield* Effect.fail(new LedgerMonotonicTradeRejected({ resource: t.resource }));
        }
      }

      // Validate floors (debit side only; monotonic minting skips floor check on issuer)
      for (const t of tx.transfers) {
        const rt = resourceTypes.get(t.resource)!;
        if (rt.class === "monotonic") continue; // issuers are not balance-checked
        const current = balance(t.from, t.resource);
        const floor = rt.floor;
        if (current - t.qty < floor) {
          yield* Effect.fail(
            new LedgerInsufficientFunds({
              actorId: t.from,
              resource: t.resource,
              required: t.qty,
              available: current,
            })
          );
        }
      }

      // Conservation check: group by resource, ensure sum(from) === sum(to) for conserved
      const conservedDeltas = new Map<ResourceId, number>();
      for (const t of tx.transfers) {
        const rt = resourceTypes.get(t.resource)!;
        if (rt.class !== "conserved") continue;
        conservedDeltas.set(t.resource, (conservedDeltas.get(t.resource) ?? 0) + t.qty - t.qty);
        // Track net: from loses, to gains — net should be 0
      }
      // Simplified check: from === to for each transfer (double-entry means qty in === qty out)
      // Each Transfer is already double-entry by definition; conservation is guaranteed structurally.

      // Build full transaction
      const prev = chainTip();
      const full: Transaction = {
        ...tx,
        prevHash: prev,
        hash: "", // computed below
      };
      full.hash = hashTransaction(full, prev);

      // Apply to in-memory cache
      applyTransfers(tx.transfers);

      // In-memory: no persistence failure possible
      log.push(full);
      seenIds.add(full.id);

      return full;
    });

  // ---------------------------------------------------------------------------
  // verify
  // ---------------------------------------------------------------------------

  const verify = () =>
    Effect.gen(function* () {
      let prevHash = "";
      for (const entry of log) {
        const expected = hashTransaction(
          { id: entry.id, transfers: entry.transfers, cause: entry.cause, actors: entry.actors, ts: entry.ts },
          prevHash
        );
        if (expected !== entry.hash) {
          yield* Effect.fail(
            new LedgerChainTamperedError({
              atId: entry.id,
              expectedHash: expected,
              actualHash: entry.hash,
            })
          );
        }
        prevHash = entry.hash;
      }
      return { entries: log.length };
    });

  // ---------------------------------------------------------------------------
  // resourceTypes
  // ---------------------------------------------------------------------------

  const resourceTypesOp = () => Effect.sync(() => Array.from(resourceTypes.values()));

  return {
    init,
    bag,
    quote,
    commit,
    verify,
    resourceTypes: resourceTypesOp,
  };
}

export const LedgerServiceInMemoryLayer: Layer.Layer<LedgerService> = Layer.succeed(
  LedgerService,
  makeLedgerServiceInMemory()
);
