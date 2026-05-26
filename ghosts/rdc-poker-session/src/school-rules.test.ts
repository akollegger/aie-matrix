import { describe, expect, it } from "vitest";
import type {
  AvailableActions,
  Card,
  GameState,
  Player,
  Rank,
  Suit,
} from "@aie-matrix/ghost-rdc-poker";
import { decideBySchool, type SchoolContext } from "./school-rules.js";

// ─── Test fixtures ────────────────────────────────────────────────────

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function mkPlayer(over: Partial<Player>): Player {
  return {
    id: over.id ?? "me",
    name: over.name ?? "Me",
    type: over.type ?? "agent",
    seatIndex: over.seatIndex ?? 0,
    chipStack: over.chipStack ?? 100,
    holeCards: over.holeCards ?? [],
    currentBet: over.currentBet ?? 0,
    totalBetThisRound: over.totalBetThisRound ?? 0,
    isFolded: over.isFolded ?? false,
    isAllIn: over.isAllIn ?? false,
    isSittingOut: over.isSittingOut ?? false,
    isDealer: over.isDealer ?? false,
    isSmallBlind: over.isSmallBlind ?? false,
    isBigBlind: over.isBigBlind ?? false,
    persona: over.persona,
  } as Player;
}

function mkGameState(over: Partial<GameState> & { players: Player[] }): GameState {
  return {
    id: "g1",
    handNumber: 1,
    phase: over.phase ?? "pre-flop",
    players: over.players,
    communityCards: over.communityCards ?? [],
    pot: over.pot ?? 3,
    sidePots: [],
    currentPlayerIndex: 0,
    dealerIndex: over.dealerIndex ?? 0,
    smallBlindAmount: over.smallBlindAmount ?? 1,
    bigBlindAmount: over.bigBlindAmount ?? 2,
    minimumRaise: 2,
    currentBet: over.currentBet ?? 2,
    actionHistory: [],
    deck: [],
    winners: null,
    lastAggressor: null,
    bettingRoundComplete: false,
  };
}

function mkActions(over: Partial<AvailableActions> = {}): AvailableActions {
  return {
    canFold: over.canFold ?? true,
    canCheck: over.canCheck ?? false,
    canCall: over.canCall ?? true,
    canRaise: over.canRaise ?? true,
    canAllIn: over.canAllIn ?? true,
    callAmount: over.callAmount ?? 2,
    minRaise: over.minRaise ?? 4,
    maxRaise: over.maxRaise ?? 100,
    allInAmount: over.allInAmount ?? 100,
  };
}

function mkCtx(over: Partial<SchoolContext>): SchoolContext {
  const me = over.me ?? mkPlayer({ id: "me", holeCards: [c("A", "spades"), c("K", "spades")] });
  const villain = mkPlayer({ id: "v1", name: "V" });
  return {
    me,
    gameState: over.gameState ?? mkGameState({ players: [me, villain] }),
    availableActions: over.availableActions ?? mkActions(),
    equity: over.equity ?? 0.6,
    requiredEquity: over.requiredEquity ?? 0.4,
    position: over.position ?? "BTN",
    bbStack: over.bbStack ?? 50,
    activeOpponents: over.activeOpponents ?? [villain],
    opponentReads: over.opponentReads,
    tableAnimalTypes: over.tableAnimalTypes,
  };
}

// ─── Sklansky ─────────────────────────────────────────────────────────

