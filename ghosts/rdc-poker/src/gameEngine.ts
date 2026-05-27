/**
 * Texas Hold'em state machine — vendored from pokerswarm-ai/src/lib/poker/gameEngine.ts.
 * See ../NOTICE.md. Only modification: replaced `nanoid` with `crypto.randomUUID()`.
 *
 * Pure functional — every transition returns a new GameState; inputs untouched.
 */

import { randomUUID } from "node:crypto";

import type {
  Card,
  GameState,
  Player,
  PlayerAction,
  AvailableActions,
  WinResult,
  GamePhase,
} from "./types.js";
import { createDeck, shuffleDeck, dealCards } from "./deck.js";
import { evaluateHand, compareHands } from "./evaluator.js";
import { calculateSidePots } from "./pot.js";

export function createNewHand(
  players: Player[],
  dealerIndex: number,
  blinds: { small: number; big: number },
): GameState {
  const deck = shuffleDeck(createDeck());
  const numPlayers = players.length;

  const resetPlayers = players.map((p, i) => ({
    ...p,
    holeCards: null as Card[] | null,
    currentBet: 0,
    totalBetThisRound: 0,
    totalContributed: 0,
    isFolded: false,
    isAllIn: false,
    isDealer: i === dealerIndex,
    isSmallBlind: false,
    isBigBlind: false,
  }));

  const sbIndex = (dealerIndex + 1) % numPlayers;
  const bbIndex = (dealerIndex + 2) % numPlayers;

  resetPlayers[sbIndex]!.isSmallBlind = true;
  resetPlayers[bbIndex]!.isBigBlind = true;

  let currentDeck = deck;
  for (let i = 0; i < numPlayers; i++) {
    const playerIndex = (dealerIndex + 1 + i) % numPlayers;
    const [cards, remaining] = dealCards(currentDeck, 2);
    resetPlayers[playerIndex]!.holeCards = cards;
    currentDeck = remaining;
  }

  const sbAmount = Math.min(blinds.small, resetPlayers[sbIndex]!.chipStack);
  resetPlayers[sbIndex]!.chipStack -= sbAmount;
  resetPlayers[sbIndex]!.currentBet = sbAmount;
  resetPlayers[sbIndex]!.totalBetThisRound = sbAmount;
  resetPlayers[sbIndex]!.totalContributed = sbAmount;
  if (resetPlayers[sbIndex]!.chipStack === 0) {
    resetPlayers[sbIndex]!.isAllIn = true;
  }

  const bbAmount = Math.min(blinds.big, resetPlayers[bbIndex]!.chipStack);
  resetPlayers[bbIndex]!.chipStack -= bbAmount;
  resetPlayers[bbIndex]!.currentBet = bbAmount;
  resetPlayers[bbIndex]!.totalBetThisRound = bbAmount;
  resetPlayers[bbIndex]!.totalContributed = bbAmount;
  if (resetPlayers[bbIndex]!.chipStack === 0) {
    resetPlayers[bbIndex]!.isAllIn = true;
  }

  const firstToAct = findNextActivePlayer(resetPlayers, bbIndex);

  return {
    id: randomUUID(),
    handNumber: 1,
    phase: "pre-flop",
    players: resetPlayers,
    communityCards: [],
    pot: sbAmount + bbAmount,
    sidePots: [],
    currentPlayerIndex: firstToAct,
    dealerIndex,
    smallBlindAmount: blinds.small,
    bigBlindAmount: blinds.big,
    minimumRaise: blinds.big,
    currentBet: bbAmount,
    actionHistory: [],
    deck: currentDeck,
    winners: null,
    lastAggressor: null,
    bettingRoundComplete: false,
  };
}

function findNextActivePlayer(players: Player[], fromIndex: number): number {
  const numPlayers = players.length;
  for (let i = 1; i <= numPlayers; i++) {
    const idx = (fromIndex + i) % numPlayers;
    const p = players[idx]!;
    if (!p.isFolded && !p.isAllIn && p.chipStack > 0) {
      return idx;
    }
  }
  return -1;
}

