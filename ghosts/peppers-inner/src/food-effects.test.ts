/**
 * Food physiology — the cake sugar-high/crash mechanic and food
 * differentiation. Uses the node:test runner like the rest of this
 * package. Assertions are directional (Fuel/Rest are sigmoid sliders, so
 * exact display deltas compress near the bounds — only the SHAPE of the
 * trajectory is contractual).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { midpointNeeds, adjustNeed, applyCascadeDepletion } from "./needs.js";
import {
  applyFoodConsume,
  applyDuePendingEffects,
  foodEffectFor,
  type PendingNeedEffect,
} from "./food-effects.js";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Emulates the run-loop consume path: capture pre-eat Fuel, apply world
 *  tokens → Fuel restore, then the food's physiology layers on. */
function eat(
  needs: ReturnType<typeof midpointNeeds>,
  itemRef: string,
  tokens: number,
  cascadeIndex: number,
) {
  const fuelBefore = needs.Fuel.display;
  const afterTokens = adjustNeed(needs, "Fuel", "up", tokens);
  return applyFoodConsume(afterTokens, itemRef, cascadeIndex, fuelBefore);
}

test("cake: spikes Fuel + drops Rest now; crash removes exactly the gain + 1", () => {
  let needs = adjustNeed(midpointNeeds(), "Fuel", "down", 1.0); // mildly hungry
  const fuelPre = needs.Fuel.display;
  const restPre = needs.Rest.display;
  let pending: PendingNeedEffect[] = [];

  // Cascade 0: eat cake (tokens 4.0 from the world).
  const bite = eat(needs, "food-cake", 4.0, 0);
  needs = bite.needs;
  pending = [...pending, ...bite.enqueue];

  const gain = needs.Fuel.display - fuelPre; // the actual Fuel the cake delivered
  assert.ok(gain > 2, "absurd Fuel spike");
  assert.ok(needs.Rest.display < restPre - 0.5, "Rest pulled low");
  assert.ok(bite.strainDelta > 0, "metabolic strain now");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.dueAtCascade, 3); // 0 + crash.after(3)
  assert.equal(pending[0]!.need, "Fuel");
  assert.equal(pending[0]!.direction, "down");
  assert.equal(pending[0]!.mode, "display");
  // The scheduled crash is sized at exactly gain + 1.
  assert.ok(
    close(pending[0]!.amount, gain + 1, 1e-9),
    `crash amount ${pending[0]!.amount.toFixed(3)} == gain ${gain.toFixed(3)} + 1`,
  );

  // Cascades 1 & 2: depletion only, crash not yet due.
  for (let c = 1; c <= 2; c++) {
    needs = applyCascadeDepletion(needs);
    const due = applyDuePendingEffects(needs, pending, c);
    needs = due.needs;
    pending = due.remaining;
    assert.equal(due.fired.length, 0, `no crash at cascade ${c}`);
  }
  assert.ok(needs.Fuel.display > fuelPre, "still riding the high two cascades in");

  // Cascade 3: the crash fires. Measure the exact display it removes.
  needs = applyCascadeDepletion(needs);
  const fuelBeforeCrash = needs.Fuel.display;
  const crash = applyDuePendingEffects(needs, pending, 3);
  needs = crash.needs;
  pending = crash.remaining;
  assert.equal(crash.fired.length, 1, "crash fires at cascade 3");
  assert.equal(pending.length, 0);

  // The crash itself removed exactly gain + 1 display units (no sigmoid
  // compression) — "lose just one more than it gained".
  const removed = fuelBeforeCrash - needs.Fuel.display;
  assert.ok(
    close(removed, gain + 1, 1e-6),
    `crash removed ${removed.toFixed(3)} == gain ${gain.toFixed(3)} + 1`,
  );
  // And the cake episode nets negative overall.
  assert.ok(needs.Fuel.display < fuelPre, "net negative after the crash");
});

test("salad is clean: no crash, relieves strain", () => {
  const fc = applyFoodConsume(midpointNeeds(), "food-salad", 0, 5);
  assert.equal(fc.enqueue.length, 0);
  assert.ok(fc.strainDelta < 0);
});

test("coffee lifts Rest, no crash", () => {
  const before = midpointNeeds();
  const fc = applyFoodConsume(before, "food-coffee", 0, before.Fuel.display);
  assert.ok(fc.needs.Rest.display > before.Rest.display);
  assert.equal(fc.enqueue.length, 0);
});

test("bread is honest fuel: no side effects", () => {
  const before = midpointNeeds();
  const fc = applyFoodConsume(before, "food-bread", 0, before.Fuel.display);
  assert.equal(fc.strainDelta, 0);
  assert.equal(fc.enqueue.length, 0);
  assert.equal(fc.needs.Rest.display, before.Rest.display);
});

test("unknown item has no physiology", () => {
  assert.deepEqual(foodEffectFor("food-nonexistent"), {});
  assert.deepEqual(foodEffectFor(undefined), {});
});
