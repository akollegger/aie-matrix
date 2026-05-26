/**
 * Derive an `AgentPersona` for the poker brain from a peppers slider
 * profile. The persona's numeric parameters (aggression, tightness,
 * bluffFrequency, tiltSusceptibility) shape how the LLM brain inflects
 * its decision — but they're computed each turn from the *current*
 * slider state, so a long-running ghost slowly becomes a different
 * player as their personality drifts.
 *
 * Mapping (rough but honest):
 *   aggression          ← Assertiveness.external (high) + (1 - Stability.internal)
 *   tightness           ← Deliberation.internal (high)
 *   bluffFrequency      ← Self-Monitoring.external (high) + (1 - Trust.internal)
 *   tiltSusceptibility  ← (1 - Stability.internal)
 *
 * vpip / pfr / foldTo3Bet are filled with reasonable defaults derived
 * from aggression + tightness. They aren't enforced; the LLM uses them
 * as soft hints in the system prompt.
 */

import {
  STARTER_FACETS,
  toDisplay,
  type FacetName,
  type PersonalityState,
} from "@aie-matrix/ghost-peppers-inner";

import type { AgentPersona } from "@aie-matrix/ghost-rdc-poker";

/** Clamp a 0..1 value, just in case. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function read01(state: PersonalityState, facet: FacetName, axis: "internal" | "external"): number {
  const display = toDisplay(state[facet][axis]);
  return clamp01(display / 10);
}

function flavorPhrase(state: PersonalityState, role: "outlaw" | "marshall"): string {
  // Quick adjective sketch from a couple of dominant sliders.
  const warmth = read01(state, "Warmth", "external");
  const assertiveness = read01(state, "Assertiveness", "external");
  const stability = read01(state, "Stability", "internal");
  const tags: string[] = [];
  if (assertiveness > 0.6) tags.push("aggressive");
  else if (assertiveness < 0.4) tags.push("withdrawn");
  if (warmth > 0.6) tags.push("amiable");
  else if (warmth < 0.4) tags.push("hostile");
  if (stability < 0.4) tags.push("volatile");
  else if (stability > 0.7) tags.push("steady");
  if (tags.length === 0) tags.push("composed");
  return tags.join(", ") + (role === "marshall" ? " marshall" : " outlaw");
}

export interface PersonaDerivationInput {
  readonly ghostId: string;
  readonly displayName: string;
  readonly state: PersonalityState;
  readonly role: "outlaw" | "marshall";
}

export function personaFromSliders(input: PersonaDerivationInput): AgentPersona {
  const { ghostId, displayName, state, role } = input;
  const ass_ext = read01(state, "Assertiveness", "external");
  const stab_int = read01(state, "Stability", "internal");
  const delib_int = read01(state, "Deliberation", "internal");
  const sm_ext = read01(state, "Self-Monitoring", "external");
  const trust_int = read01(state, "Trust", "internal");

  const aggression = clamp01(0.55 * ass_ext + 0.45 * (1 - stab_int));
  const tightness = clamp01(delib_int);
  const bluffFrequency = clamp01(0.6 * sm_ext + 0.4 * (1 - trust_int));
  const tiltSusceptibility = clamp01(1 - stab_int);

  // VPIP / PFR / foldTo3Bet — softer hints. Loose-aggressive players have
  // high VPIP and PFR; tight-passive players the opposite.
  const vpip = clamp01(0.2 + 0.5 * (1 - tightness) + 0.2 * aggression);
  const pfr = clamp01(vpip * (0.4 + 0.5 * aggression));
  const foldTo3Bet = clamp01(0.3 + 0.5 * tightness - 0.2 * aggression);

  return {
    id: `rdc-${ghostId}`,
    name: displayName,
    archetype: flavorPhrase(state, role),
    description: describePersona(state, role),
    aggression,
    tightness,
    bluffFrequency,
    tiltSusceptibility,
    // Catchphrase intentionally empty — the brain produces fresh
    // in-character table talk each turn from the description + the
    // current game context. Hardcoded catchphrases caused every ghost
    // to echo the same default ("Ain't nothin' personal") and defeated
    // the point of using an LLM at the table.
    catchphrase: "",
    vpip,
    pfr,
    foldTo3Bet,
  };
}

function describePersona(state: PersonalityState, role: "outlaw" | "marshall"): string {
  // Walk the 8 facets and produce a one-paragraph read.
  const lines: string[] = [];
  lines.push(`${role === "marshall" ? "A marshall" : "An outlaw"} at the table.`);
  for (const facet of STARTER_FACETS) {
    const i = read01(state, facet, "internal");
    const e = read01(state, facet, "external");
    if (i > 0.7 || i < 0.3 || e > 0.7 || e < 0.3) {
      lines.push(facetDescriptor(facet, i, e));
    }
  }
  return lines.join(" ");
}

function facetDescriptor(facet: FacetName, internal: number, external: number): string {
  const tag = (v: number, hi: string, lo: string, mid: string) =>
    v > 0.7 ? hi : v < 0.3 ? lo : mid;
  switch (facet) {
    case "Ideas":
      return `${tag(internal, "Curious mind", "Plain mind", "")} ${tag(external, "vocally so", "kept private", "")}.`;
    case "Deliberation":
      return `${tag(internal, "Thinks carefully", "Acts on impulse", "")} ${tag(external, "shows it", "looks impulsive", "")}.`;
    case "Assertiveness":
      return `${tag(internal, "Inwardly bold", "Inwardly cautious", "")} ${tag(external, "outwardly forceful", "outwardly mild", "")}.`;
    case "Warmth":
      return `${tag(internal, "Warm-hearted", "Cold inside", "")} ${tag(external, "and shows it", "but cool outside", "")}.`;
    case "Trust":
      return `${tag(internal, "Trusting by nature", "Suspicious by nature", "")} ${tag(external, "openly", "while testing", "")}.`;
    case "Altruism":
      return `${tag(internal, "Wants to help", "Self-interested", "")} ${tag(external, "gives openly", "keeps it close", "")}.`;
    case "Stability":
      return `${tag(internal, "Steady inside", "Roiling inside", "")} ${tag(external, "and looks it", "but composed outside", "")}.`;
    case "Self-Monitoring":
      return `${tag(internal, "Self-aware", "Unselfconscious", "")} ${tag(external, "performs heavily", "is just as is", "")}.`;
  }
}