function countActivePlayers(players: Player[]): number {
  return players.filter((p) => !p.isFolded).length;
}

function countPlayersCanAct(players: Player[]): number {
  return players.filter((p) => !p.isFolded && !p.isAllIn && p.chipStack > 0)
    .length;
}

export function getAvailableActions(
  state: GameState,
  playerId: string,
): AvailableActions {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isFolded || player.isAllIn) {
    return {
      canFold: false,
      canCheck: false,
      canCall: false,
      callAmount: 0,
      canRaise: false,
      minRaise: 0,
      maxRaise: 0,
      canAllIn: false,
      allInAmount: 0,
    };
  }

  const toCall = state.currentBet - player.currentBet;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && player.chipStack > 0;
  const callAmount = Math.min(toCall, player.chipStack);
  const isCallAllIn = callAmount >= player.chipStack;

  // Bet-level semantics: minRaise / maxRaise / action.amount all express the
  // NEW player.currentBet level — i.e. "raise to X" in standard poker terms.
  const minRaiseLevel = state.currentBet + state.minimumRaise;
  const allInLevel = player.chipStack + player.currentBet;
  const canRaise =
    allInLevel >= minRaiseLevel && player.chipStack > toCall;

  return {
    canFold: true,
    canCheck,
    canCall: canCall && !isCallAllIn,
    callAmount,
    canRaise,
    minRaise: minRaiseLevel,
    maxRaise: allInLevel,
    canAllIn: player.chipStack > 0,
    allInAmount: player.chipStack,
  };
}

export function applyAction(
  state: GameState,
  action: PlayerAction,
): GameState {
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIndex === -1) return state;

  const newState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    actionHistory: [...state.actionHistory, action],
    communityCards: [...state.communityCards],
  };

  const player = newState.players[playerIndex]!;

  switch (action.action) {
    case "fold":
      player.isFolded = true;
      break;

    case "check":
      break;

    case "call": {
      const toCall = Math.min(
        newState.currentBet - player.currentBet,
        player.chipStack,
      );
      player.chipStack -= toCall;
      player.currentBet += toCall;
      player.totalBetThisRound += toCall;
      player.totalContributed = (player.totalContributed ?? 0) + toCall;
      newState.pot += toCall;
      if (player.chipStack === 0) player.isAllIn = true;
      break;
    }

    case "raise": {
      const raiseAmount = action.amount;
      const totalToAdd = raiseAmount - player.currentBet;
      if (totalToAdd <= 0 || raiseAmount < state.currentBet) {
        break;
      }
      const actualAdd = Math.min(totalToAdd, player.chipStack);
      player.chipStack -= actualAdd;
      player.currentBet += actualAdd;
      player.totalBetThisRound += actualAdd;
      player.totalContributed = (player.totalContributed ?? 0) + actualAdd;
      newState.pot += actualAdd;
      newState.currentBet = player.currentBet;
      newState.minimumRaise = player.currentBet - state.currentBet;
      newState.lastAggressor = player.id;
      if (player.chipStack === 0) player.isAllIn = true;
      break;
    }

    case "all-in": {
      const allInAmount = player.chipStack;
      player.currentBet += allInAmount;
      player.totalBetThisRound += allInAmount;
      player.totalContributed = (player.totalContributed ?? 0) + allInAmount;
      newState.pot += allInAmount;
      player.chipStack = 0;
      player.isAllIn = true;
      if (player.currentBet > newState.currentBet) {
        newState.minimumRaise = player.currentBet - newState.currentBet;
        newState.currentBet = player.currentBet;
        newState.lastAggressor = player.id;
      }
      break;
    }
  }

  if (countActivePlayers(newState.players) === 1) {
    return resolveHand(newState);
  }

  const nextPlayer = findNextActivePlayer(newState.players, playerIndex);

  if (nextPlayer === -1 || isBettingRoundComplete(newState)) {
    return advancePhase(newState);
  }

  newState.currentPlayerIndex = nextPlayer;
  return newState;
}

