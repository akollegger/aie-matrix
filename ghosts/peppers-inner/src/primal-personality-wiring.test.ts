/**
 * Unit tests for the primal-personality wiring. Focus areas:
 *   - streak compounds linearly in the same direction
 *   - streak unwinds at `recovery_multiplier` rate when event opposes
 *   - force = streak × |flux| × base_step × edge_direction
 *   - zero flux fires nothing
 *   - "rich and stable" / "poor and stable" ghosts get no streak
 *     because flux is zero (this is the cultural-bias resolution)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRIMAL_BASE_STEP,
  DEFAULT_PRIMAL_PERSONALITY_EDGES,
  DEFAULT_PRIMAL_RECOVERY_MULTIPLIER,
  computePrimalForces,
  emptyPrimalStreaks,
  primalEdgeKey,
  updateStreaks,
  type PrimalPersonalityEdge,
} from "./primal-personality-wiring.js";

const ONE_FUEL_EDGE: ReadonlyArray<PrimalPersonalityEdge> = [
  { source: "Fuel", targetFacet: "Warmth", targetAxis: "internal", direction: 1 },
];
const KEY = primalEdgeKey(ONE_FUEL_EDGE[0]!);

test("emptyPrimalStreaks initialises one zero per edge", () => {
  const s = emptyPrimalStreaks(DEFAULT_PRIMAL_PERSONALITY_EDGES);
  assert.equal(Object.keys(s).length, DEFAULT_PRIMAL_PERSONALITY_EDGES.length);
  for (const v of Object.values(s)) assert.equal(v, 0);
});

test("sustained negative flux compounds the streak linearly", () => {
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 5; i++) {
    s = updateStreaks(s, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  }
  assert.equal(s[KEY], -5);
});

test("sustained positive flux compounds the streak linearly", () => {
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 5; i++) {
    s = updateStreaks(s, { Fuel: 0.25 }, ONE_FUEL_EDGE);
  }
  assert.equal(s[KEY], 5);
});

test("opposing flux unwinds streak at the recovery multiplier rate", () => {
  // Build to streak = -10
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 10; i++) {
    s = updateStreaks(s, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  }
  assert.equal(s[KEY], -10);
  // 5 sustained `+` events at recovery=2 should bring it to exactly 0
  for (let i = 0; i < 5; i++) {
    s = updateStreaks(s, { Fuel: 0.25 }, ONE_FUEL_EDGE);
  }
  assert.equal(s[KEY], 0);
});

test("a sixth `+` event after fully unwinding starts a positive streak at +1", () => {
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 10; i++) s = updateStreaks(s, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  for (let i = 0; i < 5; i++) s = updateStreaks(s, { Fuel: 0.25 }, ONE_FUEL_EDGE);
  s = updateStreaks(s, { Fuel: 0.25 }, ONE_FUEL_EDGE);
  assert.equal(s[KEY], 1);
});

test("zero flux is a no-op (rare in practice; floor of behaviour)", () => {
  const s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  const after = updateStreaks(s, { Fuel: 0 }, ONE_FUEL_EDGE);
  assert.equal(after[KEY], 0);
});

test("a stable ghost (zero flux) gets no force — cultural-bias resolution", () => {
  // A ghost at any Fuel level who maintains it cascade-to-cascade
  // produces flux=0, never updates the streak, and gets no force.
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 50; i++) {
    s = updateStreaks(s, { Fuel: 0 }, ONE_FUEL_EDGE);
  }
  const forces = computePrimalForces(s, { Fuel: 0 }, ONE_FUEL_EDGE);
  assert.equal(forces.length, 0);
});

test("force = streak × magnitude × base_step × direction", () => {
  let s = emptyPrimalStreaks(ONE_FUEL_EDGE);
  for (let i = 0; i < 5; i++) s = updateStreaks(s, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  const forces = computePrimalForces(s, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  assert.equal(forces.length, 1);
  const expected = -5 * 0.75 * DEFAULT_PRIMAL_BASE_STEP * 1;
  assert.ok(
    Math.abs(forces[0]!.logitDelta - expected) < 1e-12,
    `expected force ${expected}, got ${forces[0]!.logitDelta}`,
  );
});

test("force direction flips when edge.direction = -1 (opposes)", () => {
  const opposes: PrimalPersonalityEdge[] = [
    { source: "Fuel", targetFacet: "Trust", targetAxis: "internal", direction: -1 },
  ];
  let s = emptyPrimalStreaks(opposes);
  for (let i = 0; i < 3; i++) s = updateStreaks(s, { Fuel: -0.5 }, opposes);
  const forces = computePrimalForces(s, { Fuel: -0.5 }, opposes);
  // streak=-3, magnitude=0.5, base=0.01, direction=-1
  // expected: -3 * 0.5 * 0.01 * -1 = +0.015
  assert.equal(forces.length, 1);
  assert.ok(forces[0]!.logitDelta > 0);
});

test("a sudden cliff-edge loss this cascade pushes harder than a slow drain", () => {
  // Two ghosts at streak = -3. Ghost A gets a normal-magnitude loss
  // this cascade (-0.75). Ghost B gets a cliff-edge loss (-3).
  const streaksA = emptyPrimalStreaks(ONE_FUEL_EDGE);
  const streaksB = emptyPrimalStreaks(ONE_FUEL_EDGE);
  let sA = streaksA;
  let sB = streaksB;
  for (let i = 0; i < 3; i++) {
    sA = updateStreaks(sA, { Fuel: -0.75 }, ONE_FUEL_EDGE);
    sB = updateStreaks(sB, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  }
  // Each at streak -3. Now apply different magnitudes.
  const fA = computePrimalForces(sA, { Fuel: -0.75 }, ONE_FUEL_EDGE);
  const fB = computePrimalForces(sB, { Fuel: -3.0 }, ONE_FUEL_EDGE);
  assert.ok(
    Math.abs(fB[0]!.logitDelta) > Math.abs(fA[0]!.logitDelta),
    "cliff-edge loss should produce larger force at the same streak length",
  );
});

test("default Fuel edges cover Warmth, Trust, Altruism, Stability", () => {
  const targets = DEFAULT_PRIMAL_PERSONALITY_EDGES.map((e) => e.targetFacet).sort();
  assert.deepEqual(targets, ["Altruism", "Stability", "Trust", "Warmth"]);
});

test("recovery multiplier default is 2", () => {
  assert.equal(DEFAULT_PRIMAL_RECOVERY_MULTIPLIER, 2);
});
