/**
 * Poker types — vendored from pokerswarm-ai/src/lib/poker/types.ts.
 * See ../NOTICE.md for attribution.
 */

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandRanking =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush"
  | "royal-flush";

export interface HandEvaluation {
  ranking: HandRanking;
  rankValue: number;
  highCards: number[];
  description: string;
  bestFiveCards: Card[];
}

export type PlayerType = "human" | "agent";

/**
 * AgentPersona shapes how the LLM brain inflects its decisions. In RDC,
 * we derive these on the fly from the ghost's slider profile rather
 * than ship a fixed roster — see rdc-agent/src/persona-from-sliders.ts.
 */
export interface AgentPersona {
  id: string;
  name: string;
  archetype: string;
  description: string;
  aggression: number;
  tightness: number;
  bluffFrequency: number;
  tiltSusceptibility: number;
  catchphrase: string;
  vpip: number;
  pfr: number;
  foldTo3Bet: number;
  model?: string;
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  seatIndex: number;
  chipStack: number;
  holeCards: Card[] | null;
  currentBet: number;
  totalBetThisRound: number;
  /** Cumulative chips put into the pot for the current hand. */
  totalContributed?: number;
  isFolded: boolean;
  isAllIn: boolean;
  isSittingOut: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  persona?: AgentPersona;
}

export type GamePhase =
  | "waiting"
  | "pre-flop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "hand-complete";

export type ActionType = "fold" | "check" | "call" | "raise" | "all-in";

export interface PlayerAction {
  playerId: string;
  action: ActionType;
  amount: number;
  timestamp: number;
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface WinResult {
  playerId: string;
  amount: number;
  hand: HandEvaluation | null;
  potType: "main" | "side";
}

export interface GameState {
  id: string;
  handNumber: number;
  phase: GamePhase;
  players: Player[];
  communityCards: Card[];
  pot: number;
  sidePots: SidePot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlindAmount: number;
  bigBlindAmount: number;
  minimumRaise: number;
  currentBet: number;
  actionHistory: PlayerAction[];
  deck: Card[];
  winners: WinResult[] | null;
  lastAggressor: string | null;
  bettingRoundComplete: boolean;
}

export interface AvailableActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
  canAllIn: boolean;
  allInAmount: number;
}

export type DifficultyLevel = "beginner" | "intermediate" | "advanced";

export interface GameConfig {
  playerCount: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  personas: AgentPersona[];
  difficulty: DifficultyLevel;
  /** Seconds; null/undefined = no timer. */
  decisionTimeBank?: number | null;
}
