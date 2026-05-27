/**
 * School decision rules — each school takes a snapshot of the spot
 * (equity, pot odds, position, stack, persona, opponent reads) and
 * emits a `SchoolDecision`:
 *
 *   - `recommendation` — the action the school would pick if asked
 *     "what's right?"
 *   - `forbidden` — actions the school considers mechanically wrong
 *     in this spot (used by the tier wrapper at Veteran+ to prune
 *     the LLM's menu)
 *   - `reasonLines` — human-readable explanation lines, injected into
 *     the prompt so the LLM and the spectator see the school's
 *     working
 *
 * Important design constraint: schools may DISAGREE on close spots,
 * and they may all be wrong sometimes — that's the point. But every
 * school is at least equity-aware: nobody folds 70% equity into a
 * 25%-required pot just because the hand isn't on a list.
 *
 * Pure functions. No Effect, no agent-host coupling. Intended to be
 * PR-portable to pokerswarm-ai.
 */

import type {
  AvailableActions,
  GameState,
  Player,
  Card,
  Rank,
} from "@aie-matrix/ghost-rdc-poker";

import type { AnimalType } from "./hellmuth-profile.js";
import type { MathSchool } from "./math-schools.js";

// ─── public types ─────────────────────────────────────────────────────

/** What a poker brain may pick. Same enum as the engine. */
export type PokerAction = "fold" | "check" | "call" | "raise" | "all-in";

/** A concrete play — action + amount (amount = 0 for fold/check; the
 *  amount the caller should pass into the engine for call/raise/all-in).
 *  This is what the candidate generator warps and the LLM ultimately picks
 *  from a menu of three. */
export interface SchoolPlay {
  readonly action: PokerAction;
  readonly amount: number;
}

/**
 * A school's read on the current spot.
 *
 *   - `optimalPlay`     — the school's ground-truth answer for this hand,
 *                         {action, amount}. Used by the candidate generator
 *                         as the un-warped center the noob's options drift
 *                         away from.
 *   - `forbidden`       — legacy hint set (kept for back-compat with the
 *                         tier-pruner; the new candidate generator doesn't
 *                         need it, but we keep emitting it so existing tests
 *                         and the trace overlay stay readable).
 *   - `recommendation`  — alias for `optimalPlay.action`. Legacy.
 *   - `reasonLines`     — human-readable rationale for the prompt + trace.
 */
export interface SchoolDecision {
  readonly school: MathSchool;
  readonly recommendation: PokerAction;
  readonly optimalPlay: SchoolPlay;
  readonly forbidden: ReadonlySet<PokerAction>;
  /** One line per logical step. Goes into the prompt and the trace. */
  readonly reasonLines: ReadonlyArray<string>;
}

export interface SchoolContext {
  readonly me: Player;
  readonly gameState: GameState;
  readonly availableActions: AvailableActions;
  /** Equity = 0..1 from estimateEquity. */
  readonly equity: number;
  /** Required equity = 0..1 from potOdds. */
  readonly requiredEquity: number;
  /** Position label ("UTG"/"MP"/"HJ"/"CO"/"BTN"/"SB"/"BB"/"BTN/SB"). */
  readonly position: string;
  /** Big-blind-normalized stack size. */
  readonly bbStack: number;
  /** Opponents still in the hand (excludes me, excludes folded). */
  readonly activeOpponents: ReadonlyArray<Player>;
  /** Optional opponent-tendency lines from the orchestrator. */
  readonly opponentReads?: ReadonlyArray<string>;
  /** Optional table-wide Hellmuth animal types. */
  readonly tableAnimalTypes?: Readonly<Record<string, AnimalType>>;
}

/**
 * Dispatch entry point. Routes to the school-specific rule.
 */
export function decideBySchool(
  school: MathSchool,
  ctx: SchoolContext,
): SchoolDecision {
  switch (school) {
    case "Sklansky":    return ruleSklansky(ctx);
    case "Chen":        return ruleChen(ctx);
    case "Harrington":  return ruleHarrington(ctx);
    case "GTO":         return ruleGTO(ctx);
    case "ICM":         return ruleICM(ctx);
    case "Exploitative":return ruleExploitative(ctx);
    case "Hellmuth":    return ruleHellmuth(ctx);
  }
}

// ─── shared helpers ───────────────────────────────────────────────────

