import { describe, expect, test } from "vitest";

import { compareHands, evaluateHand } from "./evaluator.js";
import type { Card } from "./types.js";

const C = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

describe("evaluator", () => {
  test("royal flush beats straight flush", () => {
    const royal = evaluateHand(
      [C("A", "spades"), C("K", "spades")],
      [C("Q", "spades"), C("J", "spades"), C("10", "spades")],
    );
    const straightFlush = evaluateHand(
      [C("9", "hearts"), C("8", "hearts")],
      [C("7", "hearts"), C("6", "hearts"), C("5", "hearts")],
    );
    expect(royal.ranking).toBe("royal-flush");
    expect(straightFlush.ranking).toBe("straight-flush");
    expect(compareHands(royal, straightFlush)).toBeGreaterThan(0);
  });

  test("four of a kind beats full house", () => {
    const quads = evaluateHand(
      [C("A", "spades"), C("A", "hearts")],
      [C("A", "diamonds"), C("A", "clubs"), C("2", "spades")],
    );
    const full = evaluateHand(
      [C("K", "spades"), C("K", "hearts")],
      [C("K", "diamonds"), C("3", "spades"), C("3", "hearts")],
    );
    expect(quads.ranking).toBe("four-of-a-kind");
    expect(full.ranking).toBe("full-house");
    expect(compareHands(quads, full)).toBeGreaterThan(0);
  });

  test("flush beats straight", () => {
    const flush = evaluateHand(
      [C("A", "spades"), C("9", "spades")],
      [C("7", "spades"), C("4", "spades"), C("2", "spades")],
    );
    const straight = evaluateHand(
      [C("9", "hearts"), C("8", "diamonds")],
      [C("7", "clubs"), C("6", "hearts"), C("5", "spades")],
    );
    expect(flush.ranking).toBe("flush");
    expect(straight.ranking).toBe("straight");
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  test("ace-low straight (wheel) recognised", () => {
    const wheel = evaluateHand(
      [C("A", "spades"), C("2", "hearts")],
      [C("3", "diamonds"), C("4", "clubs"), C("5", "spades")],
    );
    expect(wheel.ranking).toBe("straight");
    expect(wheel.highCards[0]).toBe(5);
  });

  test("pair of aces beats pair of kings", () => {
    const aces = evaluateHand(
      [C("A", "spades"), C("A", "hearts")],
      [C("7", "diamonds"), C("4", "clubs"), C("2", "spades")],
    );
    const kings = evaluateHand(
      [C("K", "spades"), C("K", "hearts")],
      [C("Q", "diamonds"), C("4", "clubs"), C("2", "spades")],
    );
    expect(aces.ranking).toBe("pair");
    expect(kings.ranking).toBe("pair");
    expect(compareHands(aces, kings)).toBeGreaterThan(0);
  });

  test("kicker decides equal pairs", () => {
    const aceKickerKing = evaluateHand(
      [C("A", "spades"), C("A", "hearts")],
      [C("K", "diamonds"), C("4", "clubs"), C("2", "spades")],
    );
    const aceKickerQueen = evaluateHand(
      [C("A", "spades"), C("A", "hearts")],
      [C("Q", "diamonds"), C("4", "clubs"), C("2", "spades")],
    );
    expect(compareHands(aceKickerKing, aceKickerQueen)).toBeGreaterThan(0);
  });
});
