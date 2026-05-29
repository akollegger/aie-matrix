/**
 * Unit tests for the primal-needs substrate.
 *
 * Verifies the factory shape, linear depletion math, the asymmetric
 * adjustment helper, and the sweet-spot starting state. Needs use
 * linear (display-space) math, NOT the sigmoid-bounded slider math
 * that personality feelings use.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NEED_DEPLETION,
  STARTER_NEEDS,
  adjustNeed,
  applyCascadeDepletion,
  midpointNeeds,
  startingNeeds,
} from "./needs.js";

test("STARTER_NEEDS lists exactly Fuel, Coherence, Rest in that order", () => {
  assert.deepEqual([...STARTER_NEEDS], ["Fuel", "Coherence", "Rest"]);
});

test("midpointNeeds spawns every need at display 5 (satiated)", () => {
  const m = midpointNeeds();
  for (const need of STARTER_NEEDS) {
    assert.equal(m[need].display, 5, `${need} should start at display 5`);
  }
});

test("startingNeeds (no config) returns the same as midpointNeeds", () => {
  const a = startingNeeds();
  const b = midpointNeeds();
  for (const need of STARTER_NEEDS) {
    assert.equal(a[need].display, b[need].display);
  }
});

test("applyCascadeDepletion drops every active need's display by exactly its rate", () => {
  const before = midpointNeeds();
  const after = applyCascadeDepletion(before);
  for (const need of STARTER_NEEDS) {
    const rate = DEFAULT_NEED_DEPLETION[need];
    const expected = Math.max(0, before[need].display - rate);
    assert.ok(
      Math.abs(after[need].display - expected) < 1e-9,
      `${need}: expected ${expected}, got ${after[need].display}`,
    );
  }
});

test("depletion is linear and respects per-need rates", () => {
  let profile = midpointNeeds();
  for (let i = 0; i < 50; i++) profile = applyCascadeDepletion(profile);
  // 50 cascades of Fuel at 0.05/cascade = 2.5 (display 5 → 2.5)
  assert.ok(
    Math.abs(profile.Fuel.display - 2.5) < 1e-9,
    `Fuel should be exactly 2.5 after 50 cascades, got ${profile.Fuel.display}`,
  );
  // Coherence is at rate 0 → stays at midpoint
  assert.equal(profile.Coherence.display, 5);
  // Rest at 0.02/cascade × 50 = 1.0, display 5 → 4.0
  assert.ok(
    Math.abs(profile.Rest.display - 4.0) < 1e-9,
    `Rest should be exactly 4.0 after 50 cascades, got ${profile.Rest.display}`,
  );
});

test("depletion floors at 0 (no negative display)", () => {
  let profile = midpointNeeds();
  for (let i = 0; i < 1000; i++) profile = applyCascadeDepletion(profile);
  assert.equal(profile.Fuel.display, 0, "Fuel should floor at exactly 0");
  assert.equal(profile.Rest.display, 0, "Rest should floor at exactly 0");
});

test("adjustNeed up adds delta to display linearly", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "up", 1.5);
  assert.equal(after.Fuel.display, 6.5, "5 + 1.5 = 6.5");
});

test("adjustNeed up clamps at display 10", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "up", 100);
  assert.equal(after.Fuel.display, 10, "should clamp at the max");
});

test("adjustNeed down subtracts delta from display linearly", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "down", 3);
  assert.equal(after.Fuel.display, 2, "5 - 3 = 2");
});

test("adjustNeed down clamps at display 0", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "down", 100);
  assert.equal(after.Fuel.display, 0, "should clamp at the min");
});

test("adjustNeed leaves other needs untouched", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "down", 1);
  assert.equal(after.Coherence.display, profile.Coherence.display);
  assert.equal(after.Rest.display, profile.Rest.display);
});

test("eating 1 unit of food on a starving ghost adds exactly 1 to display", () => {
  // The canonical math the substrate must honour: 1.82 + 1 = 2.82.
  // Eat 1 unit, display goes up by 1.
  const profile = midpointNeeds();
  const depleted = adjustNeed(profile, "Fuel", "down", 3.18); // 5 - 3.18 = 1.82
  assert.ok(Math.abs(depleted.Fuel.display - 1.82) < 1e-9);
  const after = adjustNeed(depleted, "Fuel", "up", 1);
  assert.ok(
    Math.abs(after.Fuel.display - 2.82) < 1e-9,
    `1.82 + 1 must equal 2.82, got ${after.Fuel.display}`,
  );
});

test("DEFAULT_NEED_DEPLETION has reasonable magnitudes (Coherence currently disabled)", () => {
  assert.ok(
    DEFAULT_NEED_DEPLETION.Fuel > DEFAULT_NEED_DEPLETION.Rest,
    "Fuel should deplete faster than Rest",
  );
  assert.equal(DEFAULT_NEED_DEPLETION.Coherence, 0, "Coherence depletion is disabled");
  for (const need of STARTER_NEEDS) {
    const r = DEFAULT_NEED_DEPLETION[need];
    assert.ok(r >= 0 && r < 0.5, `${need} rate should be in [0, 0.5), got ${r}`);
  }
});