/** The action set the engine currently allows, normalized to a Set. */
function legalSet(a: AvailableActions): Set<PokerAction> {
  const s = new Set<PokerAction>();
  if (a.canFold) s.add("fold");
  if (a.canCheck) s.add("check");
  if (a.canCall) s.add("call");
  if (a.canRaise) s.add("raise");
  if (a.canAllIn) s.add("all-in");
  return s;
}

/**
 * Pure equity vs pot-odds verdict — the base every school can fall
 * back to when no school-specific rule fires.
 *
 *   margin = equity − requiredEquity
 *
 *   margin > +0.15 → bet/raise for value (forbid fold and check)
 *   margin > +0.05 → call profitably (forbid fold; allow raise/call)
 *   margin > -0.05 → coin-flip zone, any action allowed
 *   margin ≤ -0.05 → fold (forbid call and raise)
 *
 * When `canCheck` is true (no bet to face), nothing is forbidden —
 * checking is always free and ≥ folding.
 */
function recByEquityMargin(ctx: SchoolContext): {
  rec: PokerAction;
  forbidden: Set<PokerAction>;
  marginPct: number;
} {
  const margin = ctx.equity - ctx.requiredEquity;
  const marginPct = Math.round(margin * 1000) / 10;
  const legal = legalSet(ctx.availableActions);
  const forbidden = new Set<PokerAction>();

  // Free street — checking is always available, so we never prune
  // anything (folding is silly, calling is checking, raising is
  // optional). For the recommendation, the margin metric is
  // misleading when required equity is near zero — a 20% equity hand
  // has a 20-point margin over a 0% requirement, but 20% equity
  // doesn't deserve a value-raise. Gate raise recommendation on
  // absolute equity (≥ 60%) as well as margin.
  if (ctx.availableActions.canCheck) {
    const rec: PokerAction = ctx.equity >= 0.6 ? "raise" : "check";
    return { rec, forbidden, marginPct };
  }

  if (margin > 0.15) {
    forbidden.add("fold");
    return { rec: legal.has("raise") ? "raise" : "call", forbidden, marginPct };
  }
  if (margin > 0.05) {
    forbidden.add("fold");
    return { rec: "call", forbidden, marginPct };
  }
  if (margin > -0.05) {
    return { rec: "call", forbidden, marginPct };
  }
  forbidden.add("call");
  forbidden.add("raise");
  return { rec: "fold", forbidden, marginPct };
}

function equityLine(ctx: SchoolContext, marginPct: number): string {
  const eqPct = Math.round(ctx.equity * 1000) / 10;
  const reqPct = Math.round(ctx.requiredEquity * 1000) / 10;
  return `- Equity ${eqPct}% vs required ${reqPct}% → margin ${marginPct > 0 ? "+" : ""}${marginPct}%`;
}

/** Clamp a proposed raise amount to the legal range. */
function clampRaise(amount: number, ctx: SchoolContext): number {
  const a = ctx.availableActions;
  if (!a.canRaise) return 0;
  return Math.max(a.minRaise, Math.min(amount, a.maxRaise));
}

/**
 * Convert a (rec, schoolSizingMultiplier) into a concrete SchoolPlay.
 *
 * `sizingMult` is the school's *pot-fraction multiplier* for raises:
 *   1.0 = full pot, 0.66 = 2/3 pot, 2.5 = pre-flop 2.5x BB, etc.
 *
 * For pre-flop spots with no community cards, we size in BB units
 * (3x BB is the canonical "standard open"). For post-flop, we size
 * as a fraction of the current pot (2/3 pot is the canonical "value
 * bet"). The school passes the appropriate factor.
 *
 * For fold/check/call, amount is fixed by the engine.
 */
function makePlay(
  action: PokerAction,
  ctx: SchoolContext,
  raiseSize?: { preflopBB?: number; postflopPotFraction?: number; absolute?: number },
): SchoolPlay {
  if (action === "fold" || action === "check") return { action, amount: 0 };
  if (action === "call") return { action, amount: ctx.availableActions.callAmount };
  if (action === "all-in") return { action, amount: ctx.availableActions.allInAmount };

  // action === "raise"
  if (!raiseSize) {
    // No sizing given — default to 2/3 pot post-flop, 3x BB pre-flop.
    raiseSize = isPreflop(ctx)
      ? { preflopBB: 3 }
      : { postflopPotFraction: 0.66 };
  }
  if (raiseSize.absolute !== undefined) {
    return { action: "raise", amount: clampRaise(raiseSize.absolute, ctx) };
  }
  if (raiseSize.preflopBB !== undefined) {
    const bb = ctx.gameState.bigBlindAmount;
    const target = Math.round(raiseSize.preflopBB * bb);
    return { action: "raise", amount: clampRaise(target, ctx) };
  }
  if (raiseSize.postflopPotFraction !== undefined) {
    const target = Math.round(
      (ctx.gameState.pot + ctx.availableActions.callAmount) *
        raiseSize.postflopPotFraction +
        ctx.availableActions.callAmount,
    );
    return { action: "raise", amount: clampRaise(target, ctx) };
  }
  return { action: "raise", amount: clampRaise(ctx.availableActions.minRaise, ctx) };
}

