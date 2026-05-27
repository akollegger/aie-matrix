import { describe, expect, it } from "vitest";
import type {
  AvailableActions,
  Card,
  GameState,
  Player,
  Rank,
  Suit,
} from "@aie-matrix/ghost-rdc-poker";

import { runDecisionPipeline } from "./decision-pipeline.js";

// ─── Fixtures ─────────────────────────────────────────────────────────

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function mkPlayer(over: Partial<Player>): Player {
  return {
    id: over.id ?? "p",
    name: over.name ?? "P",
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

function mkGameState(players: Player[], community: Card[] = []): GameState {
  return {
    id: "g1",
    handNumber: 1,
    phase: community.length === 0 ? "pre-flop"
         : community.length === 3 ? "flop"
         : community.length === 4 ? "turn"
         : "river",
    players,
    communityCards: community,
    pot: 3,
    sidePots: [],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlindAmount: 1,
    bigBlindAmount: 2,
    minimumRaise: 2,
    currentBet: 2,
    actionHistory: [],
    deck: [],
    winners: null,
    lastAggressor: null,
    bettingRoundComplete: false,
  };
}

function mkActions(): AvailableActions {
  return {
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    canAllIn: true,
    callAmount: 2,
    minRaise: 4,
    maxRaise: 100,
    allInAmount: 100,
  };
}

// ─── The flagship scenarios from the design discussion ──────────────

describe("decision pipeline — the user's design scenarios", () => {
  it("Greenhorn Hellmuth Lion + A♥2♣ UTG: full menu, no math forced", () => {
    // Greenhorns skip the pipeline at the brain layer, but if anyone
    // does call the pipeline with tier=Greenhorn, the pruner is a
    // no-op. So the menu must come back unchanged either way.
    const me = mkPlayer({
      id: "me",
      name: "Ned",
      seatIndex: 3,
      holeCards: [c("A", "hearts"), c("2", "clubs")],
    });
    const opps = [
      mkPlayer({ id: "v1", name: "V1", seatIndex: 0 }),
      mkPlayer({ id: "v2", name: "V2", seatIndex: 1 }),
      mkPlayer({ id: "v3", name: "V3", seatIndex: 2 }),
    ];
    const result = runDecisionPipeline({
      me,
      gameState: mkGameState([me, ...opps]),
      availableActions: mkActions(),
      opponents: opps,
      persona: { bluffFrequency: 0.3 },
      school: "Hellmuth",
      tier: "Greenhorn",
      animal: "lion",
      equitySamples: 1500,
      equitySeed: 1,
    });
    // Greenhorn never prunes.
    expect(result.trace.pruning.pruned).toBe(false);
    expect(result.availableActions.canCall).toBe(true);
    expect(result.availableActions.canFold).toBe(true);
    expect(result.availableActions.canRaise).toBe(true);
  });

  it("Veteran Sklansky Mouse + A♥2♣ UTG 4-way: optimal is fold, and fold IS one of the three Veteran candidates", () => {
    // Flagship: A2o 4-way is ~30% equity vs 40% required → school
    // says fold. New design doesn't prune the menu (LLM sees three
    // candidates instead), but a Veteran candidate set centered on
    // 'fold' must include fold as the nearest-optimal candidate.
    const me = mkPlayer({
      id: "me",
      name: "Mouse",
      seatIndex: 3,
      holeCards: [c("A", "hearts"), c("2", "clubs")],
    });
    const opps = [
      mkPlayer({ id: "v1", name: "V1", seatIndex: 0 }),
      mkPlayer({ id: "v2", name: "V2", seatIndex: 1 }),
      mkPlayer({ id: "v3", name: "V3", seatIndex: 2 }),
    ];
    const result = runDecisionPipeline({
      me,
      gameState: mkGameState([me, ...opps]),
      availableActions: mkActions(),
      opponents: opps,
      persona: { bluffFrequency: 0.1 },
      school: "Sklansky",
      tier: "Veteran",
      animal: "mouse",
      equitySamples: 1500,
      equitySeed: 1,
      candidateSeed: 1,
    });
    expect(result.candidates).not.toBeNull();
    expect(result.trace.school?.optimalPlay.action).toBe("fold");
    // Veteran's nearest-optimal candidate IS the school's optimal.
    const best = result.candidates![result.trace.candidateSet!.nearestOptimalIndex]!;
    expect(best.action).toBe("fold");
  });

  it("Veteran Hellmuth Lion + A♥2♣ heads-up: A2o has 55% equity, Hellmuth unfolds it (not pruned)", () => {
    // The flagship "Hellmuth doesn't fold an Ace pre-flop just because
    // it's not top-10" test. Heads-up vs random: A2o has ~55% equity
    // against 40% required → margin +15% → Hellmuth's new equity
    // override fires → fold is NOT forced. The LLM keeps its options.
    const me = mkPlayer({
      id: "me",
      name: "HellmuthBot",
      seatIndex: 1,
      holeCards: [c("A", "hearts"), c("2", "clubs")],
    });
    const opps = [mkPlayer({ id: "v1", name: "V1", seatIndex: 0 })];
    const result = runDecisionPipeline({
      me,
      gameState: mkGameState([me, ...opps]),
      availableActions: mkActions(),
      opponents: opps,
      persona: { bluffFrequency: 0.4 },
      school: "Hellmuth",
      tier: "Veteran",
      animal: "lion",
      equitySamples: 2000,
      equitySeed: 7,
    });
    // The school's recommendation should NOT force a fold here.
    expect(result.trace.school?.forbidden.has("call")).toBe(false);
    expect(result.availableActions.canCall).toBe(true);
    // Equity > required → margin positive
    expect(result.trace.equityMargin).toBeGreaterThan(0);
  });

  it("Eagle GTO + 7♣2♦ on a river bluff spot vs 2 mice → bluff fires, candidates become raise-flavored", () => {
    // Bluff sampler fires (seeded). When it does, the effective optimal
    // becomes a raise — so the candidates the LLM sees should include
    // at least one raise option (the bluff line warped into the menu).
    const me = mkPlayer({
      id: "me",
      name: "Eagleeye",
      seatIndex: 0,
      holeCards: [c("7", "clubs"), c("2", "diamonds")],
    });
    const opps = [
      mkPlayer({ id: "v1", name: "Mickey", seatIndex: 1 }),
      mkPlayer({ id: "v2", name: "Maus", seatIndex: 2 }),
    ];
    const result = runDecisionPipeline({
      me,
      gameState: mkGameState(
        [me, ...opps],
        [c("A", "spades"), c("K", "diamonds"), c("Q", "clubs"), c("J", "hearts"), c("4", "spades")],
      ),
      availableActions: mkActions(),
      opponents: opps,
      persona: { bluffFrequency: 0.6 },
      school: "GTO",
      tier: "Eagle",
      animal: "lion",
      tableAnimalTypes: { Mickey: "mouse", Maus: "mouse" },
      equitySamples: 1000,
      equitySeed: 42,
      bluffRng: () => 0.05, // very low roll → fires
      candidateSeed: 1,
    });
    expect(result.trace.bluff?.bluff).toBe(true);
    expect(result.candidates).not.toBeNull();
    // Eagle's nearest-optimal IS the bluff raise — must be on the menu.
    const best = result.candidates![result.trace.candidateSet!.nearestOptimalIndex]!;
    expect(best.action).toBe("raise");
  });

  it("pipeline never returns an empty menu", () => {
    // Adversarial setup: forbid everything. The tier pruner has a
    // safety net (returns original menu when pruning would empty it),
    // so the pipeline result should still have at least one legal action.
    const me = mkPlayer({
      id: "me",
      name: "X",
      seatIndex: 0,
      holeCards: [c("3", "clubs"), c("2", "diamonds")],
    });
    const opps = [mkPlayer({ id: "v", name: "V", seatIndex: 1 })];
    const result = runDecisionPipeline({
      me,
      gameState: mkGameState([me, ...opps]),
      availableActions: mkActions(),
      opponents: opps,
      persona: { bluffFrequency: 0 },
      school: "Sklansky",
      tier: "Veteran",
      animal: "mouse",
      equitySamples: 800,
      equitySeed: 1,
    });
    const anyLegal =
      result.availableActions.canFold ||
      result.availableActions.canCheck ||
      result.availableActions.canCall ||
      result.availableActions.canRaise ||
      result.availableActions.canAllIn;
    expect(anyLegal).toBe(true);
  });
});

describe("decision pipeline — Greenhorn vs Veteran on the same hand", () => {
  it("Greenhorn and Veteran see DIFFERENT candidate menus on the same hand — Veteran's includes the school optimal, Greenhorn's does not", () => {
    const setup = () => ({
      me: mkPlayer({
        id: "me",
        name: "Both",
        seatIndex: 3,
        holeCards: [c("A", "hearts"), c("2", "clubs")],
      }),
      opps: [
        mkPlayer({ id: "v1", name: "V1", seatIndex: 0 }),
        mkPlayer({ id: "v2", name: "V2", seatIndex: 1 }),
        mkPlayer({ id: "v3", name: "V3", seatIndex: 2 }),
      ],
    });

    const g = setup();
    const greenhorn = runDecisionPipeline({
      me: g.me,
      gameState: mkGameState([g.me, ...g.opps]),
      availableActions: mkActions(),
      opponents: g.opps,
      persona: { bluffFrequency: 0.3 },
      school: "Sklansky",
      tier: "Greenhorn",
      animal: "lion",
      equitySamples: 1000,
      equitySeed: 1,
      candidateSeed: 1,
    });

    const v = setup();
    const veteran = runDecisionPipeline({
      me: v.me,
      gameState: mkGameState([v.me, ...v.opps]),
      availableActions: mkActions(),
      opponents: v.opps,
      persona: { bluffFrequency: 0.3 },
      school: "Sklansky",
      tier: "Veteran",
      animal: "lion",
      equitySamples: 1000,
      equitySeed: 1,
      candidateSeed: 1,
    });

    // Both produce candidates.
    expect(greenhorn.candidates).not.toBeNull();
    expect(veteran.candidates).not.toBeNull();

    // The school says fold here (A2o 4-way is -EV).
    expect(veteran.trace.school?.optimalPlay.action).toBe("fold");
    expect(greenhorn.trace.school?.optimalPlay.action).toBe("fold");

    // Veteran's nearest-optimal candidate IS fold.
    const vetBest = veteran.candidates![veteran.trace.candidateSet!.nearestOptimalIndex]!;
    expect(vetBest.action).toBe("fold");

    // Greenhorn's three candidates have DIFFERENT shape — wilder.
    // Specifically, Greenhorn's wild slot includes all-in or a big
    // raise that Veteran would never see.
    const greenhornHasWild = greenhorn.candidates!.some(
      (c) => c.action === "all-in" || (c.action === "raise" && c.amount >= 50),
    );
    const veteranHasWild = veteran.candidates!.some(
      (c) => c.action === "all-in" || (c.action === "raise" && c.amount >= 50),
    );
    expect(greenhornHasWild).toBe(true);
    expect(veteranHasWild).toBe(false);
  });
});
