import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DELTA,
  DISPLAY_MAX,
  DISPLAY_MIDPOINT,
  DISPLAY_MIN,
  applyDelta,
  fromDisplay,
  midpoint,
  toDisplay,
} from "./sliders.js";

const EPS = 1e-6;

function approx(actual: number, expected: number, tolerance = 1e-3): void {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} ≈ ${expected} (±${tolerance})`,
  );
}

test("midpoint() has logit 0 and display 5", () => {
  const m = midpoint();
  assert.equal(m.logit, 0);
  approx(toDisplay(m), DISPLAY_MIDPOINT, EPS);
});

test("fromDisplay / toDisplay round-trip preserves value within precision", () => {
  for (const display of [0.5, 1, 2.5, 4.2, 5, 6, 7.7, 9.0, 9.5]) {
    const value = fromDisplay(display);
    approx(toDisplay(value), display);
  }
});

test("fromDisplay rejects values at or outside the open interval", () => {
  assert.throws(() => fromDisplay(0), RangeError);
  assert.throws(() => fromDisplay(10), RangeError);
  assert.throws(() => fromDisplay(-1), RangeError);
  assert.throws(() => fromDisplay(11), RangeError);
  assert.throws(() => fromDisplay(Number.NaN), RangeError);
  assert.throws(() => fromDisplay(Number.POSITIVE_INFINITY), RangeError);
});

test("applyDelta at midpoint is symmetric around 5.0", () => {
  const m = midpoint();
  const up = applyDelta(m, "up");
  const down = applyDelta(m, "down");
  approx(toDisplay(up) - DISPLAY_MIDPOINT, DISPLAY_MIDPOINT - toDisplay(down));
});

test("applyDelta diminishing-returns table (δ=0.5) per RFC-0007", () => {
  // Display 5.0 → up → ~6.22
  approx(toDisplay(applyDelta(fromDisplay(5.0), "up")), 6.22, 0.01);
  // Display 8.0 → up → ~8.69
  approx(toDisplay(applyDelta(fromDisplay(8.0), "up")), 8.69, 0.01);
  // Display 9.5 → up → ~9.69
  approx(toDisplay(applyDelta(fromDisplay(9.5), "up")), 9.69, 0.01);
});

// Floating-point note: the sigmoid is mathematically asymptotic to 0 and 10,
// but IEEE 754 doubles round 10/(1+exp(-L)) to exactly 10 once L ≳ 36 (about
// 72 repeated δ=0.5 steps in one direction). The tests below exercise
// realistic trajectories — a ghost lifetime won't stack 50 single-axis
// adjustments at default δ. For the mathematical asymptote itself, see
// the round-trip and symmetry tests above.

test("applyDelta stays strictly inside bounds across a realistic up-trajectory", () => {
  let v = midpoint();
  for (let i = 0; i < 50; i++) v = applyDelta(v, "up");
  const display = toDisplay(v);
  assert.ok(display < DISPLAY_MAX, `expected < ${DISPLAY_MAX}, got ${display}`);
  assert.ok(display > DISPLAY_MIDPOINT, `expected > ${DISPLAY_MIDPOINT}, got ${display}`);
});

test("applyDelta stays strictly inside bounds across a realistic down-trajectory", () => {
  let v = midpoint();
  for (let i = 0; i < 50; i++) v = applyDelta(v, "down");
  const display = toDisplay(v);
  assert.ok(display > DISPLAY_MIN, `expected > ${DISPLAY_MIN}, got ${display}`);
  assert.ok(display < DISPLAY_MIDPOINT, `expected < ${DISPLAY_MIDPOINT}, got ${display}`);
});

test("applyDelta is monotonic across repeated ups within float-safe range", () => {
  let v = midpoint();
  let prev = toDisplay(v);
  for (let i = 0; i < 50; i++) {
    v = applyDelta(v, "up");
    const next = toDisplay(v);
    assert.ok(next > prev, `step ${i}: expected monotonic increase, ${next} ≤ ${prev}`);
    prev = next;
  }
});

test("applyDelta rejects non-positive or non-finite delta", () => {
  assert.throws(() => applyDelta(midpoint(), "up", 0), RangeError);
  assert.throws(() => applyDelta(midpoint(), "up", -1), RangeError);
  assert.throws(() => applyDelta(midpoint(), "up", Number.NaN), RangeError);
  assert.throws(() => applyDelta(midpoint(), "up", Number.POSITIVE_INFINITY), RangeError);
});

test("applyDelta does not mutate the input", () => {
  const before = midpoint();
  const logitBefore = before.logit;
  applyDelta(before, "up");
  assert.equal(before.logit, logitBefore);
});

test("DEFAULT_DELTA is the documented 0.5 step", () => {
  assert.equal(DEFAULT_DELTA, 0.5);
});