// Pre-flop hole-card shape helpers (cheap; used by several schools).
const RANK_NUM: Readonly<Record<Rank, number>> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

interface HoleShape {
  hi: number;
  lo: number;
  suited: boolean;
  pair: boolean;
  gap: number;
}

function holeShape(holes: ReadonlyArray<Card>): HoleShape | null {
  if (holes.length !== 2) return null;
  const [a, b] = holes as [Card, Card];
  const ra = RANK_NUM[a.rank];
  const rb = RANK_NUM[b.rank];
  return {
    hi: Math.max(ra, rb),
    lo: Math.min(ra, rb),
    suited: a.suit === b.suit,
    pair: ra === rb,
    gap: Math.abs(ra - rb),
  };
}

function isPreflop(ctx: SchoolContext): boolean {
  return ctx.gameState.communityCards.length === 0;
}

// ─── Sklansky ─────────────────────────────────────────────────────────

/**
 * Sklansky — strict mathematical play. Equity vs pot odds is the
 * gospel. No "Sklansky group 8 always plays" rigidity here; the group
 * tables are just baseline awareness. The math always wins.
 *
 * Sizing: 3x BB pre-flop (textbook open); 2/3 pot post-flop (textbook
 * value bet). Tight & by-the-book.
 */
function ruleSklansky(ctx: SchoolContext): SchoolDecision {
  const { rec, forbidden, marginPct } = recByEquityMargin(ctx);
  const sizing = isPreflop(ctx)
    ? { preflopBB: 3 }
    : { postflopPotFraction: 0.66 };
  const lines = [
    "## Slim Lansky reads the spot",
    equityLine(ctx, marginPct),
    "- Doctrine: play as if you could see the cards. If the price is right, call; if it isn't, fold.",
  ];
  return {
    school: "Sklansky",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizing),
    forbidden,
    reasonLines: lines,
  };
}

// ─── Chen ─────────────────────────────────────────────────────────────

/** Bill Chen's starting-hand formula. */
function chenScore(holes: ReadonlyArray<Card>): number {
  const s = holeShape(holes);
  if (!s) return 0;
  const hiRankFace = (() => {
    if (s.hi === 14) return 10;
    if (s.hi === 13) return 8;
    if (s.hi === 12) return 7;
    if (s.hi === 11) return 6;
    return s.hi / 2;
  })();
  let pts = hiRankFace;
  if (s.pair) pts = Math.max(5, pts * 2);
  if (s.suited) pts += 2;
  if (!s.pair) {
    if (s.gap === 1) pts += 0;
    else if (s.gap === 2) pts -= 1;
    else if (s.gap === 3) pts -= 2;
    else if (s.gap >= 4) pts -= 5;
    if (s.gap <= 2 && s.hi < 12) pts += 1;
  }
  return Math.round(pts * 10) / 10;
}

/**
 * Chen — pre-flop hand-strength formula. Post-flop falls back to
 * equity-vs-pot-odds. The point of difference: pre-flop, Chen will
 * play looser than equity alone suggests when the score is borderline,
 * because the formula bakes in implied odds.
 */
