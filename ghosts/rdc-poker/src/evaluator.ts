/**
 * Hand evaluator — vendored from pokerswarm-ai. See ../NOTICE.md.
 */

import type { Card, HandEvaluation, HandRanking, Rank } from "./types.js";
import { RANK_VALUES, HAND_RANK_VALUES } from "./constants.js";

function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

function combinations(arr: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const results: Card[][] = [];
  const [first, ...rest] = arr;
  for (const combo of combinations(rest, k - 1)) {
    results.push([first!, ...combo]);
  }
  for (const combo of combinations(rest, k)) {
    results.push(combo);
  }
  return results;
}

function sortByRankDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
}

function rankName(value: number): string {
  const names: Record<number, string> = {
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five",
    6: "Six",
    7: "Seven",
    8: "Eight",
    9: "Nine",
    10: "Ten",
    11: "Jack",
    12: "Queen",
    13: "King",
    14: "Ace",
  };
  return names[value] ?? String(value);
}

function rankNamePlural(value: number): string {
  const names: Record<number, string> = {
    2: "Twos",
    3: "Threes",
    4: "Fours",
    5: "Fives",
    6: "Sixes",
    7: "Sevens",
    8: "Eights",
    9: "Nines",
    10: "Tens",
    11: "Jacks",
    12: "Queens",
    13: "Kings",
    14: "Aces",
  };
  return names[value] ?? String(value);
}

function evaluateFiveCards(cards: Card[]): HandEvaluation {
  const sorted = sortByRankDesc(cards);
  const values = sorted.map((c) => rankValue(c.rank));
  const suits = sorted.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  let isStraight = false;
  let straightHighCard = values[0]!;

  if (
    values[0]! - values[1]! === 1 &&
    values[1]! - values[2]! === 1 &&
    values[2]! - values[3]! === 1 &&
    values[3]! - values[4]! === 1
  ) {
    isStraight = true;
    straightHighCard = values[0]!;
  }

  // Ace-low straight (A-2-3-4-5)
  if (
    values[0] === 14 &&
    values[1] === 5 &&
    values[2] === 4 &&
    values[3] === 3 &&
    values[4] === 2
  ) {
    isStraight = true;
    straightHighCard = 5;
  }

  const groups: Record<number, number> = {};
  for (const v of values) {
    groups[v] = (groups[v] ?? 0) + 1;
  }
  const counts = Object.entries(groups)
    .map(([val, count]) => ({ val: Number(val), count }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  let ranking: HandRanking;
  let highCards: number[];
  let description: string;

  if (isFlush && isStraight && straightHighCard === 14) {
    ranking = "royal-flush";
    highCards = [14];
    description = "Royal Flush";
  } else if (isFlush && isStraight) {
    ranking = "straight-flush";
    highCards = [straightHighCard];
    description = `Straight Flush, ${rankName(straightHighCard)} high`;
  } else if (counts[0]!.count === 4) {
    ranking = "four-of-a-kind";
    highCards = [counts[0]!.val, counts[1]!.val];
    description = `Four ${rankNamePlural(counts[0]!.val)}`;
  } else if (counts[0]!.count === 3 && counts[1]!.count === 2) {
    ranking = "full-house";
    highCards = [counts[0]!.val, counts[1]!.val];
    description = `Full House, ${rankNamePlural(counts[0]!.val)} full of ${rankNamePlural(counts[1]!.val)}`;
  } else if (isFlush) {
    ranking = "flush";
    highCards = values;
    description = `Flush, ${rankName(values[0]!)} high`;
  } else if (isStraight) {
    ranking = "straight";
    highCards = [straightHighCard];
    description = `Straight, ${rankName(straightHighCard)} high`;
  } else if (counts[0]!.count === 3) {
    ranking = "three-of-a-kind";
    const kickers = counts.filter((c) => c.count === 1).map((c) => c.val);
    highCards = [counts[0]!.val, ...kickers];
    description = `Three ${rankNamePlural(counts[0]!.val)}`;
  } else if (counts[0]!.count === 2 && counts[1]!.count === 2) {
    ranking = "two-pair";
    const pairs = counts
      .filter((c) => c.count === 2)
      .map((c) => c.val)
      .sort((a, b) => b - a);
    const kicker = counts.find((c) => c.count === 1)!.val;
    highCards = [...pairs, kicker];
    description = `Two Pair, ${rankNamePlural(pairs[0]!)} and ${rankNamePlural(pairs[1]!)}`;
  } else if (counts[0]!.count === 2) {
    ranking = "pair";
    const kickers = counts
      .filter((c) => c.count === 1)
      .map((c) => c.val)
      .sort((a, b) => b - a);
    highCards = [counts[0]!.val, ...kickers];
    description = `Pair of ${rankNamePlural(counts[0]!.val)}`;
  } else {
    ranking = "high-card";
    highCards = values;
    description = `${rankName(values[0]!)} High`;
  }

  return {
    ranking,
    rankValue: HAND_RANK_VALUES[ranking],
    highCards,
    description,
    bestFiveCards: sorted,
  };
}

export function evaluateHand(
  holeCards: Card[],
  communityCards: Card[],
): HandEvaluation {
  const allCards = [...holeCards, ...communityCards];

  if (allCards.length < 5) {
    if (allCards.length >= 2) {
      const sorted = sortByRankDesc(allCards);
      const values = sorted.map((c) => rankValue(c.rank));
      if (values[0] === values[1]) {
        return {
          ranking: "pair",
          rankValue: 1,
          highCards: values,
          description: `Pair of ${rankNamePlural(values[0]!)}`,
          bestFiveCards: sorted,
        };
      }
      return {
        ranking: "high-card",
        rankValue: 0,
        highCards: values,
        description: `${rankName(values[0]!)} High`,
        bestFiveCards: sorted,
      };
    }
    return {
      ranking: "high-card",
      rankValue: 0,
      highCards: [],
      description: "No cards",
      bestFiveCards: [],
    };
  }

  const fiveCardCombos = combinations(allCards, 5);
  let bestHand: HandEvaluation | null = null;

  for (const combo of fiveCardCombos) {
    const evaluation = evaluateFiveCards(combo);
    if (!bestHand || compareHands(evaluation, bestHand) > 0) {
      bestHand = evaluation;
    }
  }

  return bestHand!;
}

export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.rankValue !== b.rankValue) {
    return a.rankValue - b.rankValue;
  }
  for (let i = 0; i < Math.min(a.highCards.length, b.highCards.length); i++) {
    if (a.highCards[i] !== b.highCards[i]) {
      return a.highCards[i]! - b.highCards[i]!;
    }
  }
  return 0;
}

export function getHandStrengthPercent(evaluation: HandEvaluation): number {
  const base = evaluation.rankValue * 10;
  const kicker = evaluation.highCards[0]
    ? (evaluation.highCards[0] / 14) * 9
    : 0;
  return Math.min(100, Math.round(base + kicker));
}
