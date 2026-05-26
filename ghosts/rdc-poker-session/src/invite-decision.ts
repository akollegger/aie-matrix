/**
 * Decide whether to accept a poker invite.
 *
 * One LLM call. Inputs: the ghost's slider profile (translated into a
 * persona summary), the offer shape, current Cyphers balance. Output:
 * `{accept, reasoning}` with reasoning written in the ghost's voice,
 * in character — no canned phrases, ever.
 *
 * Sized cheap (small max tokens, low temp). The whole point of using
 * an LLM here is that the user can read why a ghost sat out / sat down
 * and it sounds like the ghost talking, not a switch statement.
 */

import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import { chatJson } from "./llm-client.js";
import { personaFromSliders } from "./persona-from-sliders.js";
import type { RdcPokerInvite } from "./spawn-types.js";

export interface InviteDecisionInput {
  readonly state: PersonalityState;
  readonly invite: RdcPokerInvite;
  /** Current Cyphers balance, queried from the ledger by the executor. */
  readonly cyphersBalance: number;
  /** Resolved persona shape — same one the poker brain uses. */
  readonly displayName: string;
  readonly ghostId: string;
  readonly role: "outlaw" | "marshall";
}

export interface InviteDecisionOutput {
  readonly accept: boolean;
  readonly reasoning: string;
}

const SYSTEM_PROMPT = `You are a Wild West character at a saloon. Someone's just invited you to a poker hand. Decide whether to sit down and tell us why — in your own voice, in character.

You receive:
- Your persona — who you are, your slider-shaped traits.
- The offer — buy-in, table size, the setting.
- Your current Cyphers balance (the saloon's token — no real-world value).

Your decision balances:
- Affordability — is the buy-in a reasonable fraction of your stack? A good rule of thumb is "comfortable up to a third of your stack; risky beyond half".
- Mood — your sliders shape whether you're feeling sociable, combative, withdrawn, restless.
- Strategic sense — high tightness ghosts don't gamble loose; high aggression ghosts can't resist a good fight.

Output strict JSON only:
{
  "accept": true | false,
  "reasoning": "<1-2 sentences in your own voice. Wild-West character, your speech, your idiom. No third-person narration. Do not start with 'I' more than once. Do not echo a 'catchphrase' — speak fresh.>"
}

Rules for the reasoning:
- Speak as the character would, not about the character. Direct speech.
- Reference the actual numbers when they matter (the buy-in, your stack) but don't recite them mechanically.
- Be specific to your slider profile — a withdrawn ghost sounds different from a brash one. Don't write generic Wild-West cosplay; write THIS ghost.
- Keep it under 25 words. Conversational, not poetic.`;

export async function decideInvite(
  input: InviteDecisionInput,
): Promise<InviteDecisionOutput> {
  const persona = personaFromSliders({
    ghostId: input.ghostId,
    displayName: input.displayName,
    state: input.state,
    role: input.role,
  });
  const pct = (n: number): string => `${Math.round(n * 100)}%`;

  const user = [
    `Persona: ${persona.name} — ${persona.archetype}`,
    `Aggression ${pct(persona.aggression)}  Tightness ${pct(persona.tightness)}  Bluff frequency ${pct(persona.bluffFrequency)}  Tilt susceptibility ${pct(persona.tiltSusceptibility)}`,
    persona.description,
    "",
    `Current Cyphers balance: ${input.cyphersBalance}`,
    `Buy-in: ${input.invite.buyIn}  (${Math.round((input.invite.buyIn / Math.max(1, input.cyphersBalance)) * 100)}% of your stack)`,
    `Setting: ${input.invite.setting}`,
    `Players at the table: ${input.invite.currentPlayers} (max ${input.invite.maxPlayers})`,
    `Blinds: ${input.invite.smallBlind}/${input.invite.bigBlind}`,
    "",
    "Are you in? Speak in your own voice. JSON only.",
  ].join("\n");

  const { value } = await chatJson<{
    accept?: unknown;
    reasoning?: unknown;
  }>({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.85,
    maxTokens: 160,
  });

  const accept = Boolean(value.accept);
  const reasoning =
    typeof value.reasoning === "string" && value.reasoning.trim().length > 0
      ? value.reasoning.trim()
      : accept
        ? "(silent nod)"
        : "(shakes head, says nothing)";

  return { accept, reasoning };
}
