import { createHash } from "node:crypto";
import neo4j, { type Driver } from "neo4j-driver";
import { Effect, Layer } from "effect";
import { ulid } from "ulid";
import type {
  ActorId,
  ActionCost,
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
  LedgerPersistenceError,
} from "./ledger-errors.js";
import { LedgerService, type ItemSeed } from "./LedgerService.js";

// ---------------------------------------------------------------------------
// Hashing (shared with in-memory impl)
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
// Live (Neo4j-backed) implementation
// ---------------------------------------------------------------------------

export function makeLedgerServiceLive(
  driver: Driver,
  sessionId: string,
  publish?: (channel: string, event: unknown) => void,
): LedgerService["Type"] {
  const bags = new Map<ActorId, Map<ResourceId, number>>();
  const seenIds = new Set<string>();
  let tipHash = "";

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

  function revertTransfers(transfers: Transfer[]): void {
    for (const t of transfers) {
      setBalance(t.from, t.resource, balance(t.from, t.resource) + t.qty);
      setBalance(t.to, t.resource, balance(t.to, t.resource) - t.qty);
    }
  }

  // ---------------------------------------------------------------------------
  // init — replay chain from Neo4j or seed genesis
  // ---------------------------------------------------------------------------

  const init = (seed: ItemSeed[]) =>
    Effect.tryPromise({
      try: async () => {
        // Replay existing chain from LEDGER_HEAD
        const readSession = driver.session({ defaultAccessMode: neo4j.session.READ });
        let entries: Transaction[] = [];
        try {
          const result = await readSession.run(
            `MATCH (s:LiveSession { id: $sessionId })-[:LEDGER_HEAD]->(head:LedgerEntry)
             MATCH p = (head)-[:NEXT_ENTRY*0..]->(e:LedgerEntry)
             WITH e, length(p) AS depth
             RETURN e.id AS id, e.cause AS cause, e.actors AS actors,
                    e.ts AS ts, e.prevHash AS prevHash, e.hash AS hash,
                    e.transfers AS transfersJson
             ORDER BY depth ASC`,
            { sessionId }
          );
          entries = result.records.map((rec) => ({
            id: rec.get("id") as string,
            cause: rec.get("cause") as string,
            actors: rec.get("actors") as string[],
            ts: (rec.get("ts") as any).toNumber?.() ?? Number(rec.get("ts")),
            prevHash: rec.get("prevHash") as string,
            hash: rec.get("hash") as string,
            transfers: JSON.parse(rec.get("transfersJson") as string) as Transfer[],
          }));
        } finally {
          await readSession.close();
        }

        if (entries.length > 0) {
          // Replay
          for (const entry of entries) {
            applyTransfers(entry.transfers);
            seenIds.add(entry.id);
          }
          tipHash = entries[entries.length - 1]!.hash;
          return;
        }

        // No existing chain — append genesis seed transaction
        const seedWithQty = seed.filter(s => s.qty > 0);
        if (seedWithQty.length === 0) return;

        const genesisTx: Transaction = {
          id: ulid(),
          transfers: seedWithQty.map(s => ({
            resource: s.itemRef,
            qty: s.qty,
            from: "world.genesis",
            to: s.h3Index ? `world@${s.h3Index}` : "world",
          })),
          cause: "seed",
          actors: [],
          ts: Date.now(),
          prevHash: "",
          hash: "",
        };
        genesisTx.hash = hashTransaction({ id: genesisTx.id, transfers: genesisTx.transfers, cause: genesisTx.cause, actors: genesisTx.actors, ts: genesisTx.ts }, "");

        await writeEntry(genesisTx, null);
        applyTransfers(genesisTx.transfers);
        seenIds.add(genesisTx.id);
        tipHash = genesisTx.hash;
      },
      catch: (e) => new LedgerPersistenceError({ cause: String(e) }),
    });

  // ---------------------------------------------------------------------------
  // Neo4j write helper — append entry and move LEDGER_TIP
  // ---------------------------------------------------------------------------

  async function writeEntry(tx: Transaction, prevEntryId: string | null): Promise<void> {
    const writeSession = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      // Step 1: Create the new LedgerEntry node
      await writeSession.run(
        `CREATE (e:LedgerEntry {
           id: $id, cause: $cause, actors: $actors,
           ts: $ts, prevHash: $prevHash, hash: $hash,
           transfers: $transfersJson
         })`,
        {
          id: tx.id, cause: tx.cause, actors: tx.actors,
          ts: neo4j.int(tx.ts), prevHash: tx.prevHash, hash: tx.hash,
          transfersJson: JSON.stringify(tx.transfers),
        }
      );

      // Step 2: Wire into the session chain
      const result2 = await writeSession.run(
        `MATCH (s:LiveSession { id: $sessionId })
         MATCH (e:LedgerEntry { id: $entryId })
         // Set LEDGER_HEAD only if none exists
         FOREACH (_ IN CASE WHEN NOT (s)-[:LEDGER_HEAD]->() THEN [1] ELSE [] END |
           CREATE (s)-[:LEDGER_HEAD]->(e)
         )
         // Move LEDGER_TIP
         WITH s, e
         OPTIONAL MATCH (s)-[oldTip:LEDGER_TIP]->()
         DELETE oldTip
         CREATE (s)-[:LEDGER_TIP]->(e)`,
        { sessionId, entryId: tx.id }
      );
      if (result2.summary.counters.updates().relationshipsCreated === 0) {
        throw new Error(`LiveSession ${sessionId} not found in Neo4j`);
      }

      // Step 3: Create NEXT_ENTRY from previous entry (if any)
      if (prevEntryId !== null) {
        await writeSession.run(
          `MATCH (prev:LedgerEntry { id: $prevId })
           MATCH (e:LedgerEntry { id: $entryId })
           CREATE (prev)-[:NEXT_ENTRY]->(e)`,
          { prevId: prevEntryId, entryId: tx.id }
        );
      }
    } finally {
      await writeSession.close();
    }
  }

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
        if (avail - cost.qty < 0)
          yield* Effect.fail(new LedgerInsufficientFunds({ actorId, resource: cost.resource, required: cost.qty, available: avail }));
      }
      return { transactionId: ulid(), costs } as CostQuote;
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

      if (seenIds.has(tx.id))
        yield* Effect.fail(new LedgerDuplicateTransaction({ id: tx.id }));

      // Validate sufficient funds (world.genesis may go negative — seed authority)
      for (const t of tx.transfers) {
        if (t.from === "world.genesis") continue;
        const current = balance(t.from, t.resource);
        if (current - t.qty < 0)
          yield* Effect.fail(new LedgerInsufficientFunds({ actorId: t.from, resource: t.resource, required: t.qty, available: current }));
      }

      const prevId = seenIds.size > 0 ? [...seenIds].at(-1) ?? null : null;
      const full: Transaction = { ...tx, prevHash: tipHash, hash: "" };
      full.hash = hashTransaction({ id: full.id, transfers: full.transfers, cause: full.cause, actors: full.actors, ts: full.ts }, tipHash);

      // Apply to cache before write; revert on failure
      applyTransfers(tx.transfers);
      try {
        yield* Effect.tryPromise({
          try: () => writeEntry(full, prevId),
          catch: (e) => new LedgerPersistenceError({ cause: String(e) }),
        });
      } catch (err) {
        revertTransfers(tx.transfers);
        yield* Effect.fail(err as LedgerPersistenceError);
      }

      seenIds.add(full.id);
      tipHash = full.hash;

      // Emit ledger:transaction:committed for Colyseus broadcast (fire-and-forget)
      if (publish) {
        const changes = tx.transfers.map(t => ({
          actorId: t.to,
          resource: t.resource,
          newBalance: balance(t.to, t.resource),
          delta: t.qty,
        })).concat(
          tx.transfers.map(t => ({
            actorId: t.from,
            resource: t.resource,
            newBalance: balance(t.from, t.resource),
            delta: -t.qty,
          }))
        );
        try {
          publish("ledger:transaction:committed", {
            type: "ledger:transaction:committed",
            sessionId,
            transactionId: full.id,
            cause: full.cause,
            ts: full.ts,
            changes,
          });
        } catch { /* publish errors must never break the commit */ }
      }

      return full;
    });

  // ---------------------------------------------------------------------------
  // verify
  // ---------------------------------------------------------------------------

  const verify = () =>
    Effect.tryPromise({
      try: async () => {
        const readSession = driver.session({ defaultAccessMode: neo4j.session.READ });
        let entries: Pick<Transaction, "id" | "transfers" | "cause" | "actors" | "ts" | "prevHash" | "hash">[] = [];
        try {
          const result = await readSession.run(
            `MATCH (s:LiveSession { id: $sessionId })-[:LEDGER_HEAD]->(head:LedgerEntry)
             MATCH (head)-[:NEXT_ENTRY*0..]->(e:LedgerEntry)
             RETURN e.id AS id, e.cause AS cause, e.actors AS actors,
                    e.ts AS ts, e.prevHash AS prevHash, e.hash AS hash,
                    e.transfers AS transfersJson
             ORDER BY e.ts ASC`,
            { sessionId }
          );
          entries = result.records.map((rec) => ({
            id: rec.get("id") as string,
            cause: rec.get("cause") as string,
            actors: rec.get("actors") as string[],
            ts: (rec.get("ts") as any).toNumber?.() ?? Number(rec.get("ts")),
            prevHash: rec.get("prevHash") as string,
            hash: rec.get("hash") as string,
            transfers: JSON.parse(rec.get("transfersJson") as string) as Transfer[],
          }));
        } finally {
          await readSession.close();
        }

        let prevHash = "";
        for (const entry of entries) {
          const expected = hashTransaction(
            { id: entry.id, transfers: entry.transfers, cause: entry.cause, actors: entry.actors, ts: entry.ts },
            prevHash
          );
          if (expected !== entry.hash) {
            throw new LedgerChainTamperedError({ atId: entry.id, expectedHash: expected, actualHash: entry.hash });
          }
          prevHash = entry.hash;
        }
        return { entries: entries.length };
      },
      catch: (e) => {
        if (e instanceof LedgerChainTamperedError) return e;
        return new LedgerChainTamperedError({ atId: "unknown", expectedHash: "", actualHash: String(e) });
      },
    });

  return { init, bag, quote, commit, verify };
}

export function makeLedgerServiceLiveLayer(driver: Driver, sessionId: string): Layer.Layer<LedgerService> {
  return Layer.succeed(LedgerService, makeLedgerServiceLive(driver, sessionId));
}
