/**
 * Reflection brain. Once every three hands the orchestrator asks each
 * agent: given how the past three hands went, do you want to stick
 * with your current Hellmuth animal type or switch?
 *
 * Single LLM call. The agent reads its persona, current type, and
 * recent results, and decides — in character. The orchestrator then
 * collects all stick/switch answers and runs a fresh brute-force
 * assignment that (a) honours stickers' current type and (b) forbids
 * switchers from staying in their current type.
 */

import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import { ANIMAL_DESCRIPTIONS, type AnimalType } from "./hellmuth-profile.js";
import { chatJson } from "./llm-client.js";
import { personaFromSliders } from "./persona-from-sliders.js";

export interface ReflectInput {
  readonly state: PersonalityState;
  readonly displayName: string;
  readonly ghostId: string;
  readonly role: "outlaw" | "marshall";
  readonly currentAnimal: AnimalType;
  readonly currentBalance: number;
  readonly netSinceLastReflection: number;
  readonly handsPlayed: number;
  readonly recentOutcomes?: ReadonlyArray<string>;
}

export interface ReflectOutput {
  readonly decision: "stick" | "switch" | "leave";
  readonly reasoning: string;
}

const SYSTEM_PROMPT = `You are a Wild West poker player taking stock between hands. The table just played three hands; now's the moment to ask three questions: is the table good, is your style working, is it time to walk away?

You will be given:
- Who you are (persona, slider profile)
- Your current Hellmuth animal type and what it means
- Your current Cyphers balance and how it changed over the last three hands
- One-line summaries of recent results

Decide ONE of three:
- STICK with your current animal type, stay seated
- SWITCH animal types (still seated; orchestrator will reassign you to a different style)
- LEAVE the table — get up, return to the world, find your luck elsewhere

Reasoning principles:
- A losing animal is not automatically wrong — short variance is real. But three hands of bleeding chips against a mostly-loose table might mean your tight Mouse style isn't punishing them.
- A winning animal is not automatically right — you might be running hot.
- Persona matters: an inwardly cautious player switching to Jackal is forcing a style that doesn't fit them. Switches should make sense for who you are AND what's been happening.
- LEAVE when: stack is dwindling fast and the table seems to have your number, or you're sitting on a big win and feeling the urge to bank it, or the company has soured. Don't leave just because variance hit you for one hand.
- The orchestrator decides which NEW type you'll get if you switch — you don't pick it.

Output strict JSON only:
{
  "decision": "stick" | "switch" | "leave",
  "reasoning": "<1-2 sentences in your own voice, in character. Reference the actual numbers (your stack, the swing) when they matter. Don't say 'I' more than once.>"
}`;

export async function invokeReflectionBrain(
  input: ReflectInput,
): Promise<ReflectOutput> {
  const persona = personaFromSliders({
    ghostId: input.ghostId,
    displayName: input.displayName,
    state: input.state,
    role: input.role,
  });
  const swing =
    input.netSinceLastReflection >= 0
      ? `+${input.netSinceLastReflection}`
      : `${input.netSinceLastReflection}`;

  const lines: string[] = [];
  lines.push(`Persona: ${persona.name} — ${persona.archetype}`);
  lines.push(persona.description);
  lines.push("");
  lines.push(
    `Your current animal type: ${input.currentAnimal.toUpperCase()}`,
  );
  lines.push(`  ${ANIMAL_DESCRIPTIONS[input.currentAnimal]}`);
  lines.push("");
  lines.push(`Cyphers now: ${input.currentBalance}`);
  lines.push(`Net change over last 3 hands: ${swing}`);
  lines.push(`Hands played at this table so far: ${input.handsPlayed}`);
  if (input.recentOutcomes && input.recentOutcomes.length > 0) {
    lines.push("");
    lines.push("Recent results:");
    for (const o of input.recentOutcomes) lines.push(`  - ${o}`);
  }
  lines.push("");
  lines.push("Stick or switch? JSON only.");

  const user = lines.join("\n");

  const { value } = await chatJson<{
    decision?: unknown;
    reasoning?: unknown;
  }>({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.7,
    maxTokens: 200,
  });

  let decision: "stick" | "switch" | "leave";
  if (value.decision === "switch") decision = "switch";
  else if (value.decision === "leave") decision = "leave";
  else decision = "stick";

  const reasoning =
    typeof value.reasoning === "string" && value.reasoning.trim().length > 0
      ? value.reasoning.trim()
      : decision === "stick"
        ? "(stays the course)"
        : decision === "switch"
          ? "(time for a change of style)"
          : "(time to ride out)";
  return { decision, reasoning };
}
