import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "@aie-matrix/ghost-rdc-poker";
import { estimateEquity, potOdds } from "./equity-oracle.js";

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

// Equity benchmarks for these well-known heads-up matchups come from
// poker tools (pokerstove / equilab). 2000 samples ≈ ±1% so we allow
// a generous tolerance.
const TOL = 0.035; // ±3.5%

describe("estimateEquity — preflop heads-up benchmarks", () => {
  it("AA vs random heads-up ≈ 85%", () => {
    const r = estimateEquity({
      holeCards: [c("A", "spades"), c("A", "hearts")],
      communityCards: [],
      opponents: 1,
      samples: 3000,
      seed: 42,
    });
    expect(r.equity).toBeGreaterThan(0.85 - TOL);
    expect(r.equity).toBeLessThan(0.85 + TOL);
  });

  it("72 offsuit vs random heads-up ≈ 35%", () => {
    const r = estimateEquity({
      holeCards: [c("7", "spades"), c("2", "diamonds")],
      communityCards: [],
      opponents: 1,
      samples: 3000,
      seed: 7,
    });
    expect(r.equity).toBeGreaterThan(0.35 - TOL);
    expect(r.equity).toBeLessThan(0.35 + TOL);
  });

  it("A2 offsuit vs random heads-up ≈ 55%", () => {
    // Crucial benchmark for the famous "should I fold A2 preflop"
    // question. Heads-up vs random, A2o is around 55% — definitely
    // not a fold against one villain at the right price.
    const r = estimateEquity({
      holeCards: [c("A", "hearts"), c("2", "clubs")],
      communityCards: [],
      opponents: 1,
      samples: 3000,
      seed: 11,
    });
    expect(r.equity).toBeGreaterThan(0.55 - TOL);
    expect(r.equity).toBeLessThan(0.55 + TOL);
  });

  it("A2 offsuit vs 3 random opponents ≈ 30%", () => {
    // Same A2o, but against 3 random hands. Equity collapses; calling
    // a 40%-required-equity bet here is −EV. The reason the table
    // SHOULDN'T fold A2 heads-up but SHOULD usually fold it 4-way.
    const r = estimateEquity({
      holeCards: [c("A", "hearts"), c("2", "clubs")],
      communityCards: [],
      opponents: 3,
      samples: 3000,
      seed: 13,
    });
    expect(r.equity).toBeGreaterThan(0.28 - TOL);
    expect(r.equity).toBeLessThan(0.34 + TOL);
  });
});

describe("estimateEquity — postflop", () => {
  it("set of aces on dry board is dominant", () => {
    // Hole: AA. Board: A 7 2 rainbow. Top set, no draws. Equity vs
    // 1 random should be > 90%.
    const r = estimateEquity({
      holeCards: [c("A", "spades"), c("A", "hearts")],
      communityCards: [c("A", "diamonds"), c("7", "clubs"), c("2", "spades")],
      opponents: 1,
      samples: 1500,
      seed: 99,
    });
    expect(r.equity).toBeGreaterThan(0.9);
  });

  it("3-high (no pair, no draw) vs random on a paired big-card board is mostly dead", () => {
    // Hole: 2c 3d. Board: K♠ K♦ Q♣ J♥. I have THREE high — board
    // already pairs kings. Random villains very often have at least
    // a king, queen, or jack kicker; many have a pair-over-pair
    // situation. My equity should be well under 25%.
    const r = estimateEquity({
      holeCards: [c("2", "clubs"), c("3", "diamonds")],
      communityCards: [
        c("K", "spades"),
        c("K", "diamonds"),
        c("Q", "clubs"),
        c("J", "hearts"),
      ],
      opponents: 1,
      samples: 1500,
      seed: 17,
    });
    expect(r.equity).toBeLessThan(0.25);
  });

  it("bottom pair vs random heads-up is a coin-flip-ish 40-55%", () => {
    // Hole: 2c 3h. Board: 2s 9h T♥ J♥. Pair of twos vs random — most
    // random villains hold nothing or a worse high-card, so pair of
    // twos is actually around coin-flip territory heads-up. NOT a
    // "dead" hand against one player. Documents the truth that
    // surprised the author: looking-scary boards don't kill your
    // equity if the villain is on a uniform random hand.
    const r = estimateEquity({
      holeCards: [c("2", "clubs"), c("3", "hearts")],
      communityCards: [
        c("2", "spades"),
        c("9", "hearts"),
        c("10", "hearts"),
        c("J", "hearts"),
      ],
      opponents: 1,
      samples: 1500,
      seed: 17,
    });
    expect(r.equity).toBeGreaterThan(0.4);
    expect(r.equity).toBeLessThan(0.55);
  });
});

