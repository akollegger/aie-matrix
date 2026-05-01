import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY_MAX,
  DISPLAY_MIDPOINT,
  DISPLAY_MIN,
  STARTER_FACETS,
  midpointPersonality,
  samplePersonality,
  type FacetName,
} from "./facets.js";
import { toDisplay } from "./sliders.js";

test("STARTER_FACETS contains the 8 v1-active facets", () => {
  assert.equal(STARTER_FACETS.length, 8);
  const set = new Set<FacetName>(STARTER_FACETS);
  assert.equal(set.size, 8, "facet names are unique");
  for (const expected of [
    "Ideas",
    "Deliberation",
    "Assertiveness",
    "Warmth",
    "Trust",
    "Altruism",
    "Stability",
    "Self-Monitoring",
  ] as const) {
    assert.ok(set.has(expected), `missing facet ${expected}`);
  }
});

test("midpointPersonality puts every facet at (5, 5) display", () => {
  const p = midpointPersonality();
  for (const facet of STARTER_FACETS) {
    const t = p[facet];
    assert.ok(
      Math.abs(toDisplay(t.internal) - DISPLAY_MIDPOINT) < 1e-9,
      `internal ${facet} should be midpoint`,
    );
    assert.ok(
      Math.abs(toDisplay(t.external) - DISPLAY_MIDPOINT) < 1e-9,
      `external ${facet} should be midpoint`,
    );
  }
});

test("samplePersonality is deterministic given the same seed", () => {
  const a = samplePersonality({ seed: 42 });
  const b = samplePersonality({ seed: 42 });
  for (const facet of STARTER_FACETS) {
    assert.equal(a[facet].internal.logit, b[facet].internal.logit);
    assert.equal(a[facet].external.logit, b[facet].external.logit);
  }
});

test("samplePersonality produces different ghosts for different seeds", () => {
  const a = samplePersonality({ seed: 1 });
  const b = samplePersonality({ seed: 2 });
  let anyDifferent = false;
  for (const facet of STARTER_FACETS) {
    if (
      a[facet].internal.logit !== b[facet].internal.logit ||
      a[facet].external.logit !== b[facet].external.logit
    ) {
      anyDifferent = true;
      break;
    }
  }
  assert.ok(anyDifferent, "different seeds should produce at least one different slider");
});

test("samplePersonality yields values strictly inside the display range", () => {
  const p = samplePersonality({ seed: 12345, stddev: 3.0 });
  for (const facet of STARTER_FACETS) {
    const inDisplay = toDisplay(p[facet].internal);
    const exDisplay = toDisplay(p[facet].external);
    assert.ok(inDisplay > DISPLAY_MIN && inDisplay < DISPLAY_MAX);
    assert.ok(exDisplay > DISPLAY_MIN && exDisplay < DISPLAY_MAX);
  }
});

test("samplePersonality rejects non-positive or non-finite stddev", () => {
  assert.throws(() => samplePersonality({ seed: 0, stddev: 0 }), RangeError);
  assert.throws(() => samplePersonality({ seed: 0, stddev: -1 }), RangeError);
  assert.throws(() => samplePersonality({ seed: 0, stddev: Number.NaN }), RangeError);
});

test("samplePersonality has independent internal and external per facet", () => {
  // At stddev 1.5, a single facet's Internal and External being bit-
  // identical would be vanishingly unlikely. Verify they're not equal
  // across a full-sampled personality.
  const p = samplePersonality({ seed: 777, stddev: 1.5 });
  let anyIndependent = false;
  for (const facet of STARTER_FACETS) {
    if (p[facet].internal.logit !== p[facet].external.logit) {
      anyIndependent = true;
      break;
    }
  }
  assert.ok(anyIndependent, "internal and external axes should be sampled independently");
});