function ruleChen(ctx: SchoolContext): SchoolDecision {
  if (!isPreflop(ctx)) {
    const { rec, forbidden, marginPct } = recByEquityMargin(ctx);
    return {
      school: "Chen",
      recommendation: rec,
      optimalPlay: makePlay(rec, ctx, { postflopPotFraction: 0.66 }),
      forbidden,
      reasonLines: [
        "## Chen reads the spot",
        equityLine(ctx, marginPct),
        "- Post-flop, the score's done its work — play the math.",
      ],
    };
  }

  const score = chenScore(ctx.me.holeCards ?? []);
  const latePos = ["BTN", "CO", "HJ"].includes(ctx.position);
  const legal = legalSet(ctx.availableActions);
  const forbidden = new Set<PokerAction>();
  let rec: PokerAction;
  let verdict: string;

  if (score >= 8) {
    rec = legal.has("raise") ? "raise" : "call";
    forbidden.add("fold");
    verdict = `raise — Chen ≥ 8`;
  } else if (score >= 5 && latePos) {
    rec = legal.has("call") ? "call" : "check";
    verdict = `call from late position — Chen 5-7.9`;
  } else if (score >= 5) {
    // Score 5-7 from early position — Chen says fold.
    rec = "fold";
    forbidden.add("call");
    forbidden.add("raise");
    verdict = `fold from early — Chen 5-7.9`;
  } else {
    rec = "fold";
    forbidden.add("call");
    forbidden.add("raise");
    verdict = `fold — Chen < 5`;
  }

  // EQUITY OVERRIDE — Chen rigidity loses to free money. If the math
  // is strongly +EV (margin > 15%), don't fold a winning hand because
  // the formula said so.
  if (forbidden.has("call") && ctx.equity - ctx.requiredEquity > 0.15) {
    forbidden.delete("call");
    forbidden.delete("raise");
    rec = "call";
    verdict += ` (overridden — equity ${Math.round(ctx.equity * 100)}% is too good to fold)`;
  }

  const { marginPct } = recByEquityMargin(ctx);
  // Chen sizing: 4x BB pre-flop when raising (a touch more aggressive
  // than Sklansky's textbook 3x — Chen advocates for confident open-
  // sizing once the score commits you to the hand).
  return {
    school: "Chen",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, { preflopBB: 4 }),
    forbidden,
    reasonLines: [
      "## Chen reads the spot",
      `- Chen score: ${score.toFixed(1)} → ${verdict}`,
      equityLine(ctx, marginPct),
      "- Discipline: trust the numbers, not the table mood.",
    ],
  };
}

// ─── Harrington (M-zone) ─────────────────────────────────────────────

interface MZone {
  label: "green" | "yellow" | "orange" | "red";
  nudge: string;
}

function mZoneOf(bbStack: number): MZone {
  // No antes in this game so M ≈ stack / (sb + bb) ≈ bbStack * 2/3.
  // Use bbStack directly; thresholds widened proportionally.
  if (bbStack >= 30) return { label: "green", nudge: "play standard, value-heavy" };
  if (bbStack >= 15) return { label: "yellow", nudge: "open up; fewer speculative calls" };
  if (bbStack >= 7) return { label: "orange", nudge: "raise or fold — stop calling" };
  return { label: "red", nudge: "push-or-fold only" };
}

/**
 * Harrington — M-zone dictates the action shape.
 *
 *   green   : equity vs pot odds, standard
 *   yellow  : equity vs pot odds, slightly looser (no extra constraint)
 *   orange  : forbid CALL (raise or fold; stop bleeding by limping)
 *   red     : forbid CALL and CHECK (push or fold)
 */
function ruleHarrington(ctx: SchoolContext): SchoolDecision {
  const zone = mZoneOf(ctx.bbStack);
  const { rec: baseRec, forbidden, marginPct } = recByEquityMargin(ctx);
  const legal = legalSet(ctx.availableActions);
  let rec: PokerAction = baseRec;

  if (zone.label === "orange") {
    forbidden.add("call");
    if (rec === "call") {
      rec = ctx.equity - ctx.requiredEquity > 0 && legal.has("raise") ? "raise" : "fold";
    }
  } else if (zone.label === "red") {
    forbidden.add("call");
    forbidden.add("check");
    if (rec === "call" || rec === "check") {
      rec = ctx.equity > 0.5 && legal.has("all-in") ? "all-in"
          : legal.has("raise") ? "raise"
          : "fold";
    }
  }

  // Harrington sizing reflects the zone:
  //   green  : standard 3x BB pre / 2/3 pot post
  //   yellow : 3.5x BB pre / 3/4 pot post (apply pressure)
  //   orange : push-or-fold pre-flop (all-in equivalent of raise)
  //   red    : same (push-or-fold)
  const sizingByZone = ((): { preflopBB?: number; postflopPotFraction?: number; absolute?: number } => {
    if (zone.label === "green") {
      return isPreflop(ctx) ? { preflopBB: 3 } : { postflopPotFraction: 0.66 };
    }
    if (zone.label === "yellow") {
      return isPreflop(ctx) ? { preflopBB: 3.5 } : { postflopPotFraction: 0.75 };
    }
    // orange/red — when the rec is raise, target all-in.
    return { absolute: ctx.availableActions.allInAmount };
  })();
  return {
    school: "Harrington",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizingByZone),
    forbidden,
    reasonLines: [
      "## Harrington reads the spot",
      `- Stack: ${ctx.bbStack.toFixed(1)} BB → **${zone.label.toUpperCase()} zone** — ${zone.nudge}`,
      equityLine(ctx, marginPct),
    ],
  };
}

