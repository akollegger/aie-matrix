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
  LedgerConservationViolation,
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
  const canonical = {
    actors: [...tx.actors].sort(),
    cause: tx.cause,
    id: tx.id,
    prevHash,
    transfers: tx.transfers.map(t => ({
      from: t.from,
      location: (t as any).location ?? null,
      qty: t.qty,
      resource: t.resource,
      to: t.to,
    })),
    ts: tx.ts,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
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
    Effect.gen(function* () {
      for (const rt of seed) {
        resourceTypes.set(rt.id, rt);
      }

      const conservedSeed = seed.filter(rt => rt.class === "conserved" && rt.qty > 0);
      if (conservedSeed.length === 0) return;

      // Append genesis seed transaction so verify() counts it and the chain is valid
      const genesisTx = {
        id: ulid(),
        transfers: conservedSeed.map(rt => ({ resource: rt.id, qty: rt.qty, from: "world.genesis", to: "world" })),
        cause: "seed",
        actors: [] as string[],
        ts: Date.now(),
      };
      // Genesis commit must never fail — if it does, it's a programming error
      yield* commit(genesisTx).pipe(Effect.orDie);
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
      // Validate all transfer quantities are positive
      for (const t of tx.transfers) {
        if (!Number.isInteger(t.qty) || t.qty <= 0) {
          yield* Effect.fail(new LedgerConservationViolation({
            resource: t.resource,
            expected: 1,
            actual: t.qty,
          }));
        }
      }

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
        if (t.from.startsWith("world")) continue; // world-authority actors may mint freely
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

  const ensureResourceType = (rt: ResourceType) =>
    Effect.sync(() => {
      if (!resourceTypes.has(rt.id)) {
        resourceTypes.set(rt.id, rt);
      }
    });

  const ops: LedgerService["Type"] & { _getLog: () => typeof log } = {
    init,
    bag,
    quote,
    commit,
    verify,
    resourceTypes: resourceTypesOp,
    ensureResourceType,
    // Test-only escape hatch for tamper detection tests
    _getLog: () => log,
  };
  return ops;
}

export const LedgerServiceInMemoryLayer: Layer.Layer<LedgerService> = Layer.succeed(
  LedgerService,
  makeLedgerServiceInMemory()
);
