/**
 * Per-school math blocks — RFC-0018.
 *
 * Each function returns a short prompt-injectable text fragment that
 * surfaces the school's signature math to the LLM. Blocks are
 * intentionally terse (~3-6 lines) and number-forward — the goal is
 * for spectators to read the same numbers the ghost is deciding on.
 *
 * No tier gating yet: every school emits its block as soon as it is
 * assigned. Tier gating (RFC-0018 §"Tier definitions") is a follow-up.
 *
 * Each block is wrapped in a header that names the school in flavour
 * form so it reads in-character: e.g. "## Slim Lansky reads the spot".
 */

import type {
  AvailableActions,
  Card,
  GameState,
  Player,
  Rank,
} from "@aie-matrix/ghost-rdc-poker";
import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { AnimalType } from "./hellmuth-profile.js";
import { SCHOOL_FLAVOR_NAMES, type MathSchool } from "./math-schools.js";

export interface MathBlockContext {
  readonly me: Player;
  readonly gameState: GameState;
  readonly availableActions: AvailableActions;
  readonly opponentReads?: ReadonlyArray<string>;
  readonly tableAnimalTypes?: Readonly<Record<string, AnimalType>>;
}

/**
 * Per-school "veteran lens" — one extra line of deeper guidance that
 * appears only when the ghost has reached Veteran or Eagle tier
 * (RFC-0018 §"Tier definitions").
 */
const VETERAN_LENS: Readonly<Record<MathSchool, string>> = {
  Sklansky:
    "Fold unless implied odds on later streets justify the current call.",
  Chen:
    "Chen score is a guide; opponent tendencies in memory override it.",
  Harrington:
    "Zone dictates aggression; ignore tilt and follow the M-ratio.",
  GTO:
    "Mix frequencies — alternate bluff-catch and thin value, do not pattern.",
  Exploitative:
    "Three-bet wider against the Sharps; tighten against the Elephants.",
  ICM:
    "Bubble factor compresses as stacks shorten — fold marginal spots early.",
  Hellmuth:
    "Trust the read; soul-reads beat the math at thin margins.",
};

/** Tier ordering for the gate. Greenhorn is silent; higher tiers stack. */
function tierAtLeast(have: SkillTier | undefined, want: SkillTier): boolean {
  const rank: Record<SkillTier, number> = {
    Greenhorn: 0,
    Journeyman: 1,
    Veteran: 2,
    Eagle: 3,
  };
  if (!have) return true; // legacy callers without tier — treat as on
  return rank[have] >= rank[want];
}

export function computeMathBlock(
  school: MathSchool,
  ctx: MathBlockContext,
  tier?: SkillTier,
): string {
  // RFC-0018 — Greenhorns get no math block at all.
  if (tier === "Greenhorn") return "";
  const body = bodyFor(school, ctx);
  if (!body.trim()) return "";
  const flavor = SCHOOL_FLAVOR_NAMES[school];
  const extras: string[] = [];
  if (tierAtLeast(tier, "Veteran")) {
    extras.push(`- Veteran lens: ${VETERAN_LENS[school]}`);
  }
  if (tierAtLeast(tier, "Eagle")) {
    extras.push(
      "- Eagle rule: call only if pot odds beat your best equity estimate.",
    );
  }
  return [`## ${flavor} reads the spot`, body, ...extras].join("\n");
}

