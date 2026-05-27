/**
 * Decision pipeline — composes the equity oracle, school rule, tier
 * pruner, animal bias, and bluff sampler into one call.
 *
 *   1. Equity oracle           → P(win)
 *   2. Pot odds                → required equity
 *   3. School rule             → { recommendation, forbidden, reason }
 *   4. Tier pruner             → { actions, removed }
 *   5. Animal bias             → preferred action + reason (advisory)
 *   6. Bluff sampler (Eagle)   → optional force-raise
 *
 * The output is what the brain feeds the LLM:
 *   - `availableActions`  — the menu the LLM may pick from
 *   - `contextLines`      — the math + school + animal + bluff text
 *                           that goes into the prompt
 *   - `decision`          — the structured trace (for logs, overlay,
 *                           and persistence into the agent-memory graph)
 *
 * Pure orchestration. No LLM call here.
 */

import type {
  AvailableActions,
  Card,
  GameState,
  Player,
} from "@aie-matrix/ghost-rdc-poker";

import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { AnimalType } from "./hellmuth-profile.js";
import type { MathSchool } from "./math-schools.js";
import {
  estimateEquity,
  potOdds,
  type EquityResult,
} from "./equity-oracle.js";
import {
  decideBySchool,
  type SchoolDecision,
} from "./school-rules.js";
import { pruneByTier, type PrunedActions } from "./tier-pruner.js";
import { steerByAnimal, type AnimalSteer } from "./animal-bias.js";
import { sampleBluff, type BluffSample } from "./bluff-sampler.js";
import {
  generateCandidates,
  type Candidate,
  type CandidateSet,
} from "./candidate-generator.js";

export interface DecisionPipelineRequest {
  readonly me: Player;
  readonly gameState: GameState;
  readonly availableActions: AvailableActions;
  readonly opponents: ReadonlyArray<Player>;
  readonly persona: {
    readonly bluffFrequency: number;
  };
  readonly school: MathSchool | undefined;
  readonly tier: SkillTier | undefined;
  readonly animal: AnimalType | undefined;
  readonly tableAnimalTypes?: Readonly<Record<string, AnimalType>>;
  readonly opponentReads?: ReadonlyArray<string>;
  /**
   * Number of Monte Carlo samples for the equity oracle. Defaults to
   * 2000 — cheap enough to run per-turn (~5ms typical).
   */
  readonly equitySamples?: number;
  /** Optional deterministic seed for the equity oracle (tests). */
  readonly equitySeed?: number;
  /** Optional PRNG for the bluff sampler (tests). */
  readonly bluffRng?: () => number;
  /** Optional deterministic seed for the candidate generator's letter
   *  ordering (tests). Without this, ordering is Math.random. */
  readonly candidateSeed?: number;
  /** Tilt state for this seat. When `tilted` is true, the pipeline
   *  rolls per turn against `tiltSusceptibility`; on a hit it asks
   *  the candidate generator for a one-step-worse tier, producing
   *  the "poor decisions x% of the time" mechanic. */
  readonly tilt?: {
    readonly tilted: boolean;
    readonly tiltSusceptibility: number;
  };
  /** Optional PRNG for the tilt-poor-decision roll (tests). */
  readonly tiltRng?: () => number;
}

export interface DecisionTrace {
  readonly equity: EquityResult;
  readonly requiredEquity: number;
  readonly requiredEquityPct: number;
  readonly equityMargin: number;
  readonly school: SchoolDecision | null;
  readonly pruning: PrunedActions;
  readonly animal: AnimalSteer | null;
  readonly bluff: BluffSample | null;
  /** The three candidates the LLM picks from (null when no school). */
  readonly candidateSet: CandidateSet | null;
  /** Final menu the LLM should pick from (legacy: full menu when no candidates). */
  readonly availableActions: AvailableActions;
  /** Tilt outcome for this turn:
   *   - `null` when this seat isn't in a tilted state
   *   - `{ tilted: true, fired: true }` when tilted AND the roll hit (tier was degraded)
   *   - `{ tilted: true, fired: false }` when tilted but the roll missed (no degrade)
   *  Useful for overlay/logs to render the "TILTED" badge. */
  readonly tilt: { readonly tilted: boolean; readonly fired: boolean } | null;
}

