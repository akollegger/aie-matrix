/**
 * Poker brain — the agent's "fast brain" used during a hand.
 *
 * Patterns lifted from `pokerswarm-ai/src/lib/agents/playerAgent.ts`:
 *   - JSON extraction from possibly-wrapped LLM output (`extractJson`)
 *   - Action validation + clamping against `AvailableActions`
 *     (`validateAction`)
 *   - Best-fallback action when the LLM is unavailable or the parse
 *     fails (`bestFallback` / `fallbackFromAvailable`)
 *
 * Differences from pokerswarm:
 *   - Vercel AI SDK → OpenAI SDK directly (matching the rest of this
 *     workspace; we'd swap to Vercel AI SDK if we ever needed
 *     local-Ollama support).
 *   - Personas are derived from peppers slider profiles, not from a
 *     fixed roster, so the persona shape varies live as the ghost
 *     drifts.
 *   - Streaming-text variant is deferred — pokerswarm has it
 *     (`getAgentActionStreaming`), and lifting that is a clear next
 *     step. The orchestrator's overlay is already SSE-driven so the
 *     plumbing is friendly.
 */

import type {
  ActionType,
  AgentPersona,
  AvailableActions,
  GameState,
} from "@aie-matrix/ghost-rdc-poker";

import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

import type { AnimalType } from "./hellmuth-profile.js";
import type { Candidate } from "./candidate-generator.js";
import { chatJson } from "./llm-client.js";
import { type MathSchool } from "./math-schools.js";
import {
  buildAnimalPrompt,
  buildCandidatesSection,
  buildGameStatePrompt,
  buildMemoryPrompt,
  buildSystemPrompt,
  buildTableTalkPrompt,
} from "./prompts.js";
import {
  runDecisionPipeline,
  type DecisionTrace,
} from "./decision-pipeline.js";

export interface PokerBrainRequest {
  readonly persona: AgentPersona;
  readonly gameState: GameState;
  readonly availableActions: AvailableActions;
  readonly ghostId: string;
  /**
   * Pre-built memory-context string from the orchestrator. One line per
   * opponent: `- Name: Recent — call $20 flop, raise $40 turn. Tendencies: raise turn (3x).`
   * Built by `rdc-orchestrator/memory-writer.ts:fetchOpponentReads`.
   */
  readonly opponentReads?: ReadonlyArray<string>;
  /** Table talk uttered earlier in this hand. */
  readonly recentTableTalk?: ReadonlyArray<{
    fromName: string;
    text: string;
    toName?: string | null;
  }>;
  /** Hellmuth type assigned to this player at this table. */
  readonly myAnimalType?: AnimalType;
  /** Map of seated player displayName → Hellmuth type. */
  readonly tableAnimalTypes?: Readonly<Record<string, AnimalType>>;
  /**
   * Math school the ghost was assigned at first sit (RFC-0018). When
   * set, the brain injects a school-specific math block into the
   * prompt so the LLM sees the same numbers the spectator sees.
   */
  readonly mathSchool?: MathSchool;
  /**
   * Skill tier from the ledger (RFC-0018). Gates how much math gets
   * rendered: Greenhorn → no block; Journeyman → school's base block;
   * Veteran/Eagle → add per-school veteran lens and (Eagle) a hard
   * pot-odds fold rule. Omit to default to "always show".
   */
  readonly skillTier?: SkillTier;
  /**
   * Per-seat tilt state. When `tilted` is true, the pipeline rolls
   * against `tiltSusceptibility` each turn; on a hit the candidate
   * generator gets a one-step-worse tier. Recovery is the session
   * loop's job (computeTilt with hysteresis after each hand).
   */
  readonly tilt?: {
    readonly tilted: boolean;
    readonly tiltSusceptibility: number;
  };
}

export interface PokerBrainDecision {
  readonly action: ActionType;
  readonly amount: number;
  readonly reasoning: string;
  readonly confidence: number;
  readonly tableTalk?: string;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  /**
   * Decision pipeline trace — equity, school, pruning, animal, bluff.
   * Present when the brain ran the new equity-aware pipeline; absent
   * when the brain fell back to the legacy text-only math block (e.g.
   * Greenhorn tier, or no math school assigned).
   */
  readonly decision?: DecisionTrace;
}

