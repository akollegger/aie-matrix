/**
 * Encounter brain — fires when the orchestrator detects an RDC ghost
 * on a saloon-platform tile. The agent decides whether to walk over
 * and sit down (or be added to the waiting ledger).
 *
 * One LLM call. Mirrors `invite-decision.ts` but with platform
 * framing — there's no buy-in negotiation step here, and the agent
 * may walk away rather than commit.
 */

import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import { chatJson } from "./llm-client.js";
import { personaFromSliders } from "./persona-from-sliders.js";
import type { RdcPlatformEncounter } from "./spawn-types.js";

export interface EncounterDecisionInput {
  readonly state: PersonalityState;
  readonly displayName: string;
  readonly ghostId: string;
  readonly role: "outlaw" | "marshall";
  readonly encounter: RdcPlatformEncounter;
  /** Ghost's current Cyphers balance from the in-world ledger. */
  readonly cyphersBalance: number;
}

export interface EncounterDecisionOutput {
  readonly accept: boolean;
  readonly reasoning: string;
}

const SYSTEM_PROMPT = `You're a Wild West character moving through the world. You've just walked into the saloon and noticed a poker game underway. Decide whether to sit down (or wait for a seat).

You will be given:
- Who you are (persona, slider profile)
- Your current Cyphers balance (the saloon's in-world token — no real-world value)
- The platform: who's already at the table, how many seats are open, the buy-in
- An optional in-character "barker" line if the platform calls out to you

Decision rules of thumb:
- Affordability: comfortable up to about a third of your stack as a buy-in
- Mood: aggressive types itch to play; withdrawn types pass; restless types are drawn in for the novelty
- Names at the table: a familiar face (good or bad) shifts the odds. The brain might already remember some of these from prior hands; if so, factor it in
- Walk away gracefully if it's not your moment — there's always another hand

Output strict JSON only:
{
  "accept": true | false,
  "reasoning": "<1-2 sentences in your own voice. Wild-West cadence. Reference the actual numbers (your stack, the buy-in) where they matter. No 'I' more than once. Don't echo a catchphrase — speak fresh.>"
}`;

export async function decideEncounter(
  input: EncounterDecisionInput,
): Promise<EncounterDecisionOutput> {
  const persona = personaFromSliders({
    ghostId: input.ghostId,
    displayName: input.displayName,
    state: input.state,
    role: input.role,
  });

  const e = input.encounter;
  const buyInRatio = input.cyphersBalance > 0 ? e.buyIn / input.cyphersBalance : 1;
  const lines: string[] = [
    `Persona: ${persona.name} — ${persona.archetype}`,
    persona.description,
    "",
    `Your Cyphers balance: ${input.cyphersBalance}`,
    `Buy-in: ${e.buyIn}  (${Math.round(buyInRatio * 100)}% of your stack)`,
    `Setting: ${e.setting}`,
    `Seats: ${e.seatsTotal - e.seatsOpen}/${e.seatsTotal} taken (${e.seatsOpen} open${e.waitingCount > 0 ? `, ${e.waitingCount} waiting` : ""})`,
  ];
  if (e.seatedNames.length > 0) {
    lines.push(`Already at the table: ${e.seatedNames.join(", ")}`);
  }
  if (e.barker) {
    lines.push("");
    lines.push(`The dealer calls: "${e.barker}"`);
  }
  lines.push("");
  lines.push("Sit down? JSON only.");

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
        ? "(silent nod)"
        : "(walks past)";
  return { accept, reasoning };
}
