/**
 * Unit tests for the primal-needs substrate.
 *
 * Fuel is now backed by the generic Slider component in sigmoid mode
 * with a mobile setpoint. Coherence and Rest stay linear. The tests
 * below reflect those semantics; the older "1 unit = exactly +1
 * display" guarantees only hold for Coherence/Rest now, since
 * sigmoid compression is the whole point on Fuel.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NEED_DEPLETION,
  STARTER_NEEDS,
  adjustNeed,
  applyCascadeDepletion,
  incrementNeedTolerance,
  midpointNeeds,
  needDistanceFromSetpoint,
  needSetpointDisplay,
  startingNeeds,
} from "./needs.js";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);

test("STARTER_NEEDS lists exactly Fuel, Coherence, Rest in that order", () => {
  assert.deepEqual([...STARTER_NEEDS], ["Fuel", "Coherence", "Rest"]);
});

test("midpointNeeds spawns every need at display 5 (satiated)", () => {
  const m = midpointNeeds();
  for (const need of STARTER_NEEDS) {
    close(m[need].display, 5);
  }
});

test("startingNeeds (no config) returns the same as midpointNeeds", () => {
  const a = startingNeeds();
  const b = midpointNeeds();
  for (const need of STARTER_NEEDS) {
    close(a[need].display, b[need].display);
  }
});

test("Coherence holds at midpoint; Rest depletes (sigmoid)", () => {
  let profile = midpointNeeds();
  for (let i = 0; i < 50; i++) profile = applyCascadeDepletion(profile);
  // Coherence rate 0 → stays at midpoint
  close(profile.Coherence.display, 5);
  // Rest is now a sigmoid slider (same component as Fuel): it drops from
  // midpoint but asymptotes rather than hitting a linear target.
  assert.ok(profile.Rest.display < 5, "Rest must drop from midpoint");
  assert.ok(profile.Rest.display > 0, "Rest must stay strictly above 0");
});

test("Fuel depletion compresses near the floor (sigmoid)", () => {
  // Linear math at rate 0.05 × 100 = 5 would say display 0. Sigmoid
  // doesn't reach 0 — it asymptotes. We just verify a meaningful
  // drop with no overshoot.
  let profile = midpointNeeds();
  for (let i = 0; i < 100; i++) profile = applyCascadeDepletion(profile);
  assert.ok(profile.Fuel.display > 0, "Fuel must stay strictly above 0");
  assert.ok(
    profile.Fuel.display < 4,
    `Fuel should have meaningfully dropped, got ${profile.Fuel.display.toFixed(3)}`,
  );
});

test("depletion never lets any need reach the bounds exactly", () => {
  let profile = midpointNeeds();
  for (let i = 0; i < 10_000; i++) profile = applyCascadeDepletion(profile);
  for (const need of STARTER_NEEDS) {
    assert.ok(profile[need].display >= 0);
    assert.ok(profile[need].display < 10);
  }
});

test("adjustNeed up on Fuel moves toward but never reaches 10 (sigmoid)", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "up", 100);
  assert.ok(
    after.Fuel.display > 5 && after.Fuel.display < 10,
    `Fuel should asymptote, got ${after.Fuel.display}`,
  );
});

test("adjustNeed down on Fuel moves toward but never reaches 0 (sigmoid)", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "down", 100);
  assert.ok(
    after.Fuel.display > 0 && after.Fuel.display < 5,
    `Fuel should asymptote, got ${after.Fuel.display}`,
  );
});

test("adjustNeed leaves other needs untouched", () => {
  const profile = midpointNeeds();
  const after = adjustNeed(profile, "Fuel", "down", 1);
  close(after.Coherence.display, profile.Coherence.display);
  close(after.Rest.display, profile.Rest.display);
});

test("sigmoid replenishment: a starving ghost gets more out of a bite than a satiated one", () => {
  const starving = adjustNeed(midpointNeeds(), "Fuel", "down", 8); // → display ≈ 2.7
  const satiated = adjustNeed(midpointNeeds(), "Fuel", "up", 6); // → display ≈ 7.3
  const starvingAfter = adjustNeed(starving, "Fuel", "up", 1).Fuel.display;
  const satiatedAfter = adjustNeed(satiated, "Fuel", "up", 1).Fuel.display;
  const starvingGain = starvingAfter - starving.Fuel.display;
  const satiatedGain = satiatedAfter - satiated.Fuel.display;
  assert.ok(
    starvingGain > satiatedGain,
    `bite at low Fuel (Δ=${starvingGain.toFixed(3)}) should out-gain bite at high Fuel (Δ=${satiatedGain.toFixed(3)})`,
  );
});

test("Fuel setpoint shifts up after high-side tolerance increments", () => {
  let profile = midpointNeeds();
  close(needSetpointDisplay(profile, "Fuel"), 5);
  profile = incrementNeedTolerance(profile, "Fuel", "high");
  assert.ok(
    needSetpointDisplay(profile, "Fuel") > 5,
    `setpoint should rise after a binge; got ${needSetpointDisplay(profile, "Fuel")}`,
  );
});

test("after Fuel tolerance rises, the same Fuel reads as more depleted", () => {
  let profile = midpointNeeds(); // display 5, setpoint 5 → distance 0
  close(needDistanceFromSetpoint(profile, "Fuel"), 0);
  for (let i = 0; i < 3; i++) {
    profile = incrementNeedTolerance(profile, "Fuel", "high");
  }
  // value unchanged, setpoint up → distance negative
  assert.ok(
    needDistanceFromSetpoint(profile, "Fuel") < -1,
    `distance from setpoint should turn meaningfully negative; got ${needDistanceFromSetpoint(
      profile,
      "Fuel",
    ).toFixed(3)}`,
  );
});

test("Coherence/Rest tolerance is a no-op (locked setpoint config)", () => {
  let profile = midpointNeeds();
  profile = incrementNeedTolerance(profile, "Coherence", "high");
  profile = incrementNeedTolerance(profile, "Rest", "high");
  close(needSetpointDisplay(profile, "Coherence"), 5);
  close(needSetpointDisplay(profile, "Rest"), 5);
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
