import { describe, expect, test } from "vitest";
import {
  fromDisplay,
  midpointPersonality,
  samplePersonality,
  STARTER_FACETS,
  type FacetName,
  type PersonalityState,
  type SliderValue,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

import {
  assignMathSchool,
  MATH_SCHOOLS,
  SCHOOL_FLAVOR_NAMES,
  type MathSchool,
} from "./math-schools.js";

/** Build a personality from `(facet, axis) → display 0..10` overrides. */
function makePersonality(
  overrides: Partial<Record<FacetName, { internal?: number; external?: number }>>,
): PersonalityState {
  const base = midpointPersonality() as Record<FacetName, TraitState>;
  const out = { ...base };
  for (const facet of STARTER_FACETS) {
    const o = overrides[facet];
    if (!o) continue;
    const cur = base[facet];
    const internal: SliderValue =
      o.internal !== undefined ? fromDisplay(o.internal) : cur.internal;
    const external: SliderValue =
      o.external !== undefined ? fromDisplay(o.external) : cur.external;
    out[facet] = { internal, external };
  }
  return out as PersonalityState;
}

describe("assignMathSchool", () => {
  test("returns one of the seven schools for any input", () => {
    const p = samplePersonality({ seed: 12345 });
    const school = assignMathSchool(p);
    expect(MATH_SCHOOLS).toContain(school);
  });

  test("is deterministic — same input → same output", () => {
    const p = samplePersonality({ seed: 7 });
    const a = assignMathSchool(p);
    const b = assignMathSchool(p);
    expect(a).toBe(b);
  });

  test("every school has a flavour name", () => {
    for (const s of MATH_SCHOOLS) {
      expect(SCHOOL_FLAVOR_NAMES[s]).toMatch(/\S/);
    }
  });

  test.each<[MathSchool, Partial<Record<FacetName, { internal?: number; external?: number }>>]>([
    [
      "Sklansky",
      { Deliberation: { internal: 9 }, Trust: { external: 8 }, Assertiveness: { external: 1 } },
    ],
    [
      "Chen",
      { Deliberation: { internal: 9 }, Ideas: { internal: 1 } },
    ],
    [
      "Harrington",
      {
        Stability: { internal: 9 },
        Assertiveness: { external: 8 },
        "Self-Monitoring": { internal: 8 },
      },
    ],
    [
      "Exploitative",
      { Ideas: { internal: 9 }, Assertiveness: { external: 9 }, Altruism: { internal: 1 } },
    ],
    [
      "ICM",
      { Stability: { internal: 9 }, Assertiveness: { internal: 1 }, "Self-Monitoring": { internal: 7 } },
    ],
    [
      "Hellmuth",
      {
        Warmth: { external: 9 },
        Assertiveness: { external: 9 },
        "Self-Monitoring": { internal: 8 },
        Ideas: { internal: 7 },
      },
    ],
  ])("personality archetype → %s", (expected, profile) => {
    expect(assignMathSchool(makePersonality(profile))).toBe(expected);
  });

  test("midpoint personality assigns deterministically (no random tie-break)", () => {
    const m = midpointPersonality();
    // First, just check it doesn't throw and picks a real school.
    const s = assignMathSchool(m);
    expect(MATH_SCHOOLS).toContain(s);
    // Insertion-order tie-break — all scores 0 at midpoint, so first wins.
    expect(s).toBe("Sklansky");
  });
});
