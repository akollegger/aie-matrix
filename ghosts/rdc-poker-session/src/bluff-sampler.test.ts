import { describe, expect, it } from "vitest";
import { sampleBluff, type BluffRequest } from "./bluff-sampler.js";

function req(over: Partial<BluffRequest> = {}): BluffRequest {
  // Use 'in' check so explicit `tier: undefined` overrides the Eagle
  // default; `??` would coerce undefined back to Eagle and made the
  // "tier=undefined" assertion flaky.
  return {
    tier: "tier" in over ? over.tier : "Eagle",
    bluffFrequency: over.bluffFrequency ?? 0.3,
    equity: over.equity ?? 0.3,
    phase: over.phase ?? "river",
    foldEquity: over.foldEquity ?? 0.6,
    canRaise: over.canRaise ?? true,
    rng: over.rng,
  };
}

describe("sampleBluff — gate checks", () => {
  it("does not fire for tier < Eagle", () => {
    expect(sampleBluff(req({ tier: "Veteran" })).bluff).toBe(false);
    expect(sampleBluff(req({ tier: "Journeyman" })).bluff).toBe(false);
    expect(sampleBluff(req({ tier: "Greenhorn" })).bluff).toBe(false);
    expect(sampleBluff(req({ tier: undefined })).bluff).toBe(false);
  });

  it("does not fire when raise isn't legal", () => {
    const s = sampleBluff(req({ canRaise: false, rng: () => 0 }));
    expect(s.bluff).toBe(false);
    expect(s.reason).toMatch(/raise isn't legal/);
  });

  it("does not fire preflop or on the flop in v1", () => {
    expect(sampleBluff(req({ phase: "pre-flop", rng: () => 0 })).bluff).toBe(false);
    expect(sampleBluff(req({ phase: "flop", rng: () => 0 })).bluff).toBe(false);
  });

  it("does not fire when equity is value (≥ 50%)", () => {
    const s = sampleBluff(req({ equity: 0.6, rng: () => 0 }));
    expect(s.bluff).toBe(false);
    expect(s.reason).toMatch(/value/);
  });

  it("does not fire when fold equity is too low (< 35%)", () => {
    const s = sampleBluff(req({ foldEquity: 0.2, rng: () => 0 }));
    expect(s.bluff).toBe(false);
    expect(s.reason).toMatch(/fold equity/);
  });
});

describe("sampleBluff — probability arithmetic", () => {
  it("probability = bluffFrequency * foldEquity", () => {
    const s = sampleBluff(req({
      bluffFrequency: 0.3,
      foldEquity: 0.6,
      rng: () => 0.99, // won't fire
    }));
    expect(s.probability).toBeCloseTo(0.18, 4);
  });

  it("fires when rng < probability", () => {
    const s = sampleBluff(req({
      bluffFrequency: 0.5,
      foldEquity: 0.8,
      rng: () => 0.1, // 10% << 40% prob
    }));
    expect(s.bluff).toBe(true);
    expect(s.forcedAction).toBe("raise");
  });

  it("declines when rng ≥ probability", () => {
    const s = sampleBluff(req({
      bluffFrequency: 0.5,
      foldEquity: 0.8,
      rng: () => 0.99,
    }));
    expect(s.bluff).toBe(false);
    expect(s.forcedAction).toBeNull();
  });
});

describe("sampleBluff — distribution sanity", () => {
  it("over many trials, frequency approximates target", () => {
    // Lion (50% bluffFrequency) on a board with 60% fold equity →
    // expected fire rate = 30%. With 10k trials of a deterministic
    // sequence we should land close.
    let i = 0;
    // Deterministic uniform-ish sequence using a mulberry32-style PRNG.
    let s = 1234;
    const rng = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let fired = 0;
    const N = 10000;
    for (i = 0; i < N; i++) {
      const r = sampleBluff(req({
        bluffFrequency: 0.5,
        foldEquity: 0.6,
        rng,
      }));
      if (r.bluff) fired++;
    }
    const rate = fired / N;
    // Expected 0.30; ±3% is plenty of room.
    expect(rate).toBeGreaterThan(0.27);
    expect(rate).toBeLessThan(0.33);
  });
});
