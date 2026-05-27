import { describe, expect, it } from "vitest";
import type { AvailableActions } from "@aie-matrix/ghost-rdc-poker";

import { generateCandidates } from "./candidate-generator.js";
import type { SchoolPlay } from "./school-rules.js";

function fullMenu(over: Partial<AvailableActions> = {}): AvailableActions {
  return {
    canFold: over.canFold ?? true,
    canCheck: over.canCheck ?? false,
    canCall: over.canCall ?? true,
    canRaise: over.canRaise ?? true,
    canAllIn: over.canAllIn ?? true,
    callAmount: over.callAmount ?? 10,
    minRaise: over.minRaise ?? 20,
    maxRaise: over.maxRaise ?? 200,
    allInAmount: over.allInAmount ?? 200,
  };
}

describe("generateCandidates — universal invariants", () => {
  it("always returns exactly 3 candidates with letters A/B/C", () => {
    const set = generateCandidates({
      optimal: { action: "raise", amount: 60 },
      available: fullMenu(),
      tier: "Veteran",
      seed: 1,
    });
    expect(set.candidates.length).toBe(3);
    expect(set.candidates.map((c) => c.letter)).toEqual(["A", "B", "C"]);
  });

  it("nearestOptimalIndex is always 0/1/2", () => {
    const set = generateCandidates({
      optimal: { action: "call", amount: 10 },
      available: fullMenu(),
      tier: "Greenhorn",
      seed: 5,
    });
    expect([0, 1, 2]).toContain(set.nearestOptimalIndex);
  });

  it("amounts are clamped to legal range for raises", () => {
    const set = generateCandidates({
      optimal: { action: "raise", amount: 500 }, // way above maxRaise
      available: fullMenu({ minRaise: 20, maxRaise: 100 }),
      tier: "Veteran",
      seed: 1,
    });
    for (const c of set.candidates) {
      if (c.action === "raise") {
        expect(c.amount).toBeGreaterThanOrEqual(20);
        expect(c.amount).toBeLessThanOrEqual(100);
      }
    }
  });

  it("never produces an illegal action", () => {
    // Menu where raise is NOT legal (e.g. someone is all-in already);
    // Greenhorn would normally pick a wild "all-in" candidate.
    const set = generateCandidates({
      optimal: { action: "call", amount: 10 },
      available: fullMenu({ canRaise: false, canAllIn: false }),
      tier: "Greenhorn",
      seed: 3,
    });
    for (const c of set.candidates) {
      // canFold/canCall/canCheck should be the only ones picked.
      expect(["fold", "check", "call"]).toContain(c.action);
    }
  });

  it("same seed → same letter assignment (deterministic)", () => {
    const args = {
      optimal: { action: "raise" as const, amount: 60 },
      available: fullMenu(),
      tier: "Veteran" as const,
      seed: 42,
    };
    const a = generateCandidates(args);
    const b = generateCandidates(args);
    expect(a.candidates.map((c) => `${c.action}:${c.amount}`)).toEqual(
      b.candidates.map((c) => `${c.action}:${c.amount}`),
    );
  });
});

describe("Veteran — optimal IS on the menu, close-clustered options", () => {
  it("optimal raise is present at nearestOptimalIndex", () => {
    const optimal: SchoolPlay = { action: "raise", amount: 60 };
    const set = generateCandidates({ optimal, available: fullMenu(), tier: "Veteran", seed: 1 });
    const best = set.candidates[set.nearestOptimalIndex]!;
    expect(best.action).toBe("raise");
    expect(best.amount).toBe(60);
  });

  it("optimal fold is on the menu", () => {
    const set = generateCandidates({
      optimal: { action: "fold", amount: 0 },
      available: fullMenu(),
      tier: "Veteran",
      seed: 1,
    });
    const best = set.candidates[set.nearestOptimalIndex]!;
    expect(best.action).toBe("fold");
  });

  it("all three candidates are reasonable (no all-in or jam in tight spot)", () => {
    const set = generateCandidates({
      optimal: { action: "call", amount: 10 },
      available: fullMenu(),
      tier: "Veteran",
      seed: 1,
    });
    // Veteran shouldn't be jamming on a call spot.
    expect(set.candidates.some((c) => c.action === "all-in")).toBe(false);
  });
});

