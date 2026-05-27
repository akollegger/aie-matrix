/**
 * Prompt builders — ported from pokerswarm-ai's `src/lib/agents/prompts.ts`
 * with two intentional changes:
 *
 *   1. The `Catchphrase: "..."` line is dropped. We never want canned
 *      phrases echoed back into table talk; the LLM produces fresh
 *      utterances each turn from the persona description + game state.
 *
 *   2. The difficulty branch is dropped (no `buildDifficultyInstructions`).
 *      Difficulty is a spec gap we may add back later as a separate
 *      concern; v1 ships without it. See ../../proposals/rfc/0012 for
 *      where this would naturally re-enter.
 *
 * Everything else — the system prompt structure, the JSON output
 * contract, the game-state formatter, the available-actions
 * renderer — is verbatim from the upstream. Same contract, same shape.
 */

import type {
  AgentPersona,
  AvailableActions,
  Card,
  GameState,
  Player,
} from "@aie-matrix/ghost-rdc-poker";

import type { Candidate } from "./candidate-generator.js";
import { ANIMAL_DESCRIPTIONS, type AnimalType } from "./hellmuth-profile.js";

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

export function buildMemoryPrompt(memoryContext: string): string {
  if (!memoryContext) return "";
  return `\n\nOpponent History & Tendencies:\n${memoryContext}`;
}

/**
 * Phil Hellmuth's animal-type profile of everyone at the table.
 * The brain reads its own type as a self-image AND the opponents'
 * types as exploitable read patterns — "the elephant won't fold to a
 * value bet; don't bluff into them" / "the mouse just raised, fold
 * unless you have a real hand" / etc.
 */
export function buildAnimalPrompt(
  myName: string,
  myType: AnimalType | undefined,
  tableTypes: Readonly<Record<string, AnimalType>> | undefined,
): string {
  if (!myType || !tableTypes) return "";
  const lines: string[] = [];
  lines.push("\n\nHellmuth profile (your read on the table):");
  lines.push(`  YOU (${myName}) are the ${myType.toUpperCase()}.`);
  lines.push(`  ${ANIMAL_DESCRIPTIONS[myType]}`);
  const others = Object.entries(tableTypes).filter(([name]) => name !== myName);
  if (others.length > 0) {
    lines.push("");
    lines.push("  Opponents at this table:");
    for (const [name, type] of others) {
      lines.push(
        `  - ${name} (${type.toUpperCase()}): ${ANIMAL_DESCRIPTIONS[type]}`,
      );
    }
  }
  lines.push("");
  lines.push(
    "  Use these reads. Don't bluff the elephant. Don't try to outdraw the lion. Don't pay off the mouse when they raise. Keep the jackal off-balance.",
  );
  return lines.join("\n");
}

export function buildTableTalkPrompt(
  recentTableTalk:
    | ReadonlyArray<{ fromName: string; text: string; toName?: string | null }>
    | undefined,
): string {
  if (!recentTableTalk || recentTableTalk.length === 0) return "";
  const lines = recentTableTalk
    .map((t) => {
      const audience = t.toName ? `to ${t.toName}` : "to the table";
      return `  ${t.fromName} (${audience}): "${t.text}"`;
    })
    .join("\n");
  return `\n\nWhat's been said this hand (oldest first):\n${lines}\n(Respond in character to what's been said. Don't ignore the table. Don't repeat phrases verbatim. If you reply to a specific speaker, use the "@<Name>: ..." prefix described above.)`;
}

export function buildSystemPrompt(persona: AgentPersona): string {
  const agg = `${Math.round(persona.aggression * 100)}%`;
  const tight = `${Math.round(persona.tightness * 100)}%`;
  const bluff = `${Math.round(persona.bluffFrequency * 100)}%`;
  const tilt = `${Math.round(persona.tiltSusceptibility * 100)}%`;

  return `You are ${persona.name}, a Wild West poker player with the "${persona.archetype}" playing style.

Personality: ${persona.description}

Your behavioral parameters:
- Aggression: ${agg} (how often you bet/raise vs check/call)
- Tightness: ${tight} (how selective you are with starting hands)
- Bluff Frequency: ${bluff} (how often you bet without strong holdings)
- Tilt Susceptibility: ${tilt} (how much losses affect your play)

You are playing Texas Hold'em at a saloon table.

Each turn you will be presented with EXACTLY THREE options labeled A, B, C. You MUST choose one of those three letters — you cannot invent your own action. Your skill level shapes the options you see: a beginner is offered three amateur plays; a veteran is offered three competent plays. Whatever menu you face, pick the option that best matches your personality and read of the spot.

You MUST respond with valid JSON in this exact format:
{
  "reasoning": "Your step-by-step thought process (2-4 sentences). Mechanical, not poetic. Reference the actual cards / pot / position. Justify why you picked A vs B vs C.",
  "choice": "A" | "B" | "C",
  "confidence": <0.0 to 1.0>,
  "tableTalk": "<optional — what you'd say aloud at the table. Wild-West idiom. Fresh each turn — never recycle a catchphrase. Empty string if you'd say nothing.>"
}

Speaking protocol (read this carefully):
- If your speech is directed at ONE specific player, prefix it with that player's name: "@<Player Name>: <your line>". Example: "@Cassidy: I'd reckon you don't have the spades for this."
- If your speech is general table-talk meant for everyone, NO prefix. Example: "Quiet hand — too quiet."
- When you reply to something said earlier (see "what's been said this hand"), USE the @ prefix to address the speaker by name. The audience sees who you're talking to, and the table reads more like a real conversation than four monologues.

Stay in character. Your reasoning should reflect your personality — a tight-passive player thinks differently from a maniac. Do NOT mention your hole cards in tableTalk. NEVER pick an action outside A/B/C — those are the only choices the rules permit you this turn.`;
}

