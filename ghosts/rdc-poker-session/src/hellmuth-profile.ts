/**
 * Phil Hellmuth's animal-type profiler, mapped from peppers slider
 * profiles. Returns a fitness score (0..1) for each of the five types
 * defined in *Play Poker Like the Pros*:
 *
 *   - **Mouse** — ultra-tight; only top-10 hands; rarely raises;
 *                "when he raises, he has the goods".
 *   - **Lion** — tough TAG; not limited to premiums; bluffs with
 *               timing; reads other bluffs.
 *   - **Jackal** — loose-wild; many pots, frequent raises, big
 *                 swings; gives money away.
 *   - **Elephant** — calling station; never folds because never
 *                   believes you have the hand.
 *   - **Eagle** — top of the world; rare bird; strong across all
 *                dimensions.
 *
 * The orchestrator collects fitness scores from every player at a
 * table and assigns each a UNIQUE animal so the table always has a
 * mix. See `rdc-orchestrator/src/animal-assignment.ts`.
 */

import { toDisplay, type PersonalityState } from "@aie-matrix/ghost-peppers-inner";

export type AnimalType = "mouse" | "lion" | "jackal" | "elephant" | "eagle";

export const ANIMAL_TYPES: ReadonlyArray<AnimalType> = [
  "mouse",
  "lion",
  "jackal",
  "elephant",
  "eagle",
];

export type AnimalFitness = Readonly<Record<AnimalType, number>>;

function read01(
  state: PersonalityState,
  facet: keyof PersonalityState,
  axis: "internal" | "external",
): number {
  return Math.max(0, Math.min(1, toDisplay(state[facet][axis]) / 10));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Compute fitness for each animal type from a slider profile. Higher
 * = better fit for that archetype.
 *
 * Mappings (read each Hellmuth description and pick the slider
 * combination that produces that style of play):
 *
 * Mouse — high Deliberation (thinks first), low Assertiveness
 *   (rarely raises), high Stability (no swings), low Ideas (doesn't
 *   chase novelty / trash hands).
 * Lion — high Assertiveness AND high Deliberation (controlled
 *   aggression), high Self-Monitoring (reads opponents), high
 *   Stability (disciplined under pressure).
 * Jackal — high Assertiveness, low Deliberation (acts before
 *   thinking), high Ideas (restless), low Stability (volatile).
 * Elephant — low Deliberation (doesn't think to fold), low
 *   Assertiveness (passive), low Self-Monitoring (doesn't read
 *   bluff strength), high Warmth (likes being in the action).
 * Eagle — strong on EVERY axis. We use min() so a single weak
 *   slider tanks the score; "rare bird" needs no weak links.
 */
export function animalFitness(state: PersonalityState): AnimalFitness {
  const ideas_int = read01(state, "Ideas", "internal");
  const delib_int = read01(state, "Deliberation", "internal");
  const ass_ext = read01(state, "Assertiveness", "external");
  const warm_int = read01(state, "Warmth", "internal");
  const stab_int = read01(state, "Stability", "internal");
  const sm_int = read01(state, "Self-Monitoring", "internal");

  const mouse = clamp01(
    0.40 * delib_int +
    0.30 * (1 - ass_ext) +
    0.20 * stab_int +
    0.10 * (1 - ideas_int),
  );

  const lion = clamp01(
    0.30 * ass_ext +
    0.25 * delib_int +
    0.25 * sm_int +
    0.20 * stab_int,
  );

  const jackal = clamp01(
    0.30 * ass_ext +
    0.30 * (1 - delib_int) +
    0.20 * ideas_int +
    0.20 * (1 - stab_int),
  );

  const elephant = clamp01(
    0.30 * (1 - delib_int) +
    0.30 * (1 - ass_ext) +
    0.20 * (1 - sm_int) +
    0.20 * warm_int,
  );

  // Eagle requires strength on all four core dimensions — a single
  // weak link tanks the score.
  const eagle = Math.min(delib_int, ass_ext, sm_int, stab_int);

  return { mouse, lion, jackal, elephant, eagle };
}

/**
 * Plain-English description of each animal type — fed to the poker
 * brain so it knows what its own type means and what to expect from
 * opponents.
 */
export const ANIMAL_DESCRIPTIONS: Readonly<Record<AnimalType, string>> = {
  mouse:
    "Ultra-tight. Only plays the top 10 starting hands. Almost never raises; when they do, they have the goods. Easy to bluff because they fold to pressure.",
  lion:
    "Tight but not just top-10. Aggressive when they should be, disciplined when they shouldn't. Bluffs with excellent timing and reads other players' bluffs. Tough opponent.",
  jackal:
    "Loose and wild. Plays many pots, raises often, gives money away on bad days but can be ruinous on good ones. Big swings; emotional.",
  elephant:
    "Calling station. Never folds when they should because they never believe you have the goods. Don't try to bluff them — they'll call you down with bottom pair.",
  eagle:
    "Top of the world. Rare bird. Strong on every dimension — controlled aggression, perfect reads, ironclad discipline.",
};
