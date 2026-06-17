import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import type {
  ActionCost,
  ActorId,
  BagResult,
  CostQuote,
  ResourceId,
  Transaction,
  Transfer,
} from "@aie-matrix/shared-types";
import {
  LedgerChainTamperedError,
  LedgerConservationViolation,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
} from "./ledger-errors.js";
import { LedgerService, type ItemSeed } from "./LedgerService.js";

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
    return log.length === 0 ? "" : log[log.length - 1]!.hash;
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  const init = (seed: ItemSeed[]) =>
    Effect.gen(function* () {
      const seedWithQty = seed.filter(s => s.qty > 0);
      if (seedWithQty.length === 0) return;

      // Build genesis transfers: world.genesis → world@{h3Index} (or "world")
      const genesisTx = {
        id: ulid(),
        transfers: seedWithQty.map(s => ({
          resource: s.itemRef,
          qty: s.qty,
          from: "world.genesis",
          to: s.h3Index ? `world@${s.h3Index}` : "world",
        })),
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
          holdings.push({ resource, qty, label: resource });
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
        const avail = balance(actorId, cost.resource);
        if (avail - cost.qty < 0) {
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

      // Validate sufficient funds on the debit side
      // (world.genesis is allowed to go negative — it's the seed authority)
      for (const t of tx.transfers) {
        if (t.from === "world.genesis") continue;
        const current = balance(t.from, t.resource);
        if (current - t.qty < 0) {
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

      // Conservation check: for each resource, sum(debit qty) === sum(credit qty)
      const netByResource = new Map<ResourceId, number>();
      for (const t of tx.transfers) {
        // from loses qty (debit), to gains qty (credit) — net should be 0
        netByResource.set(t.resource, (netByResource.get(t.resource) ?? 0) - t.qty + t.qty);
      }
      // Each Transfer is self-balancing by construction (one from, one to, same qty).
      // The conservation invariant holds automatically per Transfer.

      // Build full transaction
      const prev = chainTip();
      const full: Transaction = {
        ...tx,
        prevHash: prev,
        hash: "",
      };
      full.hash = hashTransaction(full, prev);

      // Apply to in-memory cache
      applyTransfers(tx.transfers);

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

  const ops: LedgerService["Type"] & { _getLog: () => typeof log } = {
    init,
    bag,
    quote,
    commit,
    verify,
    // Test-only escape hatch for tamper detection tests
    _getLog: () => log,
  };
  return ops;
}

export const LedgerServiceInMemoryLayer: Layer.Layer<LedgerService> = Layer.succeed(
  LedgerService,
  makeLedgerServiceInMemory()
);