export interface DecisionPipelineResult {
  /** Filtered menu the LLM should pick from (legacy fallback path). */
  readonly availableActions: AvailableActions;
  /**
   * The three lettered candidates the LLM is locked to. `null` when
   * no school was supplied (the brain falls back to legacy
   * action/amount picking from `availableActions`).
   */
  readonly candidates: ReadonlyArray<Candidate> | null;
  /**
   * Prompt-injectable text block summarizing the pipeline's read.
   * One section per layer (Math / School / Animal / Bluff). Empty
   * sections are omitted.
   */
  readonly contextLines: ReadonlyArray<string>;
  /** Structured trace for logs, overlay, and graph persistence. */
  readonly trace: DecisionTrace;
}

/**
 * Run the pipeline. Pure, synchronous-feel (estimateEquity is sync
 * Monte Carlo). Never throws on input errors — returns a degraded
 * result that lets the brain fall back to the legacy LLM-decides path
 * when something goes wrong (missing hole cards mid-bug, etc.).
 */
export function runDecisionPipeline(
  req: DecisionPipelineRequest,
): DecisionPipelineResult {
  const hole = (req.me.holeCards ?? []) as ReadonlyArray<Card>;
  const community = req.gameState.communityCards as ReadonlyArray<Card>;
  const opponentCount = req.opponents.length;
  const lines: string[] = [];

  // 1. Equity — wrapped in try/catch because hole-card edge cases
  //    (sit-out, mid-deal) should not crash the brain.
  let equity: EquityResult;
  try {
    equity = estimateEquity({
      holeCards: hole,
      communityCards: community,
      opponents: opponentCount,
      samples: req.equitySamples ?? 2000,
      ...(req.equitySeed !== undefined ? { seed: req.equitySeed } : {}),
    });
  } catch {
    return degradedResult(req, "equity oracle failed; serving legacy menu");
  }

  // 2. Pot odds.
  const callAmount = req.availableActions.callAmount;
  const pot = req.gameState.pot;
  const odds = potOdds(callAmount, pot);
  const equityMargin = equity.equity - odds.requiredEquity;

  lines.push(
    "## Decision math",
    `- Equity (Monte Carlo, ${equity.samples} samples): ${pct(equity.equity)} (win ${pct(equity.winRate)}, tie ${pct(equity.tieRate)})`,
    `- Pot odds: call $${callAmount} into $${pot} → need ${pct(odds.requiredEquity)}`,
    `- Margin: ${signedPct(equityMargin)}`,
  );

  // 3. School rule — optional. If no school assigned, skip school +
  //    candidate generation and pass the raw menu through (legacy
  //    behaviour for callers that haven't migrated).
  if (!req.school) {
    return {
      availableActions: req.availableActions,
      candidates: null,
      contextLines: lines,
      trace: {
        equity,
        requiredEquity: odds.requiredEquity,
        requiredEquityPct: odds.requiredEquityPct,
        equityMargin,
        school: null,
        pruning: { actions: req.availableActions, removed: [], pruned: false },
        animal: null,
        bluff: null,
        candidateSet: null,
        availableActions: req.availableActions,
        tilt: null,
      },
    };
  }

  const bbAmount = req.gameState.bigBlindAmount;
  const bbStack = bbAmount > 0 ? req.me.chipStack / bbAmount : 0;

  const schoolDecision = decideBySchool(req.school, {
    me: req.me,
    gameState: req.gameState,
    availableActions: req.availableActions,
    equity: equity.equity,
    requiredEquity: odds.requiredEquity,
    position: positionLabel(
      req.me.seatIndex,
      req.gameState.dealerIndex,
      req.gameState.players.length,
    ),
    bbStack,
    activeOpponents: req.opponents,
    ...(req.opponentReads ? { opponentReads: req.opponentReads } : {}),
    ...(req.tableAnimalTypes ? { tableAnimalTypes: req.tableAnimalTypes } : {}),
  });

  lines.push("", ...schoolDecision.reasonLines);

  // 4. Tier pruner — LEGACY trace only. The candidate generator does
  //    the skill-floor work now; the LLM is never shown a pruned menu.
  const pruning = pruneByTier(req.availableActions, schoolDecision, req.tier);

  // 5. Animal bias — surfaces as a prompt hint so the LLM has a
  //    temperament lean when picking among A/B/C.
  const animal = steerByAnimal({
    animal: req.animal,
    schoolRecommendation: schoolDecision.recommendation,
    equityMargin,
    canRaise: req.availableActions.canRaise,
    canCall: req.availableActions.canCall,
    canFold: req.availableActions.canFold,
    canCheck: req.availableActions.canCheck,
  });
  if (animal.diverged) {
    lines.push("", "## Temperament", `- ${animal.reason} Lean: **${animal.preferred}**.`);
  }

  // 6. Bluff sampler — Eagle only. When it fires, we OVERRIDE the
  //    school's optimal to be a raise (bluff sized at ~2/3 pot). The
  //    candidate generator then warps THAT into the menu, so an Eagle
  //    who decided to bluff sees three raise-flavored candidates
  //    instead of three fold-flavored ones.
  const foldEquity = estimateFoldEquity(req.opponents, req.tableAnimalTypes);
  const bluff = sampleBluff({
    tier: req.tier,
    bluffFrequency: req.persona.bluffFrequency,
    equity: equity.equity,
    phase: req.gameState.phase,
    foldEquity,
    canRaise: req.availableActions.canRaise,
    ...(req.bluffRng ? { rng: req.bluffRng } : {}),
  });

  const effectiveOptimal = bluff.bluff
    ? {
        action: "raise" as const,
        amount: Math.max(
          req.availableActions.minRaise,
          Math.min(
            req.availableActions.maxRaise,
            Math.round(
              (req.gameState.pot + req.availableActions.callAmount) * 0.66 +
                req.availableActions.callAmount,
            ),
          ),
        ),
      }
    : schoolDecision.optimalPlay;

  if (bluff.bluff) {
    lines.push(
      "",
      "## Bluff sampler",
      `- ${bluff.reason} **Treating raise as the school's optimal for warping.**`,
    );
  }

  // 6b. Tilt roll. When this seat is tilted, every turn we roll
  //     against persona.tiltSusceptibility. On a hit the candidate
  //     generator gets a one-step-worse tier — the "poor decisions
  //     x% of the time" mechanic. A tilted Veteran with 0.58
  //     susceptibility plays Journeyman-quality on ~58% of turns.
  //     Recovery (drop the `tilted` flag) is up to the caller —
  //     happens in session-loop after each hand via computeTilt.
  let effectiveTier: SkillTier | undefined = req.tier;
  let tiltFiredThisTurn = false;
  if (req.tilt?.tilted) {
    const rng = req.tiltRng ?? Math.random;
    if (rng() < req.tilt.tiltSusceptibility) {
      effectiveTier = worsenTier(req.tier);
      tiltFiredThisTurn = true;
      lines.push(
        "",
        "## Tilt",
        `- TILTED — rolled a poor decision. Effective tier degraded: ${req.tier ?? "Greenhorn"} → ${effectiveTier}.`,
      );
    } else {
      lines.push(
        "",
        "## Tilt",
        `- TILTED — but holding it together this turn (rolled OK).`,
      );
    }
  }

  // 7. Candidate generator — turn the (possibly bluff-overridden)
  //    optimal into three tier-warped candidates. The LLM is locked
  //    to picking one of A/B/C.
  const candidateSet = generateCandidates({
    optimal: effectiveOptimal,
    available: req.availableActions,
    tier: effectiveTier,
    ...(req.candidateSeed !== undefined ? { seed: req.candidateSeed } : {}),
  });

  lines.push(
    "",
    `## Candidates (tier=${req.tier ?? "Greenhorn"})`,
    ...candidateSet.candidates.map((c) => `- ${c.letter}: ${c.label}`),
  );

  return {
    availableActions: req.availableActions,
    candidates: candidateSet.candidates,
    contextLines: lines,
    trace: {
      equity,
      requiredEquity: odds.requiredEquity,
      requiredEquityPct: odds.requiredEquityPct,
      equityMargin,
      school: schoolDecision,
      pruning,
      animal,
      bluff,
      candidateSet,
      availableActions: req.availableActions,
      tilt: req.tilt?.tilted
        ? { tilted: true, fired: tiltFiredThisTurn }
        : null,
    },
  };
}