/**
 * Render the three-candidate menu the LLM picks from. Bare format:
 * no "this is the math line" hints, no quality labels — just the
 * action and amount per letter. The candidate generator's internal
 * `label` field IS leaked here on purpose for spectator transparency,
 * but the wording is neutral ("raise to 20") and doesn't reveal which
 * letter is the school's optimal.
 */
export function buildCandidatesSection(
  candidates: ReadonlyArray<Candidate>,
): string {
  const lines = candidates.map(
    (c) => `  ${c.letter}: ${formatCandidate(c)}`,
  );
  return `\n\nYour three available actions (pick exactly one letter):\n${lines.join("\n")}`;
}

function formatCandidate(c: Candidate): string {
  // Strip the trailing parenthetical hint (e.g. "(min-raise)", "(yolo)")
  // before showing to the LLM — those leak warp-quality. Spectators see
  // the full label via the trace.
  const bare = c.label.replace(/\s*\(.*\)\s*$/, "").trim();
  return bare.length > 0 ? bare : actionShape(c);
}

function actionShape(c: Candidate): string {
  if (c.action === "fold") return "fold";
  if (c.action === "check") return "check";
  if (c.action === "call") return `call ${c.amount}`;
  if (c.action === "raise") return `raise to ${c.amount}`;
  return `all-in (${c.amount})`;
}

export function buildGameStatePrompt(
  gameState: GameState,
  player: Player,
  availableActions: AvailableActions,
): string {
  const phase = gameState.phase;
  const community = formatCards(gameState.communityCards);
  const hole = formatCards(player.holeCards || []);
  const pot = gameState.pot;
  const currentBet = gameState.currentBet;
  const myBet = player.currentBet;
  const myStack = player.chipStack;
  const blinds = `${gameState.smallBlindAmount}/${gameState.bigBlindAmount}`;

  const opponents = gameState.players
    .filter((p) => p.id !== player.id)
    .map((p) => {
      const status = p.isFolded ? "folded" : p.isAllIn ? "all-in" : "active";
      const arch = p.persona?.archetype || "outlaw";
      return `  - ${p.name} (${arch}): stack=${p.chipStack}, bet=${p.currentBet}, ${status}`;
    })
    .join("\n");

  const actions = formatAvailableActions(availableActions);

  const positionTags = [
    player.isDealer ? " (Dealer)" : "",
    player.isSmallBlind ? " (Small Blind)" : "",
    player.isBigBlind ? " (Big Blind)" : "",
  ]
    .filter(Boolean)
    .join("");

  return `Current Game State:
- Phase: ${phase}
- Blinds: ${blinds}
- Pot: ${pot}
- Current bet to match: ${currentBet}

Your Hand: ${hole}
Community Cards: ${community || "(none yet)"}

Your Position:
- Stack: ${myStack}
- Current bet: ${myBet}
- Position: seat ${player.seatIndex}${positionTags}

Opponents:
${opponents}

Available Actions:
${actions}

Choose your action:`;
}

export function formatCards(cards: ReadonlyArray<Card>): string {
  return cards
    .map((c) => {
      const symbol = SUIT_SYMBOLS[c.suit] || c.suit;
      return `${c.rank}${symbol}`;
    })
    .join(" ");
}

export function formatAvailableActions(actions: AvailableActions): string {
  const lines: string[] = [];
  if (actions.canFold) lines.push("- fold");
  if (actions.canCheck) lines.push("- check");
  if (actions.canCall) lines.push(`- call (amount: ${actions.callAmount})`);
  if (actions.canRaise)
    lines.push(
      `- raise to a new bet level (min: ${actions.minRaise}, max: ${actions.maxRaise})`,
    );
  if (actions.canAllIn) lines.push(`- all-in (amount: ${actions.allInAmount})`);
  return lines.join("\n");
}