function bodyFor(school: MathSchool, ctx: MathBlockContext): string {
  switch (school) {
    case "Sklansky":
      return blockSklansky(ctx);
    case "Chen":
      return blockChen(ctx);
    case "Harrington":
      return blockHarrington(ctx);
    case "GTO":
      return blockGTO(ctx);
    case "Exploitative":
      return blockExploitative(ctx);
    case "ICM":
      return blockICM(ctx);
    case "Hellmuth":
      return blockHellmouth(ctx);
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────

const RANK_NUM: Readonly<Record<Rank, number>> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function rankFaceValue(r: Rank): number {
  switch (r) {
    case "A": return 10;
    case "K": return 8;
    case "Q": return 7;
    case "J": return 6;
    default: return RANK_NUM[r] / 2;
  }
}

/** Bill Chen's starting-hand formula. */
function chenScore(holeCards: Card[]): number {
  if (holeCards.length !== 2) return 0;
  const [a, b] = holeCards as [Card, Card];
  const ra = RANK_NUM[a.rank];
  const rb = RANK_NUM[b.rank];
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const hiRank = hi === ra ? a.rank : b.rank;

  let pts = rankFaceValue(hiRank);
  if (ra === rb) pts = Math.max(5, pts * 2); // pair
  if (a.suit === b.suit) pts += 2;
  const gap = hi - lo;
  if (ra !== rb) {
    if (gap === 1) pts += 0; // connector — no penalty
    else if (gap === 2) pts -= 1;
    else if (gap === 3) pts -= 2;
    else if (gap >= 4) pts -= 5;
    // straight bonus: connectors/one-gappers with high card under Q
    if (gap <= 2 && hi < 12) pts += 1;
  }
  return Math.round(pts * 10) / 10;
}

/** Approximate Sklansky group (1=best, 8=marginal, 0=junk/not on table). */
function sklanskyGroup(holeCards: Card[]): number {
  if (holeCards.length !== 2) return 0;
  const [a, b] = holeCards as [Card, Card];
  const ra = RANK_NUM[a.rank];
  const rb = RANK_NUM[b.rank];
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const pair = ra === rb;
  const suited = a.suit === b.suit;
  const gap = hi - lo;
  // Group 1: AA KK QQ JJ AKs
  if (pair && lo >= 11) return 1;
  if (suited && hi === 14 && lo === 13) return 1;
  // Group 2: TT AQs AJs KQs AKo
  if (pair && lo === 10) return 2;
  if (suited && hi === 14 && (lo === 12 || lo === 11)) return 2;
  if (suited && hi === 13 && lo === 12) return 2;
  if (!suited && hi === 14 && lo === 13) return 2;
  // Group 3: 99 JTs QJs KJs ATs AQo
  if (pair && lo === 9) return 3;
  if (suited && hi === 11 && lo === 10) return 3;
  if (suited && hi === 12 && lo === 11) return 3;
  if (suited && hi === 13 && lo === 11) return 3;
  if (suited && hi === 14 && lo === 10) return 3;
  if (!suited && hi === 14 && lo === 12) return 3;
  // Group 4: 88 KQo T9s QTs J9s 98s AJo KTs
  if (pair && lo === 8) return 4;
  if (!suited && hi === 13 && lo === 12) return 4;
  if (suited && gap === 1 && lo >= 8) return 4;
  if (suited && hi === 13 && lo === 10) return 4;
  if (!suited && hi === 14 && lo === 11) return 4;
  // Group 5: 77 66, AJo down to A2s, suited connectors, QJo etc.
  if (pair && lo >= 6) return 5;
  if (suited && hi === 14) return 5;
  if (!suited && hi === 14 && lo >= 10) return 5;
  // Group 6: 55 44, suited K-anything, suited connectors
  if (pair && lo >= 4) return 6;
  if (suited && hi === 13) return 6;
  if (suited && gap <= 2 && lo >= 5) return 6;
  // Group 7-8: marginal
  if (pair) return 7;
  if (suited) return 8;
  if (!suited && hi >= 12 && lo >= 9) return 8;
  return 0;
}

const HELLMUTH_TOP_10 = new Set([
  "AA",
  "KK",
  "QQ",
  "AK",
  "JJ",
  "TT",
  "99",
  "88",
  "AQ",
  "77",
]);

function pairKey(holeCards: Card[]): string {
  if (holeCards.length !== 2) return "";
  const [a, b] = holeCards as [Card, Card];
  const ra = RANK_NUM[a.rank];
  const rb = RANK_NUM[b.rank];
  if (ra === rb) return `${a.rank}${a.rank}`.replace("10", "T");
  const hi = ra > rb ? a.rank : b.rank;
  const lo = ra > rb ? b.rank : a.rank;
  return `${hi}${lo}`.replace(/10/g, "T");
}

function isTop10Hellmuth(holeCards: Card[]): boolean {
  return HELLMUTH_TOP_10.has(pairKey(holeCards));
}

/** Position label given seat index relative to dealer and table size. */
function positionLabel(
  seatIndex: number,
  dealerIndex: number,
  totalSeats: number,
): string {
  if (totalSeats < 2) return "?";
  const offset = (seatIndex - dealerIndex + totalSeats) % totalSeats;
  if (totalSeats === 2) return offset === 0 ? "BTN/SB" : "BB";
  if (offset === 0) return "BTN";
  if (offset === 1) return "SB";
  if (offset === 2) return "BB";
  if (offset === 3) return "UTG";
  if (offset === totalSeats - 1) return "CO";
  if (offset === totalSeats - 2) return "HJ";
  return "MP";
}

/** Harrington's M-ratio (no antes in our game; SB+BB only). */
function mRatio(stack: number, sb: number, bb: number): number {
  const cost = sb + bb;
  return cost > 0 ? stack / cost : Infinity;
}

function mZone(m: number): { label: string; nudge: string } {
  if (m >= 20) return { label: "green", nudge: "play standard, value-heavy" };
  if (m >= 10) return { label: "yellow", nudge: "open up, fewer speculative calls" };
  if (m >= 5)
    return {
      label: "orange",
      nudge: "stop calling; raise or fold, pick spots aggressively",
    };
  return { label: "red", nudge: "push-or-fold only — first in wins blinds" };
}

function potOddsLine(callAmount: number, pot: number): string {
  if (callAmount <= 0) return "no call needed — free to check or raise";
  const total = pot + callAmount;
  const pct = (callAmount / total) * 100;
  return `pot odds: calling $${callAmount} into $${pot} → need ≥${pct.toFixed(0)}% equity`;
}

/** Heuristic blocker count over premium value combos (AA/KK/QQ/AK). */
function blockerCount(holeCards: Card[]): {
  total: number;
  detail: string;
} {
  const counts: Array<[string, number]> = [];
  const ranks = holeCards.map((c) => c.rank);
  if (ranks.includes("A")) {
    const n = ranks.filter((r) => r === "A").length;
    const aaBlocked = n === 1 ? 3 : 6;
    counts.push(["AA", aaBlocked]);
  }
  if (ranks.includes("K")) {
    const n = ranks.filter((r) => r === "K").length;
    counts.push(["KK", n === 1 ? 3 : 6]);
  }
  if (ranks.includes("Q")) {
    const n = ranks.filter((r) => r === "Q").length;
    counts.push(["QQ", n === 1 ? 3 : 6]);
  }
  if (ranks.includes("A") && ranks.includes("K")) {
    counts.push(["AK", 4]);
  }
  const total = counts.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return { total: 0, detail: "no premium combos blocked" };
  return {
    total,
    detail: counts.map(([k, v]) => `${k}×${v}`).join(", "),
  };
}

/** Crude animal classifier from textual reads. */
function predictAnimal(read: string): AnimalType | null {
  const r = read.toLowerCase();
  if (/(fold|tight|nit|passive)/.test(r)) return "mouse";
  if (/(raise|3-bet|bet (turn|river)|aggressi)/.test(r)) {
    if (/(bluff|crazy|loose|wild)/.test(r)) return "jackal";
    return "lion";
  }
  if (/(call|station|trap|slow)/.test(r)) return "elephant";
  if (/(read|adapt|fold to|mix)/.test(r)) return "eagle";
  return null;
}

function listOpponentReads(ctx: MathBlockContext): string[] {
  return (ctx.opponentReads ?? []).filter((s) => s && s.trim().length > 0);
}

function activeOpponents(ctx: MathBlockContext): Player[] {
  return ctx.gameState.players.filter(
    (p) => p.id !== ctx.me.id && !p.isFolded,
  );
}

// ─── Per-school blocks ───────────────────────────────────────────────

function blockSklansky(ctx: MathBlockContext): string {
  const holes = ctx.me.holeCards ?? [];
  const lines: string[] = [];
  if (holes.length === 2) {
    const grp = sklanskyGroup(holes);
    const tag =
      grp <= 0
        ? "off the chart (junk)"
        : grp <= 2
          ? "premium"
          : grp <= 4
            ? "strong"
            : grp <= 6
              ? "playable in position"
              : "marginal";
    lines.push(`- Sklansky group: ${grp || "—"} (${tag})`);
  }
  lines.push(`- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`);
  if (ctx.gameState.communityCards.length > 0 && ctx.gameState.phase !== "river") {
    lines.push(
      "- Implied odds: if a draw completes on a coordinated board, expect to extract more on later streets — call with the future in mind.",
    );
  }
  lines.push(
    "- Doctrine: the Fundamental Theorem of Poker — play as you would if you could see the cards.",
  );
  return lines.join("\n");
}

function blockChen(ctx: MathBlockContext): string {
  const holes = ctx.me.holeCards ?? [];
  const lines: string[] = [];
  if (holes.length === 2) {
    const score = chenScore(holes);
    const verdict =
      score >= 8
        ? "raise — Chen says open"
        : score >= 5
          ? "call from late position; fold early"
          : "fold from anywhere preflop";
    lines.push(`- Chen score: ${score.toFixed(1)} → ${verdict}`);
  }
  lines.push(`- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`);
  lines.push("- Discipline: trust the numbers, not the table mood.");
  return lines.join("\n");
}

function blockHarrington(ctx: MathBlockContext): string {
  const m = mRatio(
    ctx.me.chipStack,
    ctx.gameState.smallBlindAmount,
    ctx.gameState.bigBlindAmount,
  );
  const zone = mZone(m);
  const lines: string[] = [
    `- M = ${m.toFixed(1)} → **${zone.label} zone** — ${zone.nudge}`,
    `- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`,
  ];
  if (m < 10) {
    lines.push(
      "- Short-stack mode: first-in vigorish. Steal the blinds when folded to you in late position.",
    );
  }
  return lines.join("\n");
}

const GTO_RANGE_HINTS: Readonly<Record<string, string>> = {
  UTG: "open 22+, A9s+, KTs+, QTs+, JTs, AQo+",
  HJ: "open 22+, A7s+, KTs+, QTs+, JTs, T9s, ATo+, KQo",
  MP: "open 22+, A8s+, KTs+, QTs+, JTs, ATo+, KJo+",
  CO: "open 22+, A2s+, K9s+, Q9s+, J9s, T8s+, 98s, A9o+, KTo+, QTo+",
  BTN: "open 22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, A2o+, K8o+, Q9o+, J9o+",
  SB: "vs BB: complete tight, jam/fold under 20bb; mix 3-bet wide vs limps",
  BB: "defend wide vs steal — 22+, suited gappers, any A, broadways",
  "BTN/SB": "heads-up: button opens ~70%; BB defends ~50%",
};

function blockGTO(ctx: MathBlockContext): string {
  const pos = positionLabel(
    ctx.me.seatIndex,
    ctx.gameState.dealerIndex,
    ctx.gameState.players.length,
  );
  const range = GTO_RANGE_HINTS[pos] ?? "play balanced; no over-bluffing";
  const lines: string[] = [
    `- Position: ${pos}`,
    `- Balanced opening hint: ${range}`,
    `- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`,
    "- Doctrine: be unexploitable — do not deviate based on table mood.",
  ];
  return lines.join("\n");
}

function blockExploitative(ctx: MathBlockContext): string {
  const lines: string[] = [];
  const reads = listOpponentReads(ctx);
  if (reads.length > 0) {
    lines.push("- Reads in play:");
    for (const r of reads.slice(0, 4)) lines.push(`  • ${r}`);
  } else {
    lines.push("- No prior reads — first hand against these faces; observe carefully.");
  }
  const blockers = blockerCount(ctx.me.holeCards ?? []);
  lines.push(`- Blockers: ${blockers.detail} (${blockers.total} value combos blocked).`);
  lines.push(`- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`);
  lines.push("- Doctrine: target the leak, not the equilibrium.");
  return lines.join("\n");
}

function blockICM(ctx: MathBlockContext): string {
  const bb = ctx.gameState.bigBlindAmount;
  const bbStack = bb > 0 ? ctx.me.chipStack / bb : Infinity;
  const survivalNote =
    bbStack < 10
      ? "**Critical**: stack is short; marginal spots are −EV in survival terms — fold."
      : bbStack < 20
        ? "Survival weighting: bias toward folding marginal pots."
        : "Healthy stack: chip EV ≈ Cyphers EV here.";
  const lines: string[] = [
    `- Stack: ${bbStack.toFixed(1)} BB ($${ctx.me.chipStack}) — ${survivalNote}`,
    `- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`,
    "- Doctrine: not all chips are worth the same Cyphers. Surviving outweighs marginal +EV.",
  ];
  return lines.join("\n");
}

function blockHellmouth(ctx: MathBlockContext): string {
  const holes = ctx.me.holeCards ?? [];
  const lines: string[] = [];

  // 1. Top 10 check
  if (holes.length === 2) {
    const top = isTop10Hellmuth(holes);
    lines.push(
      `- Top-10 check: ${top ? "**YES** — this is a Hellmuth-approved opener" : "no — Hellmuth would fold this preflop unless the table is begging"}`,
    );
  }

  // 2. Animal predictions per active opponent
  const opps = activeOpponents(ctx);
  const animals: Array<{ name: string; type: AnimalType; source: string }> = [];
  for (const o of opps) {
    const fromTable = ctx.tableAnimalTypes?.[o.name];
    if (fromTable) {
      animals.push({ name: o.name, type: fromTable, source: "self-declared" });
      continue;
    }
    const read = (ctx.opponentReads ?? []).find((r) => r.includes(o.name));
    const guess = read ? predictAnimal(read) : null;
    if (guess) animals.push({ name: o.name, type: guess, source: "inferred" });
  }
  if (animals.length > 0) {
    lines.push("- Animal read:");
    for (const a of animals) {
      lines.push(`  • ${a.name}: ${a.type} (${a.source})`);
    }
    // Table composition nudge
    const counts: Partial<Record<AnimalType, number>> = {};
    for (const a of animals) counts[a.type] = (counts[a.type] ?? 0) + 1;
    const jackals = counts.jackal ?? 0;
    const mice = counts.mouse ?? 0;
    const elephants = counts.elephant ?? 0;
    if (jackals >= 2) {
      lines.push("- Table nudge: multiple Jackals — tighten up, let them spew.");
    } else if (mice >= 2) {
      lines.push("- Table nudge: Mice at the table — run them over with steals.");
    } else if (elephants >= 2) {
      lines.push("- Table nudge: Elephants — value-bet thin, do not bluff.");
    }
  } else {
    lines.push("- No animal reads yet — observe one orbit, then classify.");
  }

  lines.push(`- ${potOddsLine(ctx.availableActions.callAmount, ctx.gameState.pot)}`);
  lines.push("- White magic: trust the soul read over the solver.");
  return lines.join("\n");
}