export async function invokePokerBrain(
  req: PokerBrainRequest,
): Promise<PokerBrainDecision> {
  const me = req.gameState.players.find((p) => p.id === req.ghostId);
  if (!me) throw new Error(`ghostId ${req.ghostId} not at table`);

  const system = buildSystemPrompt(req.persona);
  const animalSection = buildAnimalPrompt(
    me.name,
    req.myAnimalType,
    req.tableAnimalTypes,
  );
  const memorySection = buildMemoryPrompt(
    (req.opponentReads ?? []).join("\n"),
  );
  const tableTalkSection = buildTableTalkPrompt(req.recentTableTalk);

  // The candidate-warping pipeline: every tier (including Greenhorn)
  // runs the math, then the candidate generator warps the school's
  // optimal play into THREE tier-appropriate options. The LLM is
  // locked to those three letters and cannot pick outside them. This
  // is the mechanical skill floor — a Greenhorn never sees the true
  // optimal; a Veteran does.
  let mathSection: string;
  let candidatesSection = "";
  let candidates: ReadonlyArray<Candidate> | null = null;
  let decisionTrace: DecisionTrace | undefined;

  if (!req.mathSchool) {
    // No school assigned — fall back to legacy unrestricted-menu path.
    // This branch exists for callers that haven't migrated to the new
    // pipeline (e.g. tests, debug scripts).
    mathSection = "";
  } else {
    const opponents = req.gameState.players.filter(
      (p) => p.id !== me.id && !p.isFolded,
    );
    const result = runDecisionPipeline({
      me,
      gameState: req.gameState,
      availableActions: req.availableActions,
      opponents,
      persona: { bluffFrequency: req.persona.bluffFrequency },
      school: req.mathSchool,
      tier: req.skillTier,
      animal: req.myAnimalType,
      ...(req.tableAnimalTypes ? { tableAnimalTypes: req.tableAnimalTypes } : {}),
      ...(req.opponentReads ? { opponentReads: req.opponentReads } : {}),
      ...(req.tilt ? { tilt: req.tilt } : {}),
    });
    mathSection = "\n\n" + result.contextLines.join("\n") + "\n";
    decisionTrace = result.trace;
    if (result.candidates !== null) {
      candidates = result.candidates;
      candidatesSection = buildCandidatesSection(result.candidates);
    }
  }

  // The game-state prompt no longer renders available actions — those
  // are now in the candidates section (or omitted when no candidates,
  // for legacy callers).
  const game = buildGameStatePrompt(req.gameState, me, req.availableActions);

  const user =
    game + mathSection + candidatesSection + animalSection + memorySection + tableTalkSection;

  let raw: string;
  let usage: PokerBrainDecision["usage"] = null;
  try {
    const result = await chatJson<unknown>({
      system,
      user,
      temperature: 0.6,
      maxTokens: 400,
    });
    raw = result.raw;
    usage = result.usage;
  } catch (err) {
    // Fall through to defensive fallback. Logged by caller.
    throw err;
  }

  // Two paths: with candidates (locked to letter), without (legacy
  // free-pick from raw availableActions).
  const decision = candidates
    ? parseLetterResponse(raw, candidates, req.availableActions, usage)
    : parseResponse(raw, req.availableActions, usage);
  return decisionTrace !== undefined
    ? { ...decision, decision: decisionTrace }
    : decision;
}

/**
 * Parse an LLM response that's expected to pick one of A/B/C from a
 * candidate set. Looks for `"choice": "A"` etc. in the JSON output;
 * if the choice is missing or invalid, falls back to the candidate
 * whose action matches the LLM's `"action"` field if present (so a
 * model that ignores the letter scheme still produces something);
 * if all else fails, picks candidate A and flags low confidence.
 *
 * Returns the chosen candidate's {action, amount} clamped against
 * the original availableActions one more time (belt and braces — the
 * generator already legalized but this stops any drift).
 */