describe("estimateEquity — determinism + bounds", () => {
  it("same seed → same equity (deterministic)", () => {
    const args = {
      holeCards: [c("K", "spades"), c("Q", "hearts")],
      communityCards: [],
      opponents: 2,
      samples: 500,
      seed: 1234,
    };
    const a = estimateEquity(args);
    const b = estimateEquity(args);
    expect(a.equity).toBe(b.equity);
    expect(a.winRate).toBe(b.winRate);
    expect(a.tieRate).toBe(b.tieRate);
  });

  it("equity is always in [0, 1]", () => {
    const r = estimateEquity({
      holeCards: [c("5", "diamonds"), c("8", "clubs")],
      communityCards: [c("2", "hearts"), c("J", "spades"), c("9", "diamonds")],
      opponents: 4,
      samples: 500,
      seed: 100,
    });
    expect(r.equity).toBeGreaterThanOrEqual(0);
    expect(r.equity).toBeLessThanOrEqual(1);
    expect(r.winRate).toBeLessThanOrEqual(r.equity);
  });

  it("zero opponents → equity is 1 (uncontested)", () => {
    const r = estimateEquity({
      holeCards: [c("2", "clubs"), c("3", "diamonds")],
      communityCards: [],
      opponents: 0,
      samples: 100,
    });
    expect(r.equity).toBe(1);
  });
});

describe("estimateEquity — validation", () => {
  it("throws on duplicate cards", () => {
    expect(() =>
      estimateEquity({
        holeCards: [c("A", "spades"), c("A", "spades")],
        communityCards: [],
        opponents: 1,
        samples: 100,
      }),
    ).toThrow(/duplicate/i);
  });

  it("throws on hole + community overlap", () => {
    expect(() =>
      estimateEquity({
        holeCards: [c("A", "spades"), c("K", "spades")],
        communityCards: [c("A", "spades"), c("7", "hearts"), c("2", "diamonds")],
        opponents: 1,
        samples: 100,
      }),
    ).toThrow(/duplicate/i);
  });

  it("throws on invalid community count", () => {
    expect(() =>
      estimateEquity({
        holeCards: [c("A", "spades"), c("K", "spades")],
        communityCards: [c("7", "hearts"), c("2", "diamonds")], // only 2
        opponents: 1,
        samples: 100,
      }),
    ).toThrow(/community/);
  });

  it("throws when there aren't enough remaining cards", () => {
    // 2 hole + 23 opponents * 2 = 46 cards needed for holes alone;
    // 52 - 2 - 0 = 50 remaining, need also 5 board = 51 needed → fails
    expect(() =>
      estimateEquity({
        holeCards: [c("A", "spades"), c("K", "spades")],
        communityCards: [],
        opponents: 23,
        samples: 10,
      }),
    ).toThrow(/not enough cards/i);
  });
});

describe("potOdds", () => {
  it("free call → 0 required", () => {
    const r = potOdds(0, 100);
    expect(r.requiredEquity).toBe(0);
    expect(r.requiredEquityPct).toBe(0);
  });

  it("call 10 into 30 pot → 25%", () => {
    const r = potOdds(10, 30);
    expect(r.requiredEquity).toBeCloseTo(0.25, 4);
    expect(r.requiredEquityPct).toBe(25);
  });

  it("call 2 into 3 pot → 40%", () => {
    // The classic small-pot pre-flop call (UTG vs SB+BB raise to 2
    // total). 40% required is the exact reason A2o is borderline
    // heads-up but a clear fold multiway.
    const r = potOdds(2, 3);
    expect(r.requiredEquity).toBeCloseTo(0.4, 4);
    expect(r.requiredEquityPct).toBe(40);
  });
});