// ─── GTO ──────────────────────────────────────────────────────────────

/**
 * GTO — strict equity-vs-pot-odds without exploitation. The doctrine
 * is "be unexploitable": don't deviate based on table mood. Same
 * shape as Sklansky in v1; the differentiating bluff/value mix lives
 * in the bluff sampler (Eagle-tier only).
 */
function ruleGTO(ctx: SchoolContext): SchoolDecision {
  const { rec, forbidden, marginPct } = recByEquityMargin(ctx);
  // GTO sizing — balanced. 2.5x BB pre, 1/2 pot post (smaller for
  // balance / equity-realization concerns; the GTO-flavored sizing
  // is famously a touch smaller than older value-bet doctrine).
  const sizing = isPreflop(ctx)
    ? { preflopBB: 2.5 }
    : { postflopPotFraction: 0.5 };
  return {
    school: "GTO",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizing),
    forbidden,
    reasonLines: [
      "## GTO reads the spot",
      `- Position: ${ctx.position}`,
      equityLine(ctx, marginPct),
      "- Doctrine: stay balanced. Don't deviate to read.",
    ],
  };
}

// ─── ICM ──────────────────────────────────────────────────────────────

/**
 * ICM — survival weighting. Marginal +EV chip plays are -EV in
 * tournament-equity terms when the stack is short. Implemented as an
 * additive equity penalty: short stacks need a fatter margin to call.
 *
 *   bbStack < 10  : penalty +12% (need margin > +12% to call)
 *   bbStack < 20  : penalty +5%
 *   else          : no penalty
 */
function ruleICM(ctx: SchoolContext): SchoolDecision {
  const penalty =
    ctx.bbStack < 10 ? 0.12
    : ctx.bbStack < 20 ? 0.05
    : 0;

  const adjustedRequired = Math.min(0.95, ctx.requiredEquity + penalty);
  const adjustedCtx: SchoolContext = { ...ctx, requiredEquity: adjustedRequired };
  const { rec, forbidden, marginPct } = recByEquityMargin(adjustedCtx);

  const lines = ["## ICM reads the spot"];
  lines.push(`- Stack: ${ctx.bbStack.toFixed(1)} BB`);
  if (penalty > 0) {
    lines.push(
      `- Survival penalty: +${Math.round(penalty * 100)}% to required equity → need ${Math.round(adjustedRequired * 100)}% (was ${Math.round(ctx.requiredEquity * 100)}%)`,
    );
  }
  lines.push(equityLine(adjustedCtx, marginPct));
  lines.push("- Doctrine: surviving outweighs marginal +EV.");
  // ICM sizing — small stacks shove rather than raise small; healthy
  // stacks open standard.
  const sizing = ctx.bbStack < 10
    ? { absolute: ctx.availableActions.allInAmount }
    : isPreflop(ctx)
      ? { preflopBB: 2.5 }
      : { postflopPotFraction: 0.5 };
  return {
    school: "ICM",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizing),
    forbidden,
    reasonLines: lines,
  };
}

// ─── Exploitative ─────────────────────────────────────────────────────

/**
 * Exploitative — adjust equity threshold by table read. The simplest
 * mechanical signal we have is the count of animal types at the
 * table.
 *
 *   Many mice/elephants (passive)   → looser (penalty -0.05)
 *   Many lions/jackals (aggressive) → tighter (penalty +0.05)
 *
 * Adjustment is bounded ±0.10 so the table never flips the answer
 * completely on its own.
 */
