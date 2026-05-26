import { describe, expect, test } from "vitest";

import {
  applyAction,
  createNewHand,
  getAvailableActions,
} from "./gameEngine.js";
import type { Player } from "./types.js";

function p(id: string, seatIndex: number, chipStack: number): Player {
  return {
    id,
    name: id,
    type: "agent",
    seatIndex,
    chipStack,
    holeCards: null,
    currentBet: 0,
    totalBetThisRound: 0,
    isFolded: false,
    isAllIn: false,
    isSittingOut: false,
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
  };
}

describe("game engine — heads-up sanity", () => {
  test("createNewHand posts blinds and deals two hole cards each", () => {
    const players = [p("A", 0, 1000), p("B", 1, 1000)];
    const state = createNewHand(players, 0, { small: 5, big: 10 });

    // Player A is dealer + SB in heads-up; B is BB.
    expect(state.players[0]!.holeCards).toHaveLength(2);
    expect(state.players[1]!.holeCards).toHaveLength(2);
    expect(state.pot).toBe(15);
    expect(state.phase).toBe("pre-flop");
    expect(state.currentBet).toBe(10);
  });

  test("fold by SB ends the hand and awards pot to BB", () => {
    const players = [p("A", 0, 1000), p("B", 1, 1000)];
    let state = createNewHand(players, 0, { small: 5, big: 10 });

    // Whoever is current to act folds.
    const actor = state.players[state.currentPlayerIndex]!;
    state = applyAction(state, {
      playerId: actor.id,
      action: "fold",
      amount: 0,
      timestamp: Date.now(),
    });

    expect(state.phase).toBe("hand-complete");
    expect(state.winners).toHaveLength(1);
    const winnerId = state.winners![0]!.playerId;
    const winner = state.players.find((pl) => pl.id === winnerId)!;
    // Winner stack > starting (got the blinds).
    expect(winner.chipStack).toBeGreaterThan(1000);
  });

  test("getAvailableActions for a player not in hand returns all-false", () => {
    const players = [p("A", 0, 1000), p("B", 1, 1000)];
    const state = createNewHand(players, 0, { small: 5, big: 10 });
    const actions = getAvailableActions(state, "C-not-in-game");
    expect(actions.canFold).toBe(false);
    expect(actions.canCheck).toBe(false);
  });

  test("a complete heads-up hand reaches showdown with a winner", () => {
    const players = [p("A", 0, 1000), p("B", 1, 1000)];
    let state = createNewHand(players, 0, { small: 5, big: 10 });

    // Loop: each player calls or checks until hand-complete.
    let safety = 100;
    while (state.phase !== "hand-complete" && safety-- > 0) {
      const actor = state.players[state.currentPlayerIndex]!;
      const actions = getAvailableActions(state, actor.id);
      if (actions.canCheck) {
        state = applyAction(state, {
          playerId: actor.id,
          action: "check",
          amount: 0,
          timestamp: Date.now(),
        });
      } else if (actions.canCall) {
        state = applyAction(state, {
          playerId: actor.id,
          action: "call",
          amount: actions.callAmount,
          timestamp: Date.now(),
        });
      } else {
        // Fall back: fold.
        state = applyAction(state, {
          playerId: actor.id,
          action: "fold",
          amount: 0,
          timestamp: Date.now(),
        });
      }
    }

    expect(state.phase).toBe("hand-complete");
    expect(state.winners).not.toBeNull();
    expect(state.winners!.length).toBeGreaterThan(0);

    // Total chips conserved.
    const totalChips = state.players.reduce((s, pl) => s + pl.chipStack, 0);
    expect(totalChips).toBe(2000);
  });
});
