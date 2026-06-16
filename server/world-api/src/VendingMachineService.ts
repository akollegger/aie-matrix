/**
 * Vending machine — a generic, placeable CONTAINER primitive.
 *
 * A vending machine is an empty vessel that holds any number of item
 * "slots", each pairing an `itemRef` with a price (in Cyphers) and a
 * quantity. The machine knows NOTHING about what it contains — food,
 * tickets, umbrellas, keys, anything in the item sidecar. Contents are
 * defined per instantiation via `install` / `setContents`, not baked
 * into the type.
 *
 * Two properties are intrinsic to the primitive:
 *  1. It is a container of priced slots over arbitrary items.
 *  2. It conducts exactly ONE transaction at a time (a per-machine lock
 *     held across the whole purchase, including the async payment step).
 *
 * The primitive is deliberately decoupled from the economy: `purchase`
 * takes a `pay` callback that performs whatever the caller wants under
 * the lock (debit Cyphers from the buyer, grant the item to its bag,
 * emit an event…). The machine validates stock, serializes access, runs
 * `pay`, and decrements on success. Payment-mechanism, currency, and
 * item-delivery all live in the caller — so the same machine works for
 * any economy or none.
 */

import { Context, Data, Effect, Layer } from "effect";

/** One priced offering in a machine. `quantity < 0` means unlimited
 *  stock (the machine never runs dry and never decrements). */
export interface VendingSlot {
  readonly itemRef: string;
  /** Price in Cyphers (or whatever currency the caller's `pay` charges). */
  readonly price: number;
  /** Units remaining; `< 0` = unlimited. Mutated on purchase. */
  quantity: number;
}

/** A placed vending machine instance. */
export interface VendingMachine {
  readonly machineId: string;
  /** Human-readable name surfaced to agents (e.g. "Vending Machine"). */
  readonly label: string;
  /** The cell the machine sits on; agents must be co-located to buy. */
  readonly h3Index: string;
  /** Priced offerings. Empty until stocked. */
  readonly slots: VendingSlot[];
}

/** Result of a successful purchase. */
export interface VendResult {
  readonly machineId: string;
  readonly itemRef: string;
  readonly price: number;
  /** Units left after this purchase; `< 0` = unlimited. */
  readonly remaining: number;
}

// ── Errors (co-located; promote into the WorldApiError union + errorToResponse
//    when the MCP `purchase` tool is wired) ───────────────────────────────────

export class VendingMachineNotFound extends Data.TaggedError(
  "VendingError.MachineNotFound",
)<{ readonly machineId: string }> {}

export class VendingNotStocked extends Data.TaggedError(
  "VendingError.NotStocked",
)<{ readonly machineId: string; readonly itemRef: string }> {}

export class VendingOutOfStock extends Data.TaggedError(
  "VendingError.OutOfStock",
)<{ readonly machineId: string; readonly itemRef: string }> {}

/** The machine is mid-transaction with someone else — try again. This is
 *  the "one transaction at a time" guard surfacing to a second buyer. */
export class VendingBusy extends Data.TaggedError("VendingError.Busy")<{
  readonly machineId: string;
}> {}

export type VendingError =
  | VendingMachineNotFound
  | VendingNotStocked
  | VendingOutOfStock
  | VendingBusy;

export interface VendingMachineServiceOps {
  /** Install (or replace) a machine. Slots may be empty — contents are
   *  defined per instantiation. */
  install(machine: VendingMachine): void;
  /** Replace the contents of an existing machine. No-op if unknown. */
  setContents(machineId: string, slots: VendingSlot[]): void;
  get(machineId: string): VendingMachine | undefined;
  /** Machines sitting on a given cell (an agent buys from a co-located one). */
  getOnCell(h3Index: string): VendingMachine[];
  all(): VendingMachine[];
  /** Read-only snapshot of a machine's offerings, for perception. */
  contents(machineId: string): readonly VendingSlot[];
  /**
   * Buy one unit of `itemRef` from `machineId`. Acquires the machine's
   * single-transaction lock, validates the slot has stock, runs the
   * caller's `pay` effect under the lock, decrements on success, and
   * always releases the lock. If `pay` fails, nothing is decremented and
   * its error is propagated. A concurrent purchase on the same machine
   * fails fast with `VendingBusy`.
   */
  purchase<E>(
    machineId: string,
    itemRef: string,
    pay: (slot: VendingSlot) => Effect.Effect<void, E>,
  ): Effect.Effect<VendResult, E | VendingError>;
}

export class VendingMachineService extends Context.Tag(
  "world-api/VendingMachineService",
)<VendingMachineService, VendingMachineServiceOps>() {}

export class VendingMachineServiceImpl implements VendingMachineServiceOps {
  private readonly machines = new Map<string, VendingMachine>();
  /** Machines currently mid-transaction — the one-at-a-time lock. */
  private readonly busy = new Set<string>();

  install(machine: VendingMachine): void {
    this.machines.set(machine.machineId, {
      ...machine,
      slots: machine.slots.map((s) => ({ ...s })),
    });
  }

  setContents(machineId: string, slots: VendingSlot[]): void {
    const m = this.machines.get(machineId);
    if (m === undefined) return;
    this.machines.set(machineId, { ...m, slots: slots.map((s) => ({ ...s })) });
  }

  get(machineId: string): VendingMachine | undefined {
    return this.machines.get(machineId);
  }

  getOnCell(h3Index: string): VendingMachine[] {
    return [...this.machines.values()].filter((m) => m.h3Index === h3Index);
  }

  all(): VendingMachine[] {
    return [...this.machines.values()];
  }

  contents(machineId: string): readonly VendingSlot[] {
    return this.machines.get(machineId)?.slots ?? [];
  }

  purchase<E>(
    machineId: string,
    itemRef: string,
    pay: (slot: VendingSlot) => Effect.Effect<void, E>,
  ): Effect.Effect<VendResult, E | VendingError> {
    const self = this;
    return Effect.gen(function* () {
      // One transaction at a time: bail fast if the machine is busy.
      if (self.busy.has(machineId)) {
        return yield* Effect.fail(new VendingBusy({ machineId }));
      }
      self.busy.add(machineId);

      // Everything below runs under the lock; release no matter what.
      const txn = Effect.gen(function* () {
        const machine = self.machines.get(machineId);
        if (machine === undefined) {
          return yield* Effect.fail(new VendingMachineNotFound({ machineId }));
        }
        const slot = machine.slots.find((s) => s.itemRef === itemRef);
        if (slot === undefined) {
          return yield* Effect.fail(new VendingNotStocked({ machineId, itemRef }));
        }
        if (slot.quantity === 0) {
          return yield* Effect.fail(new VendingOutOfStock({ machineId, itemRef }));
        }
        // Payment + delivery happen here, under the lock. If they fail,
        // the slot is NOT decremented — the buyer keeps their money.
        yield* pay(slot);
        if (slot.quantity > 0) slot.quantity -= 1; // unlimited (<0) never decrements
        return {
          machineId,
          itemRef,
          price: slot.price,
          remaining: slot.quantity,
        } satisfies VendResult;
      });

      return yield* txn.pipe(
        Effect.ensuring(Effect.sync(() => self.busy.delete(machineId))),
      );
    });
  }
}

export const makeVendingMachineServiceLayer = (
  impl: VendingMachineServiceImpl,
): Layer.Layer<VendingMachineService> =>
  Layer.succeed(VendingMachineService, impl);
