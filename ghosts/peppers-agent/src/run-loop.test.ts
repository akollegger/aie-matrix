import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELTA,
  STARTER_FACETS,
  applyDelta,
  midpointPersonality,
  toDisplay,
} from "@aie-matrix/ghost-peppers-inner";
import { applyAdjustmentsPerFacet } from "./run-loop.js";

const mid = midpointPersonality();

describe("applyAdjustmentsPerFacet", () => {
  it("returns unchanged state for empty adjustments", () => {
    const { state, applied } = applyAdjustmentsPerFacet(mid, []);
    expect(state).toEqual(mid);
    expect(applied).toHaveLength(0);
  });

  it("applies a single up adjustment to internal axis", () => {
    const { state, applied } = applyAdjustmentsPerFacet(mid, [
      { facet: "Ideas", axis: "internal", direction: "up" },
    ]);
    expect(state.Ideas.internal.logit).toBeGreaterThan(mid.Ideas.internal.logit);
    expect(state.Ideas.external.logit).toBe(mid.Ideas.external.logit);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.afterDisplay).toBeGreaterThan(applied[0]!.beforeDisplay);
  });

  it("applies a single down adjustment to external axis", () => {
    const { state, applied } = applyAdjustmentsPerFacet(mid, [
      { facet: "Warmth", axis: "external", direction: "down" },
    ]);
    expect(state.Warmth.external.logit).toBeLessThan(mid.Warmth.external.logit);
    expect(state.Warmth.internal.logit).toBe(mid.Warmth.internal.logit);
    expect(applied[0]!.afterDisplay).toBeLessThan(applied[0]!.beforeDisplay);
  });

  it("applies independent adjustments to different facets", () => {
    const { state } = applyAdjustmentsPerFacet(mid, [
      { facet: "Trust", axis: "internal", direction: "up" },
      { facet: "Stability", axis: "external", direction: "down" },
    ]);
    expect(state.Trust.internal.logit).toBeGreaterThan(mid.Trust.internal.logit);
    expect(state.Stability.external.logit).toBeLessThan(mid.Stability.external.logit);
    // Untouched facets unchanged
    expect(state.Ideas).toEqual(mid.Ideas);
  });

  it("leaves all other facets untouched", () => {
    const { state } = applyAdjustmentsPerFacet(mid, [
      { facet: "Assertiveness", axis: "internal", direction: "up" },
    ]);
    for (const facet of STARTER_FACETS) {
      if (facet === "Assertiveness") continue;
      expect(state[facet]).toEqual(mid[facet]);
    }
  });

  it("records beforeDisplay and afterDisplay in logit display units", () => {
    const { applied } = applyAdjustmentsPerFacet(mid, [
      { facet: "Deliberation", axis: "internal", direction: "up" },
    ]);
    const a = applied[0]!;
    const expectedBefore = toDisplay(mid.Deliberation.internal);
    const expectedAfter = toDisplay(applyDelta(mid.Deliberation.internal, "up", DEFAULT_DELTA));
    expect(a.beforeDisplay).toBeCloseTo(expectedBefore, 10);
    expect(a.afterDisplay).toBeCloseTo(expectedAfter, 10);
  });

  it("does not mutate the input state", () => {
    const original = JSON.stringify(mid);
    applyAdjustmentsPerFacet(mid, [{ facet: "Ideas", axis: "internal", direction: "up" }]);
    expect(JSON.stringify(mid)).toBe(original);
  });

  it("accumulates multiple adjustments to the same facet sequentially", () => {
    const { state } = applyAdjustmentsPerFacet(mid, [
      { facet: "Altruism", axis: "internal", direction: "up" },
      { facet: "Altruism", axis: "internal", direction: "up" },
    ]);
    // Two ups: state should be above a single up
    const { state: oneUp } = applyAdjustmentsPerFacet(mid, [
      { facet: "Altruism", axis: "internal", direction: "up" },
    ]);
    expect(state.Altruism.internal.logit).toBeGreaterThan(oneUp.Altruism.internal.logit);
  });
});