function isBettingRoundComplete(state: GameState): boolean {
  const playersCanAct = state.players.filter(
    (p) => !p.isFolded && !p.isAllIn && p.chipStack > 0,
  );

  if (playersCanAct.length === 0) return true;
  if (playersCanAct.length === 1 && countActivePlayers(state.players) <= 1)
    return true;

  const allMatched = playersCanAct.every(
    (p) => p.currentBet === state.currentBet,
  );

  if (!allMatched) return false;

  if (state.phase === "pre-flop") {
    const bbPlayer = state.players.find((p) => p.isBigBlind);
    if (bbPlayer && !bbPlayer.isFolded && !bbPlayer.isAllIn) {
      const bbActions = state.actionHistory.filter(
        (a) => a.playerId === bbPlayer.id,
      );
      if (bbActions.length === 0 && state.currentBet === state.bigBlindAmount) {
        return false;
      }
    }
  }

  const actorsThisRound = new Set(
    state.actionHistory.map((a) => a.playerId),
  );

  return playersCanAct.every((p) => actorsThisRound.has(p.id));
}

function advancePhase(state: GameState): GameState {
  const newState = {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      currentBet: 0,
    })),
    currentBet: 0,
    minimumRaise: state.bigBlindAmount,
    communityCards: [...state.communityCards],
  };

  const allInPlayers = newState.players.filter((p) => p.isAllIn && !p.isFolded);
  if (allInPlayers.length > 0) {
    newState.sidePots = calculateSidePots(newState.players);
  }

  if (
    countPlayersCanAct(newState.players) < 2 &&
    countActivePlayers(newState.players) >= 2
  ) {
    return rushToShowdown(newState);
  }

  switch (state.phase) {
    case "pre-flop": {
      const [flop, remaining] = dealCards(newState.deck, 3);
      newState.communityCards = flop;
      newState.deck = remaining;
      newState.phase = "flop";
      break;
    }
    case "flop": {
      const [turn, remaining] = dealCards(newState.deck, 1);
      newState.communityCards = [...newState.communityCards, ...turn];
      newState.deck = remaining;
      newState.phase = "turn";
      break;
    }
    case "turn": {
      const [river, remaining] = dealCards(newState.deck, 1);
      newState.communityCards = [...newState.communityCards, ...river];
      newState.deck = remaining;
      newState.phase = "river";
      break;
    }
    case "river": {
      return resolveShowdown(newState);
    }
  }

  newState.players = newState.players.map((p) => ({
    ...p,
    totalBetThisRound: 0,
  }));

  const firstToAct = findNextActivePlayer(newState.players, newState.dealerIndex);
  if (firstToAct === -1) {
    return resolveShowdown(newState);
  }
  newState.currentPlayerIndex = firstToAct;

  return newState;
}

function dealRemainingBoard(state: GameState): GameState {
  const newState = {
    ...state,
    communityCards: [...state.communityCards],
    deck: [...state.deck],
  };
  while (newState.communityCards.length < 5) {
    const [cards, remaining] = dealCards(newState.deck, 1);
    newState.communityCards = [...newState.communityCards, ...cards];
    newState.deck = remaining;
  }
  return newState;
}

function rushToShowdown(state: GameState): GameState {
  return resolveShowdown(dealRemainingBoard(state));
}

function resolveHand(state: GameState): GameState {
  const winner = state.players.find((p) => !p.isFolded)!;
  const newState = {
    ...state,
    phase: "hand-complete" as GamePhase,
    players: state.players.map((p) => ({ ...p })),
    winners: [
      {
        playerId: winner.id,
        amount: state.pot,
        hand: null,
        potType: "main" as const,
      },
    ],
  };

  const winnerPlayer = newState.players.find((p) => p.id === winner.id)!;
  winnerPlayer.chipStack += state.pot;
  newState.pot = 0;

  return newState;
}

