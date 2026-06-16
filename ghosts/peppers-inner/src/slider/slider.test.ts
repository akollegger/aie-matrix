import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEvent,
  DEFAULT_SLIDER_CONFIG,
  display,
  displayToLogit,
  distanceFromSetpoint,
  incrementTolerance,
  logitToDisplay,
  makeSlider,
  setpointDisplay,
  sliderFromDisplay,
  type SliderConfig,
} from "./index.js";

const SIGMOID: SliderConfig = {
  mode: "sigmoid",
  toleranceStep: 0.4,
  toleranceMax: 8,
  baseSetpoint: 0,
  eventScale: 1,
};

const LINEAR: SliderConfig = {
  mode: "linear",
  toleranceStep: 0,
  toleranceMax: 0,
  baseSetpoint: 0,
  eventScale: 0,
};

const close = (a: number, b: number, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);

test("logit 0 ↔ display 5", () => {
  close(logitToDisplay(0), 5);
  close(displayToLogit(5), 0);
});

test("display clamps to open interval at extremes", () => {
  const d = logitToDisplay(displayToLogit(11));
  assert.ok(d > 9.9 && d < 10);
});

test("sigmoid: a +1 event at display 2 affects display more than at display 8", () => {
  // The whole reason for sigmoid: hungry → bite registers; full →
  // bite barely registers.
  const low = sliderFromDisplay(2, SIGMOID);
  const high = sliderFromDisplay(8, SIGMOID);
  const lowAfter = display(applyEvent(low, 1, SIGMOID));
  const highAfter = display(applyEvent(high, 1, SIGMOID));
  const lowDelta = lowAfter - 2;
  const highDelta = highAfter - 8;
  assert.ok(
    lowDelta > highDelta,
    `low Δ ${lowDelta.toFixed(3)} should exceed high Δ ${highDelta.toFixed(3)}`,
  );
  // The hungry bite is meaningfully bigger — at least 1.5×.
  assert.ok(
    lowDelta / highDelta > 1.5,
    `ratio low/high (${(lowDelta / highDelta).toFixed(2)}) should exceed 1.5`,
  );
});

test("sigmoid: at the setpoint, +1 event moves display by ~0.5 (logistic growth)", () => {
  const SIG: SliderConfig = { ...SIGMOID, eventScale: 1 };
  const at5 = sliderFromDisplay(5, SIG);
  const after = display(applyEvent(at5, 1, SIG));
  // headroom 5/10 = 0.5; eventScale 1 → +0.5 display
  close(after, 5.5, 0.001);
});

test("sigmoid: many small events asymptote but never reach the bound", () => {
  let s = sliderFromDisplay(5, SIGMOID);
  for (let i = 0; i < 1000; i++) s = applyEvent(s, 1, SIGMOID);
  assert.ok(display(s) < 10);
  assert.ok(display(s) > 9.9);
});

test("linear mode: +1 always moves display by +1, clamped open", () => {
  const s = sliderFromDisplay(5, LINEAR);
  close(display(applyEvent(s, 1, LINEAR)), 6);
  close(display(applyEvent(s, 4.999, LINEAR)), 9.999);
  assert.ok(display(applyEvent(s, 100, LINEAR)) < 10);
});

test("tolerance: high-side bumps setpoint up", () => {
  let s = makeSlider(SIGMOID);
  close(setpointDisplay(s), 5);
  s = incrementTolerance(s, "high", SIGMOID);
  assert.equal(s.tolerance, 1);
  assert.ok(setpointDisplay(s) > 5);
});

test("tolerance: low-side bumps setpoint down", () => {
  let s = makeSlider(SIGMOID);
  s = incrementTolerance(s, "low", SIGMOID);
  assert.equal(s.tolerance, -1);
  assert.ok(setpointDisplay(s) < 5);
});

test("tolerance caps at toleranceMax", () => {
  let s = makeSlider(SIGMOID);
  for (let i = 0; i < 100; i++) s = incrementTolerance(s, "high", SIGMOID);
  assert.equal(s.tolerance, SIGMOID.toleranceMax);
});

test("tolerance is locked when toleranceStep=0 (personality-style)", () => {
  let s = makeSlider(DEFAULT_SLIDER_CONFIG);
  s = incrementTolerance(s, "high", DEFAULT_SLIDER_CONFIG);
  close(setpointDisplay(s), 5);
  assert.equal(s.tolerance, 0);
});

test("distanceFromSetpoint is signed and respects mobile setpoint", () => {
  const at3 = sliderFromDisplay(3, SIGMOID);
  close(distanceFromSetpoint(at3), -2);
});

test("after tolerance rises, the same Fuel reads as more depleted", () => {
  const at5 = sliderFromDisplay(5, SIGMOID);
  close(distanceFromSetpoint(at5), 0);
  // Push tolerance up; value unchanged but setpoint moved.
  const sameValue = incrementTolerance(at5, "high", SIGMOID);
  assert.ok(distanceFromSetpoint(sameValue) < 0);
});