/**
 * Step the tier down by one rung. Greenhorn is the floor — a tilted
 * Greenhorn stays Greenhorn (can't get worse than vibes-only play).
 * Undefined tier collapses to Greenhorn.
 */
function worsenTier(tier: SkillTier | undefined): SkillTier {
  switch (tier) {
    case "Eagle":
      return "Veteran";
    case "Veteran":
      return "Journeyman";
    case "Journeyman":
      return "Greenhorn";
    case "Greenhorn":
    default:
      return "Greenhorn";
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function signedPct(x: number): string {
  const v = (x * 100).toFixed(1);
  return x >= 0 ? `+${v}%` : `${v}%`;
}

/** Position label (Hellmuth-style). Mirrors math-block.ts's helper. */
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

/**
 * Estimate fold equity from table composition. Crude in v1 — counts
 * how many opponents are passive (mouse/elephant) vs aggressive
 * (lion/jackal). Mice fold often → high fold equity; Elephants call
 * everything → low fold equity.
 *
 *   Baseline: 0.5
 *   Per mouse / unknown-passive read: +0.08
 *   Per elephant: -0.15 (calling stations kill bluffs)
 *   Per lion: -0.05
 *   Per jackal: -0.02 (might fold or might re-raise; net small)
 *   Per eagle: ±0
 *
 * Clamped to [0.1, 0.85].
 */
function estimateFoldEquity(
  opponents: ReadonlyArray<Player>,
  tableAnimalTypes?: Readonly<Record<string, AnimalType>>,
): number {
  if (!tableAnimalTypes || opponents.length === 0) return 0.5;
  let fe = 0.5;
  for (const o of opponents) {
    const a = tableAnimalTypes[o.name];
    switch (a) {
      case "mouse":    fe += 0.08; break;
      case "elephant": fe -= 0.15; break;
      case "lion":     fe -= 0.05; break;
      case "jackal":   fe -= 0.02; break;
      case "eagle":    /* neutral */ break;
      default:         /* unknown */ break;
    }
  }
  return Math.max(0.1, Math.min(0.85, fe));
}

function degradedResult(
  req: DecisionPipelineRequest,
  note: string,
): DecisionPipelineResult {
  return {
    availableActions: req.availableActions,
    candidates: null,
    contextLines: [`## Decision math\n- (skipped: ${note})`],
    trace: {
      equity: { equity: 0.5, winRate: 0, tieRate: 0, samples: 0 },
      requiredEquity: 0,
      requiredEquityPct: 0,
      equityMargin: 0,
      school: null,
      pruning: { actions: req.availableActions, removed: [], pruned: false },
      animal: null,
      bluff: null,
      candidateSet: null,
      availableActions: req.availableActions,
      tilt: null,
    },
  };
}
