/**
 * Vending machine primitive — a generic container of priced slots over
 * ARBITRARY items (not just food), with a one-transaction-at-a-time lock.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Data, Deferred, Effect, Either, Fiber } from "effect";

import {
  VendingMachineServiceImpl,
  VendingBusy,
  VendingMachineNotFound,
  VendingNotStocked,
  VendingOutOfStock,
  type VendingSlot,
} from "./VendingMachineService.js";

const noop = (_slot: VendingSlot) => Effect.void;

test("installs empty, then stocks arbitrary (non-food) items", () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({ machineId: "m1", label: "Vending Machine", h3Index: "cell-a", slots: [] });
  assert.deepEqual(svc.contents("m1"), []);

  svc.setContents("m1", [
    { itemRef: "ticket-day-pass", price: 25, quantity: 3 },
    { itemRef: "umbrella", price: 12, quantity: 1 },
    { itemRef: "sticker-pack", price: 2, quantity: -1 }, // unlimited
  ]);
  const refs = svc.contents("m1").map((s) => s.itemRef);
  assert.deepEqual(refs, ["ticket-day-pass", "umbrella", "sticker-pack"]);
});

test("purchase returns price, decrements stock, runs the pay callback", async () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({
    machineId: "m1",
    label: "Machine",
    h3Index: "cell-a",
    slots: [{ itemRef: "umbrella", price: 12, quantity: 2 }],
  });

  let paidPrice = -1;
  const res = await Effect.runPromise(
    svc.purchase("m1", "umbrella", (slot) =>
      Effect.sync(() => {
        paidPrice = slot.price;
      }),
    ),
  );
  assert.equal(res.price, 12);
  assert.equal(res.remaining, 1);
  assert.equal(paidPrice, 12, "pay callback saw the slot price");
  assert.equal(svc.get("m1")!.slots[0]!.quantity, 1, "stock decremented");
});

test("unlimited slot (quantity < 0) never decrements, never runs dry", async () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({
    machineId: "m1",
    label: "Machine",
    h3Index: "c",
    slots: [{ itemRef: "sticker-pack", price: 2, quantity: -1 }],
  });
  for (let i = 0; i < 5; i++) {
    const r = await Effect.runPromise(svc.purchase("m1", "sticker-pack", noop));
    assert.ok(r.remaining < 0, "stays unlimited");
  }
  assert.ok(svc.get("m1")!.slots[0]!.quantity < 0);
});

test("out-of-stock, not-stocked, unknown-machine errors", async () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({
    machineId: "m1",
    label: "Machine",
    h3Index: "c",
    slots: [{ itemRef: "umbrella", price: 12, quantity: 0 }],
  });

  const oos = await Effect.runPromise(Effect.either(svc.purchase("m1", "umbrella", noop)));
  assert.ok(Either.isLeft(oos) && oos.left instanceof VendingOutOfStock);

  const ns = await Effect.runPromise(Effect.either(svc.purchase("m1", "no-such-item", noop)));
  assert.ok(Either.isLeft(ns) && ns.left instanceof VendingNotStocked);

  const nf = await Effect.runPromise(Effect.either(svc.purchase("ghost-machine", "umbrella", noop)));
  assert.ok(Either.isLeft(nf) && nf.left instanceof VendingMachineNotFound);
});

class PaymentDeclined extends Data.TaggedError("Test.PaymentDeclined")<{}> {}

test("payment failure propagates and does NOT decrement stock", async () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({
    machineId: "m1",
    label: "Machine",
    h3Index: "c",
    slots: [{ itemRef: "umbrella", price: 12, quantity: 2 }],
  });
  const res = await Effect.runPromise(
    Effect.either(svc.purchase("m1", "umbrella", () => Effect.fail(new PaymentDeclined()))),
  );
  assert.ok(Either.isLeft(res) && res.left instanceof PaymentDeclined);
  assert.equal(svc.get("m1")!.slots[0]!.quantity, 2, "no decrement on failed payment");
});

test("ONE transaction at a time: a concurrent purchase fails fast with VendingBusy", async () => {
  const svc = new VendingMachineServiceImpl();
  svc.install({
    machineId: "m1",
    label: "Machine",
    h3Index: "c",
    slots: [{ itemRef: "umbrella", price: 12, quantity: 5 }],
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();

      // Buyer A enters the lock and parks inside `pay` until we open the gate.
      const payA = (_slot: VendingSlot) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Deferred.await(gate)),
        );
      const fiberA = yield* Effect.fork(svc.purchase("m1", "umbrella", payA));

      // Wait until A is provably mid-transaction (lock held).
      yield* Deferred.await(started);

      // Buyer B tries the same machine → fast VendingBusy, no stock touched.
      const b = yield* Effect.either(svc.purchase("m1", "umbrella", noop));
      assert.ok(Either.isLeft(b) && b.left instanceof VendingBusy, "B is turned away");
      assert.equal(svc.get("m1")!.slots[0]!.quantity, 5, "B did not consume stock");

      // Release A; it completes and the lock frees.
      yield* Deferred.succeed(gate, undefined);
      const a = yield* Fiber.join(fiberA);
      assert.equal(a.remaining, 4, "A's purchase went through");

      // After A finishes, the machine is free again.
      const c = yield* svc.purchase("m1", "umbrella", noop);
      assert.equal(c.remaining, 3, "machine free again after A");
    }),
  );
});