function parseLetterResponse(
  text: string,
  candidates: ReadonlyArray<Candidate>,
  available: AvailableActions,
  usage: PokerBrainDecision["usage"],
): PokerBrainDecision {
  const jsonStr = extractJson(text);
  let data: Record<string, unknown> = {};
  if (jsonStr) {
    try {
      data = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }

  const reasoning = typeof data.reasoning === "string" && data.reasoning.length > 0
    ? data.reasoning
    : "(no reasoning)";
  const tableTalkRaw = typeof data.tableTalk === "string" && data.tableTalk.trim().length > 0
    ? data.tableTalk.trim().slice(0, 120)
    : undefined;
  const confidence = typeof data.confidence === "number"
    ? Math.max(0, Math.min(1, data.confidence))
    : 0.5;

  // Letter pick — preferred path.
  const choiceRaw = typeof data.choice === "string"
    ? data.choice.trim().toUpperCase().slice(0, 1)
    : null;
  const picked = candidates.find((c) => c.letter === choiceRaw);
  if (picked) {
    const [validAction, validAmount] = validateAction(
      picked.action,
      picked.amount,
      available,
    );
    return {
      action: validAction,
      amount: validAmount,
      reasoning,
      confidence,
      ...(tableTalkRaw !== undefined ? { tableTalk: tableTalkRaw } : {}),
      usage,
    };
  }

  // Legacy fallback: LLM returned `action`/`amount` instead of `choice`.
  // Try to match the action to a candidate.
  const fallbackAction = typeof data.action === "string" ? data.action.toLowerCase() : null;
  if (fallbackAction) {
    const match = candidates.find((c) => c.action === fallbackAction);
    if (match) {
      const [validAction, validAmount] = validateAction(
        match.action,
        match.amount,
        available,
      );
      return {
        action: validAction,
        amount: validAmount,
        reasoning,
        confidence: confidence * 0.7, // penalize off-protocol response
        ...(tableTalkRaw !== undefined ? { tableTalk: tableTalkRaw } : {}),
        usage,
      };
    }
  }

  // Final fallback: pick candidate A. Means the LLM produced garbage
  // — caller can read confidence to know.
  const fallback = candidates[0]!;
  const [validAction, validAmount] = validateAction(
    fallback.action,
    fallback.amount,
    available,
  );
  return {
    action: validAction,
    amount: validAmount,
    reasoning: "(LLM did not pick a valid letter — defaulted to A)",
    confidence: 0.1,
    ...(tableTalkRaw !== undefined ? { tableTalk: tableTalkRaw } : {}),
    usage,
  };
}

/**
 * Parse an LLM response (possibly with surrounding prose) into a
 * validated `PokerBrainDecision`. Lifted from pokerswarm's
 * `playerAgent.parseResponse` with two changes: usage forwarding and
 * `tableTalk` extraction.
 */
export function parseResponse(
  text: string,
  availableActions: AvailableActions,
  usage: PokerBrainDecision["usage"],
): PokerBrainDecision {
  const jsonStr = extractJson(text);
  if (jsonStr) {
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;
      const reasoning = typeof data.reasoning === "string" && data.reasoning.length > 0
        ? data.reasoning
        : "(no reasoning)";
      const actionStr = typeof data.action === "string" ? data.action : "fold";
      const amount = typeof data.amount === "number" ? data.amount : 0;
      const confidence = typeof data.confidence === "number"
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.5;
      const tableTalk = typeof data.tableTalk === "string" && data.tableTalk.trim().length > 0
        ? data.tableTalk.trim().slice(0, 120)
        : undefined;

      const [validAction, validAmount] = validateAction(
        actionStr,
        amount,
        availableActions,
      );

      return {
        action: validAction,
        amount: validAmount,
        reasoning,
        confidence,
        tableTalk,
        usage,
      };
    } catch {
      // JSON parse failed — fall through.
    }
  }
  return fallbackDecision(availableActions, usage);
}

/**
 * Find the first balanced JSON object in the text. Lifted from
 * pokerswarm-ai/src/lib/agents/playerAgent.ts:extractJson — same
 * implementation, no behavioral changes.
 */
export function extractJson(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Validate and clamp an action against what's actually legal. Lifted
 * from pokerswarm-ai/src/lib/agents/playerAgent.ts:validateAction with
 * minor type adjustments.
 */
export function validateAction(
  actionStr: string,
  amount: number,
  available: AvailableActions,
): [ActionType, number] {
  const action = actionStr.toLowerCase().trim();

  if (action === "raise" && available.canRaise) {
    const clamped = Math.max(
      available.minRaise,
      Math.min(amount, available.maxRaise),
    );
    return ["raise", clamped];
  }
  if (action === "all-in" && available.canAllIn) {
    return ["all-in", available.allInAmount];
  }
  if (action === "call" && available.canCall) {
    return ["call", available.callAmount];
  }
  if (action === "check" && available.canCheck) {
    return ["check", 0];
  }
  if (action === "fold" && available.canFold) {
    return ["fold", 0];
  }
  return bestFallback(available);
}

/** Best-fallback action: check > call > fold. Lifted verbatim. */
export function bestFallback(
  available: AvailableActions,
): [ActionType, number] {
  if (available.canCheck) return ["check", 0];
  if (available.canCall) return ["call", available.callAmount];
  return ["fold", 0];
}

function fallbackDecision(
  available: AvailableActions,
  usage: PokerBrainDecision["usage"],
): PokerBrainDecision {
  const [action, amount] = bestFallback(available);
  return {
    action,
    amount,
    reasoning: "Fallback decision — LLM response could not be parsed.",
    confidence: 0.3,
    tableTalk: undefined,
    usage,
  };
}
