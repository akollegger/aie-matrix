/**
 * @aie-matrix/ghost-rdc-poker
 *
 * Pure Texas Hold'em engine. Vendored from pokerswarm-ai with permission.
 * Stateless and side-effect-free; consumed by rdc-orchestrator to run
 * tables, and by rdc-agent (poker brain) to read available actions.
 */

export type {
  Suit,
  Rank,
  Card,
  HandRanking,
  HandEvaluation,
  PlayerType,
  AgentPersona,
  Player,
  GamePhase,
  ActionType,
  PlayerAction,
  SidePot,
  WinResult,
  GameState,
  AvailableActions,
  DifficultyLevel,
  GameConfig,
} from "./types.js";

export {
  SUITS,
  RANKS,
  RANK_VALUES,
  HAND_RANK_VALUES,
  SUIT_SYMBOLS,
} from "./constants.js";

export { createDeck, shuffleDeck, dealCards } from "./deck.js";

export {
  evaluateHand,
  compareHands,
  getHandStrengthPercent,
} from "./evaluator.js";

export { calculateSidePots } from "./pot.js";

export {
  createNewHand,
  getAvailableActions,
  applyAction,
  startNextHand,
} from "./gameEngine.js";
