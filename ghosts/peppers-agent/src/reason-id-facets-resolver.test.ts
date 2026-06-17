/**
 * Unit tests for the mechanical (felt, projected) → prose resolver.
 *
 * Verifies binning boundaries, character-anchored axis resolution,
 * presence of compound archetypes at the dramatic corners, absence at
 * mid-cells (where composition carries the meaning), mask description
 * scaling with gap magnitude and direction, character-list formatting,
 * and loud failure for unauthored facets.
 */
import { describe, expect, it } from "vitest";

import { fromDisplay, type PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import {
  binLevel3,
  formatCharacterList,
  hasFacetData,
  resolveFacetExpression,
  type CharacterRef,
} from "./reason-id-facets-resolver.js";

import type { FacetName } from "@aie-matrix/ghost-peppers-inner";

const ALL_FACETS: ReadonlyArray<FacetName> = [
  "Ideas",
  "Deliberation",
  "Assertiveness",
  "Warmth",
  "Trust",
  "Altruism",
  "Stability",
  "Self-Monitoring",
];

/** Build a PersonalityState where every facet has the given (felt, projected). */
function makeState(felt: number, projected: number): PersonalityState {
  const trait = { internal: fromDisplay(felt), external: fromDisplay(projected) };
  return {
    Ideas: trait,
    Deliberation: trait,
    Assertiveness: trait,
    Warmth: trait,
    Trust: trait,
    Altruism: trait,
    Stability: trait,
    "Self-Monitoring": trait,
  };
}

describe("binLevel3", () => {
  it("bins display values into low/mid/high at 3.5 and 6.5", () => {
    expect(binLevel3(0.01)).toBe("low");
    expect(binLevel3(3.49)).toBe("low");
    expect(binLevel3(3.5)).toBe("mid");
    expect(binLevel3(5)).toBe("mid");
    expect(binLevel3(6.5)).toBe("mid");
    expect(binLevel3(6.51)).toBe("high");
    expect(binLevel3(9.99)).toBe("high");
  });
});

describe("formatCharacterList", () => {
  const c = (name: string): CharacterRef => ({ name, note: "" });

  it("one character: 'like X'", () => {
    expect(formatCharacterList([c("Tony Stark")])).toBe("like Tony Stark");
  });
  it("two characters: 'like X and Y'", () => {
    expect(formatCharacterList([c("Tony Stark"), c("Doc Brown")])).toBe(
      "like Tony Stark and Doc Brown",
    );
  });
  it("three characters: 'like X, Y, even a little Z'", () => {
    expect(formatCharacterList([c("Tony Stark"), c("Doc Brown"), c("Del Boy")])).toBe(
      "like Tony Stark, Doc Brown, even a little Del Boy",
    );
  });
  it("empty list returns empty string", () => {
    expect(formatCharacterList([])).toBe("");
  });
});

describe("resolveFacetExpression — Stability corners", () => {
  it("(low, low) → manic pixie compound, plus chaos chars on both axes", () => {
    const r = resolveFacetExpression("Stability", makeState(1, 1));
    expect(r.compoundArchetype?.name).toBe("the manic pixie");
    expect(r.feltCharacters.map((c) => c.name)).toContain("Jesse Pinkman (Breaking Bad)");
    expect(r.projectedCharacters.map((c) => c.name)).toContain("Jack Sparrow");
  });

  it("(low, high) → Walter White compound (Mr. Chips becomes Scarface inverted)", () => {
    const r = resolveFacetExpression("Stability", makeState(2, 8));
    expect(r.compoundArchetype?.name).toBe("the Walter White");
    expect(r.compoundArchetype?.description).toMatch(/Jesse Pinkman.*Mr\. Chips/);
    expect(r.feltSummary).toMatch(/unstable inside/);
    expect(r.projectedSummary).toMatch(/calm and unaffected/);
  });

  it("(high, low) → rigid performer compound (autistic-mask-as-pixie / psychopath)", () => {
    const r = resolveFacetExpression("Stability", makeState(8, 2));
    expect(r.compoundArchetype?.name).toBe("the rigid performer");
    expect(r.feltCharacters.map((c) => c.name)).toContain("Atticus Finch");
    expect(r.projectedCharacters.map((c) => c.name)).toContain("Jack Sparrow");
  });

  it("(high, high) → Zen compound (felt + projected both calm)", () => {
    const r = resolveFacetExpression("Stability", makeState(9, 9));
    expect(r.compoundArchetype?.name).toBe("the Zen");
  });
});

describe("resolveFacetExpression — Stability mid-cells lack compound", () => {
  it("(mid, mid) emits no compound archetype (composition carries it)", () => {
    const r = resolveFacetExpression("Stability", makeState(5, 5));
    expect(r.compoundArchetype).toBeNull();
    expect(r.feltSummary).toMatch(/steady-enough/);
    expect(r.projectedSummary).toMatch(/ordinary/);
  });

  it("(mid, low) emits no compound", () => {
    const r = resolveFacetExpression("Stability", makeState(5, 1));
    expect(r.compoundArchetype).toBeNull();
  });

  it("(mid, high) emits no compound", () => {
    const r = resolveFacetExpression("Stability", makeState(5, 9));
    expect(r.compoundArchetype).toBeNull();
  });
});

describe("mask description", () => {
  it("aligned (|diff| < 1.5) → no mask in play", () => {
    const r = resolveFacetExpression("Stability", makeState(5, 5));
    expect(r.maskDescription).toMatch(/aligned/i);
    expect(r.maskDescription).toMatch(/no mask/i);
  });

  it("felt > projected, wide gap → hiding intensity behind restraint", () => {
    const r = resolveFacetExpression("Stability", makeState(9, 2));
    expect(r.maskDescription).toMatch(/wide gap/i);
    expect(r.maskDescription).toMatch(/more.*inside.*letting show/i);
  });

  it("projected > felt, wide gap → performing what isn't there", () => {
    const r = resolveFacetExpression("Stability", makeState(2, 9));
    expect(r.maskDescription).toMatch(/wide gap/i);
    expect(r.maskDescription).toMatch(/projecting much more.*than you actually feel/i);
  });

  it("mild gap fires its own template (not wide, not aligned)", () => {
    const r = resolveFacetExpression("Stability", makeState(6, 4));
    expect(r.maskDescription).toMatch(/mild gap/i);
  });
});

describe("character roster", () => {
  it("each Stability axis level has at least one character with a note", () => {
    const r = resolveFacetExpression("Stability", makeState(2, 8));
    expect(r.feltCharacters.length).toBeGreaterThan(0);
    expect(r.projectedCharacters.length).toBeGreaterThan(0);
    for (const c of r.feltCharacters) {
      expect(c.note.length).toBeGreaterThan(0);
    }
    for (const c of r.projectedCharacters) {
      expect(c.note.length).toBeGreaterThan(0);
    }
  });
});

describe("all eight facets are authored", () => {
  it("hasFacetData reports true for every facet", () => {
    for (const facet of ALL_FACETS) {
      expect(hasFacetData(facet)).toBe(true);
    }
  });

  it("resolveFacetExpression returns a populated FacetExpression for every facet", () => {
    for (const facet of ALL_FACETS) {
      const r = resolveFacetExpression(facet, makeState(5, 5));
      expect(r.feltCharacters.length).toBeGreaterThan(0);
      expect(r.projectedCharacters.length).toBeGreaterThan(0);
      expect(r.feltSummary.length).toBeGreaterThan(0);
      expect(r.projectedSummary.length).toBeGreaterThan(0);
      expect(r.maskDescription.length).toBeGreaterThan(0);
    }
  });

  it("every facet has a compound archetype at each of the four corners", () => {
    const corners: Array<[number, number]> = [
      [1, 1],
      [1, 9],
      [9, 1],
      [9, 9],
    ];
    for (const facet of ALL_FACETS) {
      for (const [felt, projected] of corners) {
        const r = resolveFacetExpression(facet, makeState(felt, projected));
        expect(
          r.compoundArchetype,
          `${facet} (${felt}, ${projected}) should have a compound`,
        ).not.toBeNull();
        expect(r.compoundArchetype?.name.length).toBeGreaterThan(0);
      }
    }
  });
});