function resolveShowdown(state: GameState): GameState {
  const dealt =
    state.communityCards.length < 5 ? dealRemainingBoard(state) : state;

  const activePlayers = dealt.players.filter((p) => !p.isFolded);
  const newState = {
    ...dealt,
    phase: "showdown" as GamePhase,
    players: dealt.players.map((p) => ({ ...p })),
    winners: [] as WinResult[],
  };

  const evaluations = activePlayers.map((p) => ({
    player: p,
    evaluation: evaluateHand(p.holeCards!, dealt.communityCards),
  }));

  evaluations.sort((a, b) => compareHands(b.evaluation, a.evaluation));

  if (dealt.sidePots.length > 0) {
    for (const sidePot of dealt.sidePots) {
      const eligible = evaluations.filter((e) =>
        sidePot.eligiblePlayerIds.includes(e.player.id),
      );
      if (eligible.length > 0) {
        const bestHand = eligible[0]!.evaluation;
        const potWinners = eligible.filter(
          (e) => compareHands(e.evaluation, bestHand) === 0,
        );
        const shareAmount = Math.floor(sidePot.amount / potWinners.length);

        for (const w of potWinners) {
          const playerInState = newState.players.find(
            (p) => p.id === w.player.id,
          )!;
          playerInState.chipStack += shareAmount;
          newState.winners!.push({
            playerId: w.player.id,
            amount: shareAmount,
            hand: w.evaluation,
            potType: "side",
          });
        }
      }
    }
    const remainingPot =
      newState.pot -
      dealt.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
    if (remainingPot > 0) {
      const bestHand = evaluations[0]!.evaluation;
      const mainWinners = evaluations.filter(
        (e) => compareHands(e.evaluation, bestHand) === 0,
      );
      const shareAmount = Math.floor(remainingPot / mainWinners.length);
      for (const w of mainWinners) {
        const playerInState = newState.players.find(
          (p) => p.id === w.player.id,
        )!;
        playerInState.chipStack += shareAmount;
        newState.winners!.push({
          playerId: w.player.id,
          amount: shareAmount,
          hand: w.evaluation,
          potType: "main",
        });
      }
    }
  } else {
    const bestHand = evaluations[0]!.evaluation;
    const winners = evaluations.filter(
      (e) => compareHands(e.evaluation, bestHand) === 0,
    );
    const shareAmount = Math.floor(newState.pot / winners.length);

    for (const w of winners) {
      const playerInState = newState.players.find((p) => p.id === w.player.id)!;
      playerInState.chipStack += shareAmount;
      newState.winners!.push({
        playerId: w.player.id,
        amount: shareAmount,
        hand: w.evaluation,
        potType: "main",
      });
    }
  }

  // Dedupe winners by playerId
  const grouped = new Map<string, WinResult>();
  for (const w of newState.winners!) {
    const existing = grouped.get(w.playerId);
    if (existing) {
      existing.amount += w.amount;
    } else {
      grouped.set(w.playerId, { ...w });
    }
  }
  newState.winners = Array.from(grouped.values());

  newState.pot = 0;
  newState.phase = "hand-complete";
  return newState;
}

export function startNextHand(prevState: GameState): GameState {
  const remainingPlayers = prevState.players.filter((p) => p.chipStack > 0);

  if (remainingPlayers.length < 2) {
    return { ...prevState, phase: "waiting" };
  }

  const newDealerIndex =
    (prevState.dealerIndex + 1) % remainingPlayers.length;

  const newState = createNewHand(remainingPlayers, newDealerIndex, {
    small: prevState.smallBlindAmount,
    big: prevState.bigBlindAmount,
  });

  newState.handNumber = prevState.handNumber + 1;
  return newState;
}