describe("Greenhorn — optimal is NOT on the menu; the menu is amateur", () => {
  it("when school says raise 60, noob's best candidate is min-raise (right action, wrong size)", () => {
    const optimal: SchoolPlay = { action: "raise", amount: 60 };
    const menu = fullMenu({ minRaise: 20 });
    const set = generateCandidates({ optimal, available: menu, tier: "Greenhorn", seed: 1 });
    const best = set.candidates[set.nearestOptimalIndex]!;
    expect(best.action).toBe("raise");
    expect(best.amount).toBe(20); // min-raise, NOT 60 (the true optimal)
    // The actual optimal (raise to 60) should NOT be one of the three.
    expect(
      set.candidates.find((c) => c.action === "raise" && c.amount === 60),
    ).toBeUndefined();
  });

  it("when school says fold, noob's wild candidate may be all-in (the yolo)", () => {
    const set = generateCandidates({
      optimal: { action: "fold", amount: 0 },
      available: fullMenu(),
      tier: "Greenhorn",
      seed: 1,
    });
    // Wild card slot: should include either all-in or a max-raise.
    const wild = set.candidates.find(
      (c) => c.action === "all-in" || (c.action === "raise" && c.amount >= 100),
    );
    expect(wild).toBeDefined();
  });

  it("noob options span the full amateur range (passive + wild are both present)", () => {
    const set = generateCandidates({
      optimal: { action: "raise", amount: 60 },
      available: fullMenu(),
      tier: "Greenhorn",
      seed: 1,
    });
    const actions = set.candidates.map((c) => c.action);
    // Greenhorn raise-spot menu: amateur-raise (min), opposite (fold), wild (jam).
    expect(actions).toContain("fold");
    // Either raise or all-in for the wild slot.
    expect(actions.some((a) => a === "raise" || a === "all-in")).toBe(true);
  });
});

describe("Journeyman — one near-correct, two distractors", () => {
  it("right-action wrong-sizing variant is on the menu when optimal is raise", () => {
    const optimal: SchoolPlay = { action: "raise", amount: 60 };
    const set = generateCandidates({
      optimal,
      available: fullMenu(),
      tier: "Journeyman",
      seed: 1,
    });
    // The nearest-optimal IS a raise but at WRONG sizing (around half).
    const best = set.candidates[set.nearestOptimalIndex]!;
    expect(best.action).toBe("raise");
    expect(best.amount).not.toBe(60); // sizing warped
    expect(best.amount).toBeLessThan(60); // under-sized (journeyman tell)
  });

  it("includes a passive distractor when optimal is raise", () => {
    const set = generateCandidates({
      optimal: { action: "raise", amount: 60 },
      available: fullMenu(),
      tier: "Journeyman",
      seed: 1,
    });
    const passive = set.candidates.find((c) => c.action === "call" || c.action === "check" || c.action === "fold");
    expect(passive).toBeDefined();
  });
});

describe("Eagle — optimal PLUS exploit lines", () => {
  it("optimal IS on the menu", () => {
    const optimal: SchoolPlay = { action: "raise", amount: 60 };
    const set = generateCandidates({
      optimal,
      available: fullMenu(),
      tier: "Eagle",
      seed: 1,
    });
    const best = set.candidates[set.nearestOptimalIndex]!;
    expect(best.action).toBe("raise");
    expect(best.amount).toBe(60);
  });

  it("includes an exploit/mix-frequency candidate when optimal is fold (the deliberate bluff)", () => {
    const set = generateCandidates({
      optimal: { action: "fold", amount: 0 },
      available: fullMenu(),
      tier: "Eagle",
      seed: 1,
    });
    // Eagle on a fold spot should be offered some kind of NON-fold
    // exploit option (bluff, peel, etc.).
    const nonFold = set.candidates.find((c) => c.action !== "fold");
    expect(nonFold).toBeDefined();
  });
});

describe("The user's flagship divergence test", () => {
  it("same optimal (raise to 60), three different tiers → three different menus", () => {
    const optimal: SchoolPlay = { action: "raise", amount: 60 };
    const menu = fullMenu();
    const vet = generateCandidates({ optimal, available: menu, tier: "Veteran", seed: 7 });
    const jour = generateCandidates({ optimal, available: menu, tier: "Journeyman", seed: 7 });
    const noob = generateCandidates({ optimal, available: menu, tier: "Greenhorn", seed: 7 });

    // Vet has raise@60 on the menu (the optimal).
    expect(vet.candidates.some((c) => c.action === "raise" && c.amount === 60)).toBe(true);
    // Journeyman does NOT have raise@60 (under-sized).
    expect(jour.candidates.some((c) => c.action === "raise" && c.amount === 60)).toBe(false);
    // Noob does NOT have raise@60 (way under-sized to min-raise).
    expect(noob.candidates.some((c) => c.action === "raise" && c.amount === 60)).toBe(false);
  });
});
