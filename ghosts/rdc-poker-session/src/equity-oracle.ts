/**
 * Equity oracle — Monte Carlo estimate of `P(my hand wins)` against
 * N opponents on the current board, after the remaining streets run
 * out.
 *
 * Pure function. No Effect, no agent-host coupling, no LLM. Designed
 * so it can be lifted directly back into pokerswarm-ai as a PR.
 *
 * Algorithm:
 *   1. Take the 52-card deck, remove the cards already visible (mine
 *      + community).
 *   2. Repeat `samples` times:
 *      a. Shuffle the remaining deck (seeded PRNG when a seed is given).
 *      b. Deal 2 cards to each opponent.
 *      c. Fill out the community to 5 cards.
 *      d. Evaluate my best 5 + each opponent's best 5 with the
 *         engine's `evaluateHand` + `compareHands`.
 *      e. Score: win = 1, tie split = 1/(1+ties), loss = 0.
 *   3. Equity = totalScore / samples.
 *
 * Why Monte Carlo and not exact enumeration: pre-flop with 1 villain
 * is ~1.7 million boards; with 3 villains it explodes past anything
 * practical for a per-turn call. 2000 samples gives ±~1% standard
 * error which is plenty for action selection.
 */

import {
  compareHands,
  createDeck,
  evaluateHand,
  type Card,
} from "@aie-matrix/ghost-rdc-poker";

export interface EquityRequest {
  /** Your 2 hole cards. */
  readonly holeCards: ReadonlyArray<Card>;
  /** 0, 3, 4, or 5 community cards already visible. */
  readonly communityCards: ReadonlyArray<Card>;
  /** Number of opponents who are still in the hand and will see showdown. */
  readonly opponents: number;
  /** Monte Carlo trial count. Default 2000. */
  readonly samples?: number;
  /** Optional uint32 seed for deterministic equity (tests, replays). */
  readonly seed?: number;
}

export interface EquityResult {
  /** P(win) — wins count fractionally, ties count as 1/(1+tieCount). */
  readonly equity: number;
  /** Pure win fraction (no tie credit). */
  readonly winRate: number;
  /** Pure tie fraction. */
  readonly tieRate: number;
  /** Number of trials actually run. */
  readonly samples: number;
}

/**
 * Estimate `P(my hand wins or ties favorably at showdown)`.
 *
 * Validation rules:
 *   - exactly 2 hole cards
 *   - 0, 3, 4, or 5 community cards (preflop / flop / turn / river)
 *   - opponents ≥ 0
 *   - no duplicate cards in hole + community
 *   - enough cards left in the deck to deal opponents + fill the board
 * Throws `Error` on violation — callers should catch and fall back.
 */
