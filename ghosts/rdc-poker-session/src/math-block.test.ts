import { describe, expect, test } from "vitest";
import type {
  AvailableActions,
  Card,
  GameState,
  Player,
} from "@aie-matrix/ghost-rdc-poker";

import { computeMathBlock } from "./math-block.js";
import { MATH_SCHOOLS, SCHOOL_FLAVOR_NAMES } from "./math-schools.js";

const C = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Test",
    type: "ai",
    seatIndex: 0,
    chipStack: 200,
    holeCards: [C("A", "spades"), C("K", "spades")],
    currentBet: 0,
    totalBetThisRound: 0,
    isFolded: false,
    isAllIn: false,
    hasActed: false,
    persona: null,
    ...overrides,
  } as Player;
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "g1",
    handNumber: 1,
    phase: "preflop",
    players: [makePlayer(), makePlayer({ id: "p2", name: "Villain", seatIndex: 1 })],
    communityCards: [],
    pot: 30,
    sidePots: [],
    currentPlayerIndex: 0,
    dealerIndex: 1,
    smallBlindAmount: 1,
    bigBlindAmount: 2,
    minimumRaise: 2,
    currentBet: 2,
    actionHistory: [],
    deck: [],
    winners: null,
    lastAggressor: null,
    bettingRoundComplete: false,
    ...overrides,
  } as GameState;
}

const AVAILABLE: AvailableActions = {
  canCheck: false,
  canCall: true,
  canRaise: true,
  canFold: true,
  callAmount: 2,
  minRaise: 4,
  maxRaise: 200,
  canAllIn: true,
  allInAmount: 200,
};

describe("computeMathBlock", () => {
  const me = makePlayer();
  const ctx = {
    me,
    gameState: makeGameState({ players: [me, makePlayer({ id: "p2", name: "Villain", seatIndex: 1 })] }),
    availableActions: AVAILABLE,
    opponentReads: ["- Villain: Recent — raise turn. Tendencies: 3-bet preflop (2x)."],
    tableAnimalTypes: undefined,
  };

  test.each(MATH_SCHOOLS)("school %s produces a non-empty block with its flavour header", (school) => {
    const block = computeMathBlock(school, ctx);
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain(SCHOOL_FLAVOR_NAMES[school]);
  });

  test("Chen block surfaces a numeric score for AKs", () => {
    const block = computeMathBlock("Chen", ctx);
    expect(block).toMatch(/Chen score: \d+/);
  });

  test("Harrington block surfaces M-ratio and zone", () => {
    const block = computeMathBlock("Harrington", ctx);
    expect(block).toMatch(/M = [\d.]+/);
    expect(block).toMatch(/(green|yellow|orange|red) zone/);
  });

  test("Hellmouth block flags AK as top-10", () => {
    const block = computeMathBlock("Hellmuth", ctx);
    expect(block).toContain("Top-10 check");
    expect(block).toContain("YES");
  });

  test("Hellmouth block rejects 72o as non-top-10", () => {
    const trash = makePlayer({ holeCards: [C("7", "hearts"), C("2", "spades")] });
    const localCtx = { ...ctx, me: trash, gameState: makeGameState({ players: [trash, ctx.gameState.players[1]!] }) };
    const block = computeMathBlock("Hellmuth", localCtx);
    expect(block).toContain("Top-10 check");
    expect(block).toContain("no — Hellmuth would fold");
  });
});