describe("Sklansky", () => {
  it("forbids fold when equity is firmly above required (margin > 5%)", () => {
    // Margin > 15% triggers a value-raise recommendation. Margin
    // between 5% and 15% is a "just call profitably" zone — covered
    // in a separate test below.
    const d = decideBySchool("Sklansky", mkCtx({ equity: 0.6, requiredEquity: 0.4 }));
    expect(d.forbidden.has("fold")).toBe(true);
    expect(d.recommendation).toBe("raise");
  });

  it("call-zone (5% < margin ≤ 15%): forbid fold, recommend call (not raise)", () => {
    const d = decideBySchool("Sklansky", mkCtx({ equity: 0.5, requiredEquity: 0.4 }));
    expect(d.forbidden.has("fold")).toBe(true);
    expect(d.recommendation).toBe("call");
  });

  it("forbids call and raise when equity is dominated (margin < -5%)", () => {
    const d = decideBySchool("Sklansky", mkCtx({ equity: 0.3, requiredEquity: 0.4 }));
    expect(d.forbidden.has("call")).toBe(true);
    expect(d.forbidden.has("raise")).toBe(true);
    expect(d.recommendation).toBe("fold");
  });

  it("does not prune in the coin-flip zone (|margin| < 5%)", () => {
    const d = decideBySchool("Sklansky", mkCtx({ equity: 0.42, requiredEquity: 0.4 }));
    expect(d.forbidden.size).toBe(0);
  });

  it("recommends raise when margin is huge (> 15%) and raise is legal", () => {
    const d = decideBySchool("Sklansky", mkCtx({ equity: 0.8, requiredEquity: 0.4 }));
    expect(d.recommendation).toBe("raise");
    expect(d.forbidden.has("fold")).toBe(true);
  });

  it("never prunes on a free check", () => {
    const d = decideBySchool(
      "Sklansky",
      mkCtx({
        equity: 0.2,
        requiredEquity: 0,
        availableActions: mkActions({ canCheck: true, callAmount: 0 }),
      }),
    );
    expect(d.forbidden.size).toBe(0);
    expect(d.recommendation).toBe("check");
  });
});

// ─── Chen ─────────────────────────────────────────────────────────────

