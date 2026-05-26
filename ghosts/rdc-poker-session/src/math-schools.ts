/**
 * Math school assignment — RFC-0018.
 *
 * Each ghost gets exactly one math school the first time they sit down
 * at a poker table. The assignment is deterministic over the ghost's
 * *starting* personality (not the drifted runtime state), and once set
 * it never changes — even if sliders drift through social play.
 *
 * For now the school is just a tag on the ghost; the RFC's
 * tier-dependent math-block injection lands in a follow-up.
 */
import {
  DISPLAY_MIDPOINT,
  toDisplay,
  type FacetName,
  type PersonalityState,
  type TraitState,
} from "@aie-matrix/ghost-peppers-inner";

export type MathSchool =
  | "Sklansky"
  | "Chen"
  | "Harrington"
  | "GTO"
  | "Exploitative"
  | "ICM"
  | "Hellmuth";

export const MATH_SCHOOLS: readonly MathSchool[] = [
  "Sklansky",
  "Chen",
  "Harrington",
  "GTO",
  "Exploitative",
  "ICM",
  "Hellmuth",
] as const;

/** Display names — shown on the saloon overlay and in spectator copy. */
export const SCHOOL_FLAVOR_NAMES: Readonly<Record<MathSchool, string>> = {
  Sklansky: "Slim Lansky",
  Chen: "Wild Bill Chen",
  Harrington: "Doc Harrington",
  GTO: "Grand Theft Oro",
  Exploitative: "Doyle the Drifter",
  ICM: "Independent Chip Marshal",
  Hellmuth: "Hellmouth",
};

/** Slider value as a centered display number; midpoint 5 → 0. */
function centered(
  state: PersonalityState,
  facet: FacetName,
  axis: "internal" | "external",
): number {
  const trait: TraitState = state[facet];
  return toDisplay(trait[axis]) - DISPLAY_MIDPOINT;
}

/**
 * Map a personality profile to a math school. The mapping is a small
 * linear score per school — pick the highest. Deterministic on input.
 *
 * Personality signals — see RFC-0018 §"Mathematical schools" for the
 * doctrinal grounding; these are the slider directions that feel like
 * the school as a temperament:
 *
 *   Sklansky    deep deliberation, skeptical of bold pushes
 *   Chen        mechanical rule-following; deliberation over creativity
 *   Harrington  calm-aggressive; zone-aware self-monitoring
 *   GTO         self-monitored, deliberate, low aggression variance
 *   Exploitative creative + visibly aggressive + opportunistic
 *   ICM         high stability + cautious posture + self-monitoring
 *   Hellmuth    theatrical (high external warmth + assertiveness),
 *                self-monitored image, creative reads
 *
 * Ties are broken by `MATH_SCHOOLS` insertion order. The function does
 * NOT randomise — same starting personality always produces the same
 * school. That's intentional: the "starting personality" is the
 * deterministic seed for who you are as a player.
 */
export function assignMathSchool(state: PersonalityState): MathSchool {
  const ci = (facet: FacetName) => centered(state, facet, "internal");
  const ce = (facet: FacetName) => centered(state, facet, "external");

  const scores: Record<MathSchool, number> = {
    Sklansky:
      ci("Deliberation") + 0.5 * ce("Trust") - ce("Assertiveness"),
    Chen: ci("Deliberation") - ci("Ideas"),
    Harrington:
      ci("Stability") + ce("Assertiveness") + ci("Self-Monitoring"),
    GTO:
      ci("Self-Monitoring") +
      ci("Deliberation") -
      Math.abs(ce("Assertiveness")),
    Exploitative:
      ci("Ideas") + ce("Assertiveness") - ci("Altruism"),
    ICM:
      ci("Stability") - ci("Assertiveness") + ci("Self-Monitoring"),
    Hellmuth:
      ce("Warmth") +
      ce("Assertiveness") +
      ci("Self-Monitoring") +
      0.5 * ci("Ideas"),
  };

  let best: MathSchool = MATH_SCHOOLS[0]!;
  let bestScore = -Infinity;
  for (const school of MATH_SCHOOLS) {
    if (scores[school] > bestScore) {
      bestScore = scores[school];
      best = school;
    }
  }
  return best;
}