export function estimateEquity(req: EquityRequest): EquityResult {
  const hole = [...req.holeCards];
  const community = [...req.communityCards];
  const opponents = req.opponents;
  const samples = req.samples ?? 2000;

  if (hole.length !== 2) {
    throw new Error(`equity: expected 2 hole cards, got ${hole.length}`);
  }
  if (![0, 3, 4, 5].includes(community.length)) {
    throw new Error(
      `equity: community must be 0/3/4/5 cards, got ${community.length}`,
    );
  }
  if (opponents < 0 || !Number.isInteger(opponents)) {
    throw new Error(`equity: opponents must be non-negative int, got ${opponents}`);
  }
  if (samples <= 0 || !Number.isInteger(samples)) {
    throw new Error(`equity: samples must be positive int, got ${samples}`);
  }

  const knownCards = [...hole, ...community];
  assertNoDuplicateCards(knownCards);

  const knownKeySet = new Set(knownCards.map(cardKey));
  const remainingDeck: Card[] = createDeck().filter(
    (c) => !knownKeySet.has(cardKey(c)),
  );

  const boardCardsNeeded = 5 - community.length;
  const cardsNeededPerSample = opponents * 2 + boardCardsNeeded;
  if (cardsNeededPerSample > remainingDeck.length) {
    throw new Error(
      `equity: not enough cards in deck (need ${cardsNeededPerSample}, ` +
        `have ${remainingDeck.length})`,
    );
  }

  // Trivial fast paths.
  if (opponents === 0) {
    // No opponents → you always "win" by default. Return 1.0.
    return { equity: 1, winRate: 1, tieRate: 0, samples: 0 };
  }
  if (samples === 0) {
    return { equity: 0, winRate: 0, tieRate: 0, samples: 0 };
  }

  const rand = makeRng(req.seed);

  let wins = 0;
  let ties = 0;
  let scoreSum = 0; // weighted by tie-split

  // Pre-allocate the working deck once. We shuffle it in place each sample.
  const work: Card[] = remainingDeck.slice();

  for (let s = 0; s < samples; s++) {
    // Partial Fisher–Yates: only need the first `cardsNeededPerSample` cards.
    // Saves time vs shuffling the entire remaining deck.
    for (let i = 0; i < cardsNeededPerSample; i++) {
      const j = i + Math.floor(rand() * (work.length - i));
      const tmp = work[i]!;
      work[i] = work[j]!;
      work[j] = tmp;
    }

    // Deal opponent hole cards.
    const opponentHoles: Card[][] = [];
    let cursor = 0;
    for (let o = 0; o < opponents; o++) {
      opponentHoles.push([work[cursor]!, work[cursor + 1]!]);
      cursor += 2;
    }

    // Fill the board.
    const filledBoard: Card[] = community.slice();
    for (let i = 0; i < boardCardsNeeded; i++) {
      filledBoard.push(work[cursor]!);
      cursor += 1;
    }

    // Evaluate everybody.
    const myEval = evaluateHand(hole, filledBoard);
    let bestOpponentEval = evaluateHand(opponentHoles[0]!, filledBoard);
    for (let o = 1; o < opponents; o++) {
      const e = evaluateHand(opponentHoles[o]!, filledBoard);
      if (compareHands(e, bestOpponentEval) > 0) bestOpponentEval = e;
    }

    // Compare. Count ties among opponents I'm tied with so the split is
    // correct (e.g. 3-way chop with one villain at my level = 1/2 share,
    // not 1/3 — chopped pots split between hands of equal rank only).
    const cmp = compareHands(myEval, bestOpponentEval);
    if (cmp > 0) {
      wins++;
      scoreSum += 1;
    } else if (cmp === 0) {
      ties++;
      // Count how many opponents share the top hand with me.
      let tieCount = 1; // me
      for (let o = 0; o < opponents; o++) {
        const e = evaluateHand(opponentHoles[o]!, filledBoard);
        if (compareHands(e, myEval) === 0) tieCount++;
      }
      scoreSum += 1 / tieCount;
    }
    // loss: nothing
  }

  return {
    equity: scoreSum / samples,
    winRate: wins / samples,
    tieRate: ties / samples,
    samples,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

function cardKey(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

function assertNoDuplicateCards(cards: ReadonlyArray<Card>): void {
  const seen = new Set<string>();
  for (const c of cards) {
    const k = cardKey(c);
    if (seen.has(k)) {
      throw new Error(`equity: duplicate card ${k} in hole+community`);
    }
    seen.add(k);
  }
}

/**
 * Mulberry32 — small, fast, well-distributed seeded PRNG. Used so unit
 * tests can pin equity values to a known seed and not flake. When the
 * caller passes no seed we fall through to `Math.random` so production
 * calls behave normally.
 */
function makeRng(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── pot-odds helper (companion to equity) ────────────────────────────

export interface PotOdds {
  /** Equity threshold the call needs to break even. 0..1. */
  readonly requiredEquity: number;
  /** Same number as a percentage rounded to 1 decimal, for prompts. */
  readonly requiredEquityPct: number;
}

/**
 * Pot odds: the minimum equity a call needs to be break-even.
 *
 * `callAmount` is what you must put in. `potBeforeCall` is everything
 * already in the pot (including any bets from this street). Required
 * equity is `call / (call + pot)`.
 *
 * Pure utility; exposed here so callers don't have to import it from
 * the school-rules module separately.
 */
export function potOdds(callAmount: number, potBeforeCall: number): PotOdds {
  if (callAmount <= 0) {
    return { requiredEquity: 0, requiredEquityPct: 0 };
  }
  const required = callAmount / (callAmount + potBeforeCall);
  return {
    requiredEquity: required,
    requiredEquityPct: Math.round(required * 1000) / 10,
  };
}