describe("Chen", () => {
  it("AA pre-flop: forbid fold, recommend raise", () => {
    const me = mkPlayer({
      id: "me",
      holeCards: [c("A", "spades"), c("A", "hearts")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Chen", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v] }),
      equity: 0.85,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("fold")).toBe(true);
    expect(d.recommendation).toBe("raise");
  });

  it("low Chen score from early position: folds (call+raise forbidden)", () => {
    // 7-2 offsuit, score around 0
    const me = mkPlayer({
      id: "me",
      holeCards: [c("7", "spades"), c("2", "diamonds")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Chen", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v] }),
      equity: 0.3,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("call")).toBe(true);
    expect(d.recommendation).toBe("fold");
  });

  it("EQUITY OVERRIDE: even Chen unfolds when equity is much higher than required", () => {
    // 7-2 offsuit but somehow has 70% equity (e.g. opponent shoves blind)
    const me = mkPlayer({
      id: "me",
      holeCards: [c("7", "spades"), c("2", "diamonds")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Chen", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v] }),
      equity: 0.7,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("call")).toBe(false);
    expect(d.recommendation).toBe("call");
  });

  it("post-flop falls back to equity-vs-pot-odds", () => {
    const me = mkPlayer({
      id: "me",
      holeCards: [c("7", "spades"), c("2", "diamonds")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Chen", mkCtx({
      me,
      gameState: mkGameState({
        players: [me, v],
        communityCards: [c("7", "hearts"), c("2", "clubs"), c("K", "hearts")],
      }),
      equity: 0.7,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("fold")).toBe(true);
  });
});

// ─── Harrington ───────────────────────────────────────────────────────

describe("Harrington", () => {
  it("orange zone (7 ≤ bb < 15) forbids call", () => {
    const d = decideBySchool("Harrington", mkCtx({
      bbStack: 8,
      equity: 0.6,
      requiredEquity: 0.4,
    }));
    expect(d.forbidden.has("call")).toBe(true);
  });

  it("red zone (bb < 7) forbids call AND check — push or fold", () => {
    const d = decideBySchool("Harrington", mkCtx({
      bbStack: 4,
      equity: 0.6,
      requiredEquity: 0.4,
    }));
    expect(d.forbidden.has("call")).toBe(true);
    expect(d.forbidden.has("check")).toBe(true);
  });

  it("green zone behaves like vanilla equity-vs-pot-odds", () => {
    const d = decideBySchool("Harrington", mkCtx({
      bbStack: 50,
      equity: 0.6,
      requiredEquity: 0.4,
    }));
    expect(d.forbidden.has("call")).toBe(false);
    expect(d.forbidden.has("check")).toBe(false);
    expect(d.forbidden.has("fold")).toBe(true); // dominant equity
  });
});

// ─── ICM ──────────────────────────────────────────────────────────────

describe("ICM", () => {
  it("short stack (< 10 BB) gets a survival penalty added to required equity", () => {
    // Equity 45%, required 40% — would call for Sklansky. ICM adds
    // +12% to required → 52% required, so 45% < 52% → fold.
    const d = decideBySchool("ICM", mkCtx({
      bbStack: 8,
      equity: 0.45,
      requiredEquity: 0.4,
    }));
    expect(d.recommendation).toBe("fold");
  });

  it("healthy stack acts like Sklansky", () => {
    const d = decideBySchool("ICM", mkCtx({
      bbStack: 50,
      equity: 0.45,
      requiredEquity: 0.4,
    }));
    expect(d.recommendation).toBe("call");
  });
});

// ─── Exploitative ─────────────────────────────────────────────────────

describe("Exploitative", () => {
  it("tightens against an aggressive table (multiple lions/jackals)", () => {
    // Sklansky baseline: 42% vs 40% → no prune. Exploitative with
    // 3 aggressives raises required by 7.5% → 47.5% → fold.
    const d = decideBySchool("Exploitative", mkCtx({
      equity: 0.42,
      requiredEquity: 0.4,
      tableAnimalTypes: {
        L1: "lion",
        L2: "jackal",
        L3: "lion",
      },
    }));
    expect(d.recommendation).toBe("fold");
  });

  it("loosens against a passive table (multiple mice/elephants)", () => {
    // 35% vs 40% → Sklansky folds. With 3 passives, required drops by 7.5%
    // → 32.5%, so 35% > 32.5% → no longer a fold (recommendation: call).
    const d = decideBySchool("Exploitative", mkCtx({
      equity: 0.35,
      requiredEquity: 0.4,
      tableAnimalTypes: {
        M1: "mouse",
        M2: "elephant",
        M3: "mouse",
      },
    }));
    expect(d.forbidden.has("call")).toBe(false);
  });
});

// ─── Hellmuth ─────────────────────────────────────────────────────────

describe("Hellmuth (the test case the user flagged)", () => {
  it("A-2 offsuit UTG, pot 3, blinds 1/2 — equity vs random heads-up CAN unfold it", () => {
    // Heads-up vs one villain, A2o has ~55% equity vs random; required is 40%.
    // Margin = +15%. NEW Hellmuth rule: not top-10 BUT margin > 5% → call OK.
    // This is the explicit fix for "Hellmuth folds an Ace pre-flop" pathology.
    const me = mkPlayer({
      id: "me",
      holeCards: [c("A", "hearts"), c("2", "clubs")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Hellmuth", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v] }),
      equity: 0.55,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("call")).toBe(false);
    expect(d.recommendation).toBe("call");
  });

  it("A-2 offsuit 4-way (lower equity ~30%): Hellmuth folds", () => {
    const me = mkPlayer({
      id: "me",
      holeCards: [c("A", "hearts"), c("2", "clubs")],
    });
    const v1 = mkPlayer({ id: "v1" });
    const v2 = mkPlayer({ id: "v2" });
    const v3 = mkPlayer({ id: "v3" });
    const d = decideBySchool("Hellmuth", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v1, v2, v3] }),
      activeOpponents: [v1, v2, v3],
      equity: 0.3,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.recommendation).toBe("fold");
    expect(d.forbidden.has("call")).toBe(true);
  });

  it("AA pre-flop: top-10, forbid fold, recommend raise", () => {
    const me = mkPlayer({
      id: "me",
      holeCards: [c("A", "spades"), c("A", "hearts")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Hellmuth", mkCtx({
      me,
      gameState: mkGameState({ players: [me, v] }),
      equity: 0.85,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("fold")).toBe(true);
    expect(d.recommendation).toBe("raise");
  });

  it("post-flop: Hellmuth plays the math, not the soul-read folder", () => {
    const me = mkPlayer({
      id: "me",
      holeCards: [c("8", "spades"), c("8", "hearts")],
    });
    const v = mkPlayer({ id: "v" });
    const d = decideBySchool("Hellmuth", mkCtx({
      me,
      gameState: mkGameState({
        players: [me, v],
        communityCards: [c("8", "diamonds"), c("3", "clubs"), c("2", "hearts")],
      }),
      equity: 0.85,
      requiredEquity: 0.4,
      position: "UTG",
    }));
    expect(d.forbidden.has("fold")).toBe(true);
  });
});

// ─── GTO (smoke test — v1 mirrors Sklansky shape) ─────────────────────

describe("GTO (v1)", () => {
  it("equity-dominant spot: forbid fold", () => {
    const d = decideBySchool("GTO", mkCtx({ equity: 0.6, requiredEquity: 0.4 }));
    expect(d.forbidden.has("fold")).toBe(true);
  });
});
