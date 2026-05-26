/**
 * RFC-0019 — game-agnostic encounter brain. Decides whether the social
 * ghost wants to engage with a mini-game opportunity it's near. One LLM
 * call. Returns accept/decline + a short in-character reasoning string.
 *
 * Generalised from the original RDC-specific encounter brain: the
 * mini-game class and any game-specific hints (buy-in, stakes, etc.)
 * are passed as free-form context so this works for any platform class
 * the host catalogue knows about.
 */
import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import { chatJson } from "./llm-client.js";
import type { PlatformEncounter } from "./spawn-types.js";

export interface EncounterDecisionInput {
  readonly state: PersonalityState;
  readonly displayName: string;
  readonly ghostId: string;
  readonly encounter: PlatformEncounter;
  /** Standing objective the ghost is in the world to pursue. When the
   *  objective explicitly names the kind of venue the ghost is now
   *  facing (e.g. "make your way to the poker table"), the brain
   *  treats arrival as the moment of execution — accepting is the
   *  honest choice, declining the dissonant one. Omit when unknown. */
  readonly objective?: string;
}

export interface EncounterDecisionOutput {
  readonly accept: boolean;
  readonly reasoning: string;
}

const SYSTEM_PROMPT = `You're a ghost in a hex world. You've just walked near a mini-game venue and are deciding whether to engage. You will be given:
- Who you are (display name, slider profile)
- Your STANDING OBJECTIVE — what you're in this world to do
- The kind of game underway (e.g. PokerTable, DuelGround)
- Setting + crowd
- Optional game-specific hints
- An optional in-character "barker" line

Decide whether to step in.

The PRIMARY rule:
- If your standing objective names this kind of venue (or names "the table", "playing", "the game", etc., for a PokerTable, etc.), then ARRIVING is the moment of execution. Decline only if there's a strong personality-grounded reason — exhaustion, fear, a dramatic shift in mood. Wandering up to the very thing you came here to do and then walking past is the failure mode we are explicitly trying to avoid. "I'm not in the mood" is not a reason; "the table is full" is. Honor the objective unless reality blocks it.
- If your objective is silent about the venue, fall back to mood-and-fit reasoning below.

Mood-and-fit rules of thumb (when the objective doesn't decide it for you):
- Aggressive / extraverted types itch to play; withdrawn types pass; restless types are drawn in by novelty
- Familiar names at the venue shift the odds toward engaging
- "Full" venues (zero seats open) are off the table — politely decline with intent to "find another or come back later"
- Walk away gracefully if it's genuinely not your moment

Output strict JSON only:
{
  "accept": true | false,
  "reasoning": "<1-2 sentences in your own voice. Reference specifics where they matter — especially whether the objective pulled you in.>"
}`;

function summarisePersonality(state: PersonalityState): string {
  // Keep this terse — the brain doesn't need full facet decomposition.
  // One sentence per dimension worth mentioning.
  const lines: string[] = [];
  for (const [facet, trait] of Object.entries(state)) {
    const i = trait.internal;
    const e = trait.external;
    lines.push(`  ${facet}: int=${i}, ext=${e}`);
  }
  return lines.join("\n");
}

export async function decideEncounter(
  input: EncounterDecisionInput,
): Promise<EncounterDecisionOutput> {
  const e = input.encounter;
  const seatsTaken = e.seatsTotal - e.seatsOpen;

  const lines: string[] = [
    `You: ${input.displayName} (ghost ${input.ghostId.slice(0, 8)})`,
    `Personality (8-facet, internal/external sliders 0..10):`,
    summarisePersonality(input.state),
    "",
  ];
  if (input.objective && input.objective.trim().length > 0) {
    lines.push("Your standing objective (what you came here to do):");
    lines.push(input.objective.trim());
    lines.push("");
  }
  lines.push(
    `Venue: ${e.platformClass}`,
    `Setting: ${e.setting}`,
    `Seats: ${seatsTaken}/${e.seatsTotal} taken (${e.seatsOpen} open)`,
  );
  if (e.seatedNames.length > 0) {
    lines.push(`At the venue: ${e.seatedNames.join(", ")}`);
  }
  if (e.hints && Object.keys(e.hints).length > 0) {
    lines.push("Hints:");
    for (const [k, v] of Object.entries(e.hints)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  if (e.barker) {
    lines.push("");
    lines.push(`Heard at the door: "${e.barker}"`);
  }
  lines.push("");
  lines.push(
    e.seatsOpen === 0
      ? "The venue is full. JSON only — typically decline politely."
      : "Engage? JSON only.",
  );

  const { value } = await chatJson<{
    accept?: unknown;
    reasoning?: unknown;
  }>({
    system: SYSTEM_PROMPT,
    user: lines.join("\n"),
    temperature: 0.85,
    maxTokens: 160,
  });

  const accept = Boolean(value.accept);
  const reasoning =
    typeof value.reasoning === "string" && value.reasoning.trim().length > 0
      ? value.reasoning.trim()
      : accept
        ? "(nods, steps inside)"
        : "(walks past)";
  return { accept, reasoning };
}