function ruleExploitative(ctx: SchoolContext): SchoolDecision {
  const animals = ctx.tableAnimalTypes ?? {};
  let passive = 0;
  let aggressive = 0;
  for (const a of Object.values(animals)) {
    if (a === "mouse" || a === "elephant") passive++;
    else if (a === "lion" || a === "jackal") aggressive++;
  }
  // Net adjustment to required equity. Negative = exploit weak field.
  const net = (aggressive - passive) * 0.025;
  const adjusted = Math.max(0, Math.min(0.95, ctx.requiredEquity + net));
  const adjustedCtx: SchoolContext = { ...ctx, requiredEquity: adjusted };
  const { rec, forbidden, marginPct } = recByEquityMargin(adjustedCtx);

  const lines = ["## Exploitative reads the spot"];
  if (passive + aggressive > 0) {
    lines.push(
      `- Table read: ${passive} passive, ${aggressive} aggressive → ${net > 0 ? "tighten" : net < 0 ? "loosen" : "neutral"} (Δ ${(net * 100).toFixed(1)}%)`,
    );
  } else {
    lines.push("- No animal reads yet — observe an orbit, then classify.");
  }
  lines.push(equityLine(adjustedCtx, marginPct));
  lines.push("- Doctrine: target the leak, not the equilibrium.");
  // Exploitative sizing: pressure passive tables with bigger bets,
  // value-thin against aggressive tables with smaller ones.
  const passiveTable = passive >= aggressive;
  const sizing = passiveTable
    ? isPreflop(ctx)
      ? { preflopBB: 3.5 }
      : { postflopPotFraction: 0.8 }
    : isPreflop(ctx)
      ? { preflopBB: 3 }
      : { postflopPotFraction: 0.55 };
  return {
    school: "Exploitative",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizing),
    forbidden,
    reasonLines: lines,
  };
}

// ─── Hellmuth ─────────────────────────────────────────────────────────

const HELLMUTH_TOP_10 = new Set([
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "AK", "AQ",
]);

function pairKey(holes: ReadonlyArray<Card>): string {
  if (holes.length !== 2) return "";
  const s = holeShape(holes);
  if (!s) return "";
  const rankByNum = (n: number): string =>
    n === 10 ? "T" : n === 11 ? "J" : n === 12 ? "Q" : n === 13 ? "K" : n === 14 ? "A" : String(n);
  return s.pair ? `${rankByNum(s.hi)}${rankByNum(s.hi)}` : `${rankByNum(s.hi)}${rankByNum(s.lo)}`;
}

/**
 * Hellmuth — pre-flop top-10-or-fold, with a critical equity override.
 * The original "Hellmuth folds A-2" rigidity is bad poker; we keep the
 * top-10 preference but never let it overrule a clearly +EV call.
 *
 * Pre-flop:
 *   - hand IS top-10 → recommend call/raise (forbid fold)
 *   - hand NOT top-10 AND equity-margin ≤ +5% → fold (forbid call/raise)
 *   - hand NOT top-10 AND equity-margin > +5% → call OK ("the table is begging")
 *
 * Post-flop: pure equity-vs-pot-odds. White magic doesn't fold flushes.
 */
function ruleHellmuth(ctx: SchoolContext): SchoolDecision {
  if (!isPreflop(ctx)) {
    const { rec, forbidden, marginPct } = recByEquityMargin(ctx);
    return {
      school: "Hellmuth",
      recommendation: rec,
      optimalPlay: makePlay(rec, ctx, { postflopPotFraction: 0.75 }),
      forbidden,
      reasonLines: [
        "## Hellmuth reads the spot",
        equityLine(ctx, marginPct),
        "- Post-flop: the soul read serves the math, not the other way round.",
      ],
    };
  }

  const top10 = HELLMUTH_TOP_10.has(pairKey(ctx.me.holeCards ?? []));
  const margin = ctx.equity - ctx.requiredEquity;
  const { marginPct } = recByEquityMargin(ctx);
  const lines = ["## Hellmuth reads the spot"];

  const forbidden = new Set<PokerAction>();
  let rec: PokerAction;

  if (top10) {
    lines.push("- Top-10 check: **YES** — a Hellmuth-approved opener");
    forbidden.add("fold");
    rec = legalSet(ctx.availableActions).has("raise") ? "raise" : "call";
  } else if (margin > 0.05) {
    lines.push("- Top-10 check: no — but the price is right, the table is begging");
    rec = "call";
  } else {
    lines.push("- Top-10 check: no — fold preflop");
    forbidden.add("call");
    forbidden.add("raise");
    rec = "fold";
  }
  lines.push(equityLine(ctx, marginPct));
  lines.push("- White magic: trust the soul read, but never fold a winning hand.");

  // Hellmuth sizing pre-flop: 4x BB with top-10 (statement open), 3x
  // BB on equity-override (called-bluff to keep things cheap).
  const sizing = top10 ? { preflopBB: 4 } : { preflopBB: 3 };
  return {
    school: "Hellmuth",
    recommendation: rec,
    optimalPlay: makePlay(rec, ctx, sizing),
    forbidden,
    reasonLines: lines,
  };
}
