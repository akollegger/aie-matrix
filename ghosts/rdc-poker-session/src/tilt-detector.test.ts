import { describe, expect, it } from "vitest";
import { computeTilt, type TiltInputs } from "./tilt-detector.js";

function inputs(over: Partial<TiltInputs> = {}): TiltInputs {
  return {
    recentOutcomes: over.recentOutcomes ?? [],
    myChips: over.myChips ?? 100,
    tableChips: over.tableChips ?? 600,
    seatCount: over.seatCount ?? 6,
    tiltSusceptibility: over.tiltSusceptibility ?? 0.5,
  };
}

describe("computeTilt — baseline", () => {
  it("no history, average stack, 50% susceptibility → zero pressure", () => {
    const r = computeTilt(inputs());
    expect(r.lossRate).toBe(0);
    expect(r.chipStress).toBe(0);
    expect(r.rawPressure).toBe(0);
    expect(r.effective).toBe(0);
    expect(r.shouldEnter).toBe(false);
  });
});

describe("computeTilt — losing streak", () => {
  it("3 of 5 losses → lossRate 0.6 → pressure 0.36 → effective 0.18 at 50%", () => {
    const r = computeTilt(
      inputs({ recentOutcomes: ["loss", "loss", "win", "loss", "win"] }),
    );
    expect(r.lossRate).toBeCloseTo(0.6, 4);
    expect(r.rawPressure).toBeCloseTo(0.36, 4);
    expect(r.effective).toBeCloseTo(0.18, 4);
    // Effective is 0.18, below 0.40 enter threshold.
    expect(r.shouldEnter).toBe(false);
  });

  it("5/5 losses + high susceptibility → enters tilt", () => {
    const r = computeTilt(
      inputs({
        recentOutcomes: ["loss", "loss", "loss", "loss", "loss"],
        tiltSusceptibility: 0.9,
      }),
    );
    expect(r.lossRate).toBe(1);
    expect(r.effective).toBeGreaterThan(0.4);
    expect(r.shouldEnter).toBe(true);
  });

  it("5/5 losses + LOW susceptibility (Mouse) → still below enter threshold", () => {
    // tiltSusceptibility 0.3 × pressure 0.6 = effective 0.18 — Mouse
    // shrugs off a losing streak.
    const r = computeTilt(
      inputs({
        recentOutcomes: ["loss", "loss", "loss", "loss", "loss"],
        tiltSusceptibility: 0.3,
        myChips: 100, // average — no chip stress
        tableChips: 600,
        seatCount: 6,
      }),
    );
    expect(r.shouldEnter).toBe(false);
  });
});

describe("computeTilt — chip stress", () => {
  it("short stack vs average → positive chip stress", () => {
    // Mean share = 1/6 ≈ 0.167. My share = 30/600 = 0.05 → stress = (0.167-0.05)/0.167 ≈ 0.70
    const r = computeTilt(
      inputs({
        myChips: 30,
        tableChips: 600,
        seatCount: 6,
      }),
    );
    expect(r.chipStress).toBeCloseTo(0.7, 1);
    expect(r.rawPressure).toBeCloseTo(0.28, 1); // 0.4 × 0.7
  });

  it("chip leader gets zero chip stress (never tilted from leading)", () => {
    const r = computeTilt(
      inputs({
        myChips: 500,
        tableChips: 600,
        seatCount: 6,
      }),
    );
    expect(r.chipStress).toBe(0);
  });
});

describe("computeTilt — combined: losses + short stack tilt fast", () => {
  it("losing streak + short stack + high susceptibility → strong enter signal", () => {
    const r = computeTilt(
      inputs({
        recentOutcomes: ["loss", "loss", "loss", "loss", "loss"],
        myChips: 30,
        tableChips: 600,
        seatCount: 6,
        tiltSusceptibility: 0.8,
      }),
    );
    expect(r.shouldEnter).toBe(true);
    expect(r.effective).toBeGreaterThan(0.6);
  });
});

describe("computeTilt — hysteresis", () => {
  it("between enter and exit (0.2 < effective ≤ 0.4) → neither flag fires", () => {
    // pressure 0.3, susceptibility 1.0 → effective 0.3 — middle zone.
    const r = computeTilt(
      inputs({
        recentOutcomes: ["loss", "loss", "win", "win", "win"],
        myChips: 60, // small stress
        tableChips: 600,
        seatCount: 6,
        tiltSusceptibility: 1.0,
      }),
    );
    expect(r.shouldEnter).toBe(false);
    expect(r.shouldExit).toBe(false);
  });

  it("clear winning streak + decent stack → exit threshold met", () => {
    const r = computeTilt(
      inputs({
        recentOutcomes: ["win", "win", "win", "win", "win"],
        myChips: 200,
        tableChips: 600,
        seatCount: 6,
        tiltSusceptibility: 0.5,
      }),
    );
    expect(r.shouldExit).toBe(true);
    expect(r.shouldEnter).toBe(false);
  });
});

describe("computeTilt — degenerate inputs", () => {
  it("zero tableChips returns 0 chip stress (avoid divide-by-zero)", () => {
    const r = computeTilt(inputs({ myChips: 0, tableChips: 0, seatCount: 6 }));
    expect(r.chipStress).toBe(0);
  });

  it("zero seatCount returns 0 chip stress (defensive)", () => {
    const r = computeTilt(inputs({ seatCount: 0 }));
    expect(r.chipStress).toBe(0);
  });

  it("effective is clamped to [0, 1]", () => {
    const r = computeTilt(
      inputs({
        recentOutcomes: ["loss", "loss", "loss", "loss", "loss"],
        myChips: 0,
        tableChips: 600,
        seatCount: 6,
        tiltSusceptibility: 1.0,
      }),
    );
    expect(r.effective).toBeLessThanOrEqual(1);
    expect(r.effective).toBeGreaterThanOrEqual(0);
  });
});
