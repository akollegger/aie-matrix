import { describe, expect, it } from "vitest";
import { steerByAnimal, type AnimalSteerRequest } from "./animal-bias.js";

function req(over: Partial<AnimalSteerRequest> = {}): AnimalSteerRequest {
  return {
    animal: over.animal,
    schoolRecommendation: over.schoolRecommendation ?? "call",
    equityMargin: over.equityMargin ?? 0,
    canRaise: over.canRaise ?? true,
    canCall: over.canCall ?? true,
    canFold: over.canFold ?? true,
    canCheck: over.canCheck ?? false,
  };
}

describe("steerByAnimal", () => {
  describe("Lion", () => {
    it("escalates a school 'call' to 'raise' on a playable spot", () => {
      const s = steerByAnimal(req({
        animal: "lion",
        schoolRecommendation: "call",
        equityMargin: 0.05,
      }));
      expect(s.preferred).toBe("raise");
      expect(s.diverged).toBe(true);
    });

    it("doesn't add a raise that isn't legal", () => {
      const s = steerByAnimal(req({
        animal: "lion",
        schoolRecommendation: "call",
        equityMargin: 0.05,
        canRaise: false,
      }));
      expect(s.preferred).toBe("call");
      expect(s.diverged).toBe(false);
    });

    it("respects the school when it's already raising", () => {
      const s = steerByAnimal(req({
        animal: "lion",
        schoolRecommendation: "raise",
        equityMargin: 0.3,
      }));
      expect(s.preferred).toBe("raise");
      expect(s.diverged).toBe(false);
    });
  });

  describe("Jackal", () => {
    it("turns a 'fold' into a 'raise' when the margin is only slightly negative", () => {
      const s = steerByAnimal(req({
        animal: "jackal",
        schoolRecommendation: "fold",
        equityMargin: -0.07,
      }));
      expect(s.preferred).toBe("raise");
      expect(s.diverged).toBe(true);
    });

    it("doesn't bluff a heavily-dominated spot", () => {
      const s = steerByAnimal(req({
        animal: "jackal",
        schoolRecommendation: "fold",
        equityMargin: -0.4,
      }));
      expect(s.preferred).toBe("fold");
      expect(s.diverged).toBe(false);
    });
  });

  describe("Mouse", () => {
    it("folds a coin-flip-call instead of paying off", () => {
      const s = steerByAnimal(req({
        animal: "mouse",
        schoolRecommendation: "call",
        equityMargin: 0.03,
      }));
      expect(s.preferred).toBe("fold");
      expect(s.diverged).toBe(true);
    });

    it("doesn't fold a clear value-call (margin > 10%)", () => {
      const s = steerByAnimal(req({
        animal: "mouse",
        schoolRecommendation: "call",
        equityMargin: 0.18,
      }));
      expect(s.preferred).toBe("call");
      expect(s.diverged).toBe(false);
    });

    it("downshifts a marginal-edge raise on a free street to check", () => {
      const s = steerByAnimal(req({
        animal: "mouse",
        schoolRecommendation: "raise",
        equityMargin: 0.05,
        canCheck: true,
      }));
      expect(s.preferred).toBe("check");
      expect(s.diverged).toBe(true);
    });
  });

  describe("Elephant", () => {
    it("calls instead of folding when calling is legal and equity isn't dire", () => {
      const s = steerByAnimal(req({
        animal: "elephant",
        schoolRecommendation: "fold",
        equityMargin: -0.08,
      }));
      expect(s.preferred).toBe("call");
      expect(s.diverged).toBe(true);
    });

    it("still folds when equity is truly hopeless (margin < -20%)", () => {
      const s = steerByAnimal(req({
        animal: "elephant",
        schoolRecommendation: "fold",
        equityMargin: -0.25,
      }));
      expect(s.preferred).toBe("fold");
      expect(s.diverged).toBe(false);
    });

    it("downshifts a coin-flip raise to a call", () => {
      const s = steerByAnimal(req({
        animal: "elephant",
        schoolRecommendation: "raise",
        equityMargin: 0.02,
      }));
      expect(s.preferred).toBe("call");
      expect(s.diverged).toBe(true);
    });
  });

  describe("Eagle / undefined", () => {
    it("eagle defers to school", () => {
      const s = steerByAnimal(req({
        animal: "eagle",
        schoolRecommendation: "call",
        equityMargin: 0.05,
      }));
      expect(s.preferred).toBe("call");
      expect(s.diverged).toBe(false);
    });

    it("undefined animal is no-op", () => {
      const s = steerByAnimal(req({
        animal: undefined,
        schoolRecommendation: "raise",
        equityMargin: 0.1,
      }));
      expect(s.preferred).toBe("raise");
      expect(s.diverged).toBe(false);
    });
  });
});

describe("steerByAnimal — temperament divergence on identical spots", () => {
  it("same spot, four different animals → different preferred actions", () => {
    const spot = (animal: AnimalSteerRequest["animal"]) =>
      steerByAnimal(req({
        animal,
        schoolRecommendation: "call",
        equityMargin: 0.04, // close-but-positive
      })).preferred;

    // Lion: escalates to raise. Jackal: also raises (call → raise path).
    // Mouse: folds (coin-flip-fold). Elephant: stays on call (school rec already call).
    expect(spot("lion")).toBe("raise");
    expect(spot("jackal")).toBe("raise");
    expect(spot("mouse")).toBe("fold");
    expect(spot("elephant")).toBe("call");
  });
});
