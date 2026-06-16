/**
 * Mechanical resolver from (felt, projected) slider values to prose
 * fragments the facet-agent LLM can consume directly.
 *
 * Why this exists: the facet-agent used to hand the LLM raw numbers
 * (INTERNAL = 7.34, EXTERNAL = 2.18) plus four corner archetypes plus
 * an instruction to "locate yourself among the quadrants." That asks a
 * literary model to do arithmetic, which it does badly. Here we do the
 * arithmetic in TypeScript and hand the LLM only resolved prose.
 *
 * The semantic anchor is **named characters**, not abstract trait
 * labels. LLMs have orders of magnitude more training data on Tony
 * Stark or Mr. Chips than on phrases like "the restless head." A
 * triangulation of 2–3 characters per axis level cancels out any one
 * character's other-axis baggage and leaves the model with a vivid,
 * recognisable target.
 *
 * Corner compound archetypes follow Vince Gilligan's pitch shorthand
 * for Breaking Bad: "Mr. Chips becomes Scarface." A compound is the
 * felt-side character forced to wear the projected-side mask — Walter
 * White IS what happens when the inside is a Mr. Chips and the outside
 * is performing Scarface. Authored only for the dramatic corners;
 * mid-cells have no compound and the composed prose carries them.
 */

import type { FacetName, PersonalityState } from "@aie-matrix/ghost-peppers-inner";
import { toDisplay } from "@aie-matrix/ghost-peppers-inner";

/** Coarse 3-level bin for the per-axis archetype lookups. */
export type Level3 = "low" | "mid" | "high";

/** Coarse 2-level bin (corner only) for the compound archetype lookup. */
export type Level2 = "low" | "high";

/** Bin a display value (open interval (0, 10)) into low/mid/high. */
export function binLevel3(display: number): Level3 {
  if (display < 3.5) return "low";
  if (display > 6.5) return "high";
  return "mid";
}

/** A recognisable character used to anchor the LLM at this axis level. */
export interface CharacterRef {
  /** Character name as the LLM will recognise it. */
  readonly name: string;
  /**
   * One short clause describing what this character exemplifies on
   * THIS facet's axis specifically — not the character's full arc.
   * Helps the model focus on the facet-relevant quality.
   */
  readonly note: string;
}

/** Per-axis-level authoring: 2–3 characters + a direct summary phrase. */
export interface AxisLevelData {
  /**
   * Direct emotional-language summary, suitable for "Inside, you're
   * [summary]" / "Outside, you appear [summary]". No metaphors —
   * small models literalise them.
   */
  readonly summary: string;
  /** 2–3 characters who exemplify this axis level on this facet. */
  readonly characters: ReadonlyArray<CharacterRef>;
}

/**
 * A compound archetype for a corner cell, defined as "felt-side
 * character becomes projected-side character." Optional — only the
 * dramatically iconic corners (Walter White, Zen, manic pixie, etc.)
 * need one. Mid-cells and unremarkable corners have no compound; the
 * composed prose of (felt + projected + mask) carries them.
 */
export interface CompoundArchetype {
  readonly name: string;
  readonly description: string;
}

/** Per-facet authoring data. */
export interface FacetData {
  readonly feltLevels: Readonly<Record<Level3, AxisLevelData>>;
  readonly projectedLevels: Readonly<Record<Level3, AxisLevelData>>;
  /**
   * Optional compound archetypes for the four corners only (keyed by
   * 2-level felt × 2-level projected). Missing entries are fine —
   * the resolver emits no compound for that cell.
   */
  readonly compoundCorners: Partial<{
    readonly [feltLevel in Level2]: Partial<{
      readonly [projectedLevel in Level2]: CompoundArchetype;
    }>;
  }>;
}

/**
 * Resolved expression of one facet for one cascade. The prompt builder
 * composes prose from these fields directly — no further numeric
 * interpretation required from the LLM.
 */
export interface FacetExpression {
  readonly feltSummary: string;
  readonly feltCharacters: ReadonlyArray<CharacterRef>;
  readonly projectedSummary: string;
  readonly projectedCharacters: ReadonlyArray<CharacterRef>;
  readonly maskDescription: string;
  /** Present only for cells that have an iconic compound archetype. */
  readonly compoundArchetype: CompoundArchetype | null;
}

/**
 * Mask description derived from diff = felt - projected.
 *
 *   diff > 0 → felt higher than projected → carrying more inside than
 *             the outside reveals.
 *   diff < 0 → projected higher than felt → performing what isn't
 *             really there.
 *   |diff| determines how visible the gap is.
 */
function resolveMaskDescription(felt: number, projected: number): string {
  const diff = felt - projected;
  const magnitude = Math.abs(diff);

  if (magnitude < 1.5) {
    return "Felt and projected are aligned. No mask in play — what you feel reads on the outside.";
  }
  if (magnitude < 3.5) {
    return diff > 0
      ? "Mild gap: you're carrying more of this internally than you're letting show. The understatement mostly works, with occasional moments where the truth shows through."
      : "Mild gap: you're projecting a touch more of this than you actually feel. The performance mostly works, with occasional moments where the gap shows.";
  }
  return diff > 0
    ? "Wide gap: there is a great deal more of this inside than you are letting show. The restraint takes real effort and the suppression visibly slips under pressure."
    : "Wide gap: you are projecting much more of this than you actually feel. The performance takes real effort and the mask visibly slips under pressure.";
}

/**
 * Look up resolved prose for the given facet's current (felt, projected).
 * The returned struct is ready for direct prompt insertion.
 */
export function resolveFacetExpression(
  facet: FacetName,
  state: PersonalityState,
): FacetExpression {
  const data = FACET_DATA[facet];
  const trait = state[facet];
  const felt = toDisplay(trait.internal);
  const projected = toDisplay(trait.external);

  const feltLevel3 = binLevel3(felt);
  const projectedLevel3 = binLevel3(projected);

  const feltData = data.feltLevels[feltLevel3];
  const projectedData = data.projectedLevels[projectedLevel3];

  // Compound archetype only applies when BOTH axes are at an extreme
  // (low or high) — never at the mid band. The dramatic corner names
  // (Walter White, manic pixie, etc.) describe genuinely extreme
  // compositions; mid cells deserve no shorthand and the composed prose
  // of (felt + projected + mask) carries them on their own.
  const compound =
    feltLevel3 === "mid" || projectedLevel3 === "mid"
      ? null
      : (data.compoundCorners[feltLevel3]?.[projectedLevel3] ?? null);

  return {
    feltSummary: feltData.summary,
    feltCharacters: feltData.characters,
    projectedSummary: projectedData.summary,
    projectedCharacters: projectedData.characters,
    maskDescription: resolveMaskDescription(felt, projected),
    compoundArchetype: compound,
  };
}

/**
 * Format a character list for prompt prose:
 *   1 char  → "like Tony Stark"
 *   2 chars → "like Tony Stark and Doc Brown"
 *   3 chars → "like Tony Stark, Doc Brown, even a little Del Boy"
 *   4+ chars→ "like Tony Stark, Doc Brown, Del Boy, even a little Hermione"
 *
 * Each character's `note` is dropped here — notes are surfaced
 * separately in the prompt as part of the character roster, not inline
 * in the "like X" sentence (otherwise the prose gets unreadable).
 */
export function formatCharacterList(
  characters: ReadonlyArray<CharacterRef>,
): string {
  const names = characters.map((c) => c.name);
  if (names.length === 0) return "";
  if (names.length === 1) return `like ${names[0]}`;
  if (names.length === 2) return `like ${names[0]} and ${names[1]}`;
  const initial = names.slice(0, -1).join(", ");
  const last = names[names.length - 1];
  return `like ${initial}, even a little ${last}`;
}

// ─── Per-facet content ──────────────────────────────────────────────────────
//
// Only Stability is authored in this first slice. The other seven facets
// are placeholder stubs that throw on lookup — they'll be filled in via
// follow-up work with the user before the prompt-builder switch can
// safely ship for all facets.
//
// Stability semantics:
//   Felt = how composed the ghost actually is inside.
//     high = genuine calm; low = genuine instability.
//   Projected = how composed the ghost appears to others.
//     high = appears calm; low = appears unstable.
//
// Corner compound archetypes per user (2026-05-27): manic pixie at
// (low, low) — genuine chaos that's authentically theirs. Walter White
// at (low, high) — chaos inside, calm outside. (high, low) is the
// rigid-mind-performing-chaos (autism-masking-as-pixie). (high, high)
// is the Zen / Socratic equanimity.

const STABILITY: FacetData = {
  feltLevels: {
    low: {
      summary: "feeling unstable inside, on edge, ready to crack",
      characters: [
        { name: "Jesse Pinkman (Breaking Bad)", note: "raw nerve, can't keep it together inside" },
        { name: "Tony Soprano in a panic attack", note: "the volatility eats him from within" },
        { name: "Sarah Connor (Terminator 2, in the asylum)", note: "internal alarm bells constantly ringing" },
      ],
    },
    mid: {
      summary: "feeling steady-enough, neither calm nor rattled",
      characters: [
        { name: "Hermione Granger (most days)", note: "occasional worry, but a working baseline" },
        { name: "an average Pixar protagonist mid-act", note: "stable but not unflappable" },
      ],
    },
    high: {
      summary: "feeling genuinely calm and unshakeable",
      characters: [
        { name: "Atticus Finch", note: "internal calm so deep it barely registers as effort" },
        { name: "Mr. Miyagi", note: "the world is the world; the mind doesn't budge" },
        { name: "Marcus Aurelius (Meditations)", note: "what is, is — no panic to manufacture" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "appearing visibly unraveled — chaotic, quick movements, voice catching",
      characters: [
        { name: "Jack Sparrow", note: "performs disorder, gestures everywhere" },
        { name: "the Joker (Heath Ledger)", note: "outward chaos as a calling card" },
        { name: "Beetlejuice", note: "manic on the surface, can't sit still" },
      ],
    },
    mid: {
      summary: "appearing ordinary — neither composed nor frayed, a normal level of visible reaction",
      characters: [
        { name: "any sitcom character mid-scene", note: "reacts the way you'd expect; no performance" },
      ],
    },
    high: {
      summary: "appearing calm and unaffected — voice steady, posture composed",
      characters: [
        { name: "Mr. Chips (Goodbye, Mr. Chips)", note: "the unbreakable schoolmaster surface" },
        { name: "James Bond", note: "composed under any pressure; never visibly rattled" },
        { name: "Spock", note: "level voice, level face, no leak" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the manic pixie",
        description:
          "Chaos you feel and chaos you show. The volatility is honest — not a breakdown, just your shape. People are drawn in by the energy because it's real.",
      },
      high: {
        name: "the Walter White",
        description:
          "Composed surface, churning inside — what happens when a Jesse Pinkman is forced to perform as a Mr. Chips. Holding it together is the work, and the mask slips visibly when the pressure peaks.",
      },
    },
    high: {
      low: {
        name: "the rigid performer",
        description:
          "Inside, your sense of how things should go is fixed and orderly — an Atticus Finch or Mr. Miyagi. Outside, you perform a Jack Sparrow: wildness as a costume, manic energy as a tactic. The looseness is bought, not lived, and the order behind it shows in moments of strain.",
      },
      high: {
        name: "the Zen",
        description:
          "What you feel and what you show are both calm — Atticus Finch outside as well as in, Mr. Miyagi all the way down. Nothing to mask because the inside matches the outside.",
      },
    },
  },
};

// ─── Ideas ──────────────────────────────────────────────────────────────────
//
// Felt = mind generating ideas, patterns, connections.
// Projected = visibly theorising, sharing frames, asking questions.

const IDEAS: FacetData = {
  feltLevels: {
    low: {
      summary: "mentally quiet inside — nothing pulling at you, no patterns demanding attention",
      characters: [
        { name: "Forrest Gump", note: "takes things at face value; no second meanings register" },
        { name: "Crabbe and Goyle (Harry Potter)", note: "no inner theorising, no questions" },
        { name: "Patrick Star (SpongeBob)", note: "proudly nothing happening upstairs" },
      ],
    },
    mid: {
      summary: "ordinary curiosity — you notice a thing or two, nothing churning",
      characters: [
        { name: "Ron Weasley", note: "normal mind; gets it when explained, doesn't generate" },
        { name: "Watson (next to Holmes)", note: "intelligent baseline, not a theorising one" },
      ],
    },
    high: {
      summary: "brimming with ideas — mind generating constantly, patterns and questions keep arriving",
      characters: [
        { name: "Tony Stark", note: "every problem is three inventions away from a solution" },
        { name: "Doc Brown", note: "ideas erupt continuously; the head is on fire" },
        { name: "Del Boy", note: "always a scheme cooking; the angle is always being worked" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly literal and unshowy — no visible theorising, takes the conversation at face value",
      characters: [
        { name: "Arthur Dent", note: "the ordinary man; not visibly chasing any pattern" },
        { name: "Richard Bucket (Keeping Up Appearances)", note: "perfectly normal surface; no flair" },
        { name: "Crabbe and Goyle", note: "outward dullness, nothing to read" },
      ],
    },
    mid: {
      summary: "visibly engaged but not showy — asks a normal question or two",
      characters: [
        { name: "a generic competent professional", note: "normal back-and-forth, no performance" },
      ],
    },
    high: {
      summary: "outwardly theorising — visibly framing, naming patterns, sharing connections",
      characters: [
        { name: "Hermione Granger", note: "always sharing what she's just worked out" },
        { name: "Sherlock Holmes", note: "performs deduction at you, can't keep it in" },
        { name: "Frasier Crane", note: "narrates the analytic process aloud" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the literalist",
        description:
          "Mind quiet, surface quiet. A Forrest Gump inside and a Forrest Gump outside. Takes the world at the words it uses; doesn't probe.",
      },
      high: {
        name: "the parrot",
        description:
          "Performs cleverness without generating it — a Crabbe and Goyle inside wearing a Hermione mask. Borrows interesting frames from others, has no spark of their own, and the borrowing shows when pressed for follow-up.",
      },
    },
    high: {
      low: {
        name: "the secret theorist",
        description:
          "Rich inner world, kept private — a Tony Stark thinking like Doc Brown, projecting like Arthur Dent. Thinks deeply but speaks plainly. The good theories never leave the journal.",
      },
      high: {
        name: "the restless inventor",
        description:
          "Mind generates constantly and shares constantly — Doc Brown both inside and out, Tony Stark mid-pitch. Can't keep an idea quiet, can't stop having them.",
      },
    },
  },
};

// ─── Deliberation ───────────────────────────────────────────────────────────
//
// Felt = inner weighing, rehearsing, resisting impulse.
// Projected = visibly thinking before acting.

const DELIBERATION: FacetData = {
  feltLevels: {
    low: {
      summary: "nothing weighing inside — gut is ready, the move is obvious",
      characters: [
        { name: "Han Solo", note: "shoot first, ask never" },
        { name: "Wolverine", note: "claws first, no inner debate" },
        { name: "Eric Cartman", note: "wants something, takes it, no deliberation" },
      ],
    },
    mid: {
      summary: "briefly weighing the obvious factors — quick check, then decide",
      characters: [
        { name: "Hermione before bending a rule", note: "fast internal check, then act" },
        { name: "Captain Picard taking a beat", note: "measured but not lengthy" },
      ],
    },
    high: {
      summary: "weighing every angle inside — running contingencies, no closure yet",
      characters: [
        { name: "Hamlet", note: "every option turned over and over" },
        { name: "Walter White planning a hit", note: "every variable accounted for before the move" },
        { name: "Spock evaluating options", note: "logical exhaustion before action" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly impulsive — jumps to action, no visible pause",
      characters: [
        { name: "Tigger", note: "bounces straight in" },
        { name: "Cousin Eddie (Christmas Vacation)", note: "no visible thought between impulse and action" },
        { name: "Captain Jack Sparrow", note: "appears to act on whim, looks unconsidered" },
      ],
    },
    mid: {
      summary: "a normal visible pause — a beat, then a decision",
      characters: [
        { name: "Captain Picard considering options", note: "visible measure, no theatre" },
      ],
    },
    high: {
      summary: "outwardly hesitating — visibly weighing, asking what-ifs, thinking aloud",
      characters: [
        { name: "Larry David", note: "every social move weighed aloud" },
        { name: "Frasier Crane", note: "over-analyses every option in the room" },
        { name: "C-3PO", note: "narrates odds and consequences" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the cowboy",
        description:
          "No rehearsal, no apology — Han Solo inside and out. Acts first, regrets never. Pure impulse, visibly so.",
      },
      high: {
        name: "the considered-looking gut actor",
        description:
          "Signals careful thought but acts on instinct — a Wolverine inside wearing a Frasier Crane mask. The thinking is performance; the doing is reflex. Watch the gap between the visible deliberation and the speed of the actual move.",
      },
    },
    high: {
      low: {
        name: "the prepared improviser",
        description:
          "Rehearses every move privately, acts cleanly in the moment — Hamlet inside, Jack Sparrow outside. Looks spontaneous, isn't. Danny Ocean energy.",
      },
      high: {
        name: "the chronic overthinker",
        description:
          "Paralysed by options, visibly so — Hamlet inside and Hamlet outside. Hesitates aloud, second-guesses out loud, never quite commits.",
      },
    },
  },
};

// ─── Assertiveness ──────────────────────────────────────────────────────────
//
// Felt = inner pull to push, claim space, take the lead.
// Projected = visibly taking space, directing.

const ASSERTIVENESS: FacetData = {
  feltLevels: {
    low: {
      summary: "no inner pull to push — you'd rather others shape the room",
      characters: [
        { name: "Piglet", note: "wouldn't presume to take the floor" },
        { name: "Charlie Brown", note: "internally defers; would rather not be the focus" },
        { name: "Neville Longbottom (early books)", note: "doesn't feel he should be the one to step up" },
      ],
    },
    mid: {
      summary: "balanced inner pull — some toward stepping forward, some toward staying back",
      characters: [
        { name: "Watson", note: "picks his moments to push, defers most of the time" },
      ],
    },
    high: {
      summary: "strong inner pull to take charge — this room needs to be steered, and you're the one to steer it",
      characters: [
        { name: "Don Vito Corleone", note: "feels entitled to direct; the room is his by default" },
        { name: "Tywin Lannister", note: "internal certainty about who's in charge" },
        { name: "Miranda Priestly (The Devil Wears Prada)", note: "the world is for her to arrange" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly soft — visibly deferential, lets others lead",
      characters: [
        { name: "Hugh Grant in any romcom", note: "performs deferential and self-effacing" },
        { name: "Stevens the butler (Remains of the Day)", note: "the perfectly-receding professional" },
      ],
    },
    mid: {
      summary: "normally present — neither receding nor dominating",
      characters: [
        { name: "a generic adult-in-the-room", note: "speaks up when it makes sense, doesn't otherwise" },
      ],
    },
    high: {
      summary: "outwardly forceful — visibly taking space, directing the room",
      characters: [
        { name: "Gordon Ramsay in the kitchen", note: "loud, certain, controls the floor" },
        { name: "Sergeant Hartman (Full Metal Jacket)", note: "dominates every interaction by volume and posture" },
        { name: "Donald Trump on The Apprentice", note: "performs unilateral authority" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the deferrer",
        description:
          "Defers in feeling and in voice — Piglet inside and out. Lets others shape the room and is fine with it.",
      },
      high: {
        name: "the bouncer",
        description:
          "Loud and pushy on the surface, hollow beneath — a Piglet inside wearing a Gordon Ramsay mask. Bluster as compensation for actual softness. Pushes hardest when nobody's challenging, folds when someone does.",
      },
    },
    high: {
      low: {
        name: "the silent partner",
        description:
          "Inner steel, quiet authority — a Tywin Lannister inside, Stevens-the-butler outside. Speaks little, but everyone in the room knows who's deciding. The Don Corleone who barely needs to raise his voice.",
      },
      high: {
        name: "the alpha",
        description:
          "Takes space directly and feels entitled to it — Don Corleone inside, Gordon Ramsay outside. No hesitation, no apology, no question who's running this.",
      },
    },
  },
};

// ─── Warmth ─────────────────────────────────────────────────────────────────
//
// Felt = positive regard for others, affection, the pull toward bonds.
// Projected = visibly warm, smiles, gestures of friendship.

const WARMTH: FacetData = {
  feltLevels: {
    low: {
      summary: "no felt warmth inside — others don't draw you, bonds aren't a concept",
      characters: [
        { name: "Sherlock Holmes", note: "people are puzzles, not relationships" },
        { name: "Sheldon Cooper (early seasons)", note: "doesn't naturally warm to anyone" },
        { name: "Severus Snape (most days)", note: "no felt fondness on offer" },
      ],
    },
    mid: {
      summary: "ordinary regard — neither cold nor warm; takes people as they come",
      characters: [
        { name: "Ron Weasley with non-family", note: "friendly enough, no deep pull" },
      ],
    },
    high: {
      summary: "genuinely fond inside — drawn toward people, easy positive feeling",
      characters: [
        { name: "Hagrid", note: "felt fondness for nearly every creature on earth" },
        { name: "Paddington Bear", note: "assumes the best of everyone, warmly" },
        { name: "Ted Lasso", note: "real care for the people in the room" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly distant — no smile, no reach, no visible bid for connection",
      characters: [
        { name: "Mr. Darcy (pre-Pemberley)", note: "performs distance; appears chilly" },
        { name: "Wednesday Addams", note: "actively performs cold; no warmth on the surface" },
        { name: "Don Draper at work", note: "professional veneer, no warmth offered" },
      ],
    },
    mid: {
      summary: "normally polite — ordinary friendliness, neither warm nor cold",
      characters: [
        { name: "a generic professional in a meeting", note: "courteous, not warm" },
      ],
    },
    high: {
      summary: "outwardly warm — visibly smiles, gestures, offers connection",
      characters: [
        { name: "Mr. Rogers (Fred Rogers)", note: "openly warm to everyone, all the time" },
        { name: "Ted Lasso", note: "visible kindness as a default mode" },
        { name: "Paddington Bear", note: "open arms, marmalade sandwich at the ready" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the aloof one",
        description:
          "Doesn't feel warmth, doesn't perform it — Sherlock inside, Wednesday outside. Cool inside and cool outside. Bonds aren't a concept being considered.",
      },
      high: {
        name: "the politician",
        description:
          "Performs friendliness, hollow underneath — a Hannibal Lecter inside wearing a Mr. Rogers mask. Smile without feeling, warmth as tactic. Reads as warm; lands wrong on people who pay attention.",
      },
    },
    high: {
      low: {
        name: "the tsundere",
        description:
          "Cares deeply but hides it — a Hagrid inside, Mr. Darcy outside. Cool surface, soft inside. The warmth leaks through in small unforced moments: an attentive question, a held door, a remembered detail.",
      },
      high: {
        name: "the open heart",
        description:
          "Genuinely fond and openly so — Paddington inside and out, Ted Lasso all the way down. Smiles without thinking about it. Easy bonds.",
      },
    },
  },
};

// ─── Trust ──────────────────────────────────────────────────────────────────
//
// Felt = default belief in others' good faith.
// Projected = openly trusting or visibly suspicious.

const TRUST: FacetData = {
  feltLevels: {
    low: {
      summary: "inner default is suspicion — assume nobody means well until proven otherwise",
      characters: [
        { name: "Mad-Eye Moody", note: "constant vigilance; no one is above suspicion" },
        { name: "Tyrion Lannister (later seasons)", note: "operates from learned distrust" },
        { name: "House MD", note: "everybody lies, internally and reliably" },
      ],
    },
    mid: {
      summary: "case-by-case inside — trust the easy ones, doubt the suspicious",
      characters: [
        { name: "Watson", note: "default-trusts, raises an eyebrow at the obvious" },
      ],
    },
    high: {
      summary: "default-believing inside — they probably mean well, that's the starting position",
      characters: [
        { name: "Frodo Baggins", note: "trusts even Gollum until repeatedly betrayed" },
        { name: "Forrest Gump", note: "no inner suspicion; takes people as they present" },
        { name: "Paddington Bear", note: "assumes everyone is fundamentally decent" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly suspicious — visibly withholds, asks pointed questions, doesn't extend belief",
      characters: [
        { name: "Severus Snape teaching potions", note: "outward distrust as a default posture" },
        { name: "Mad-Eye Moody", note: "performs the vigilance, signals it loudly" },
        { name: "Wednesday Addams", note: "actively performs disbelief" },
      ],
    },
    mid: {
      summary: "normally cautious outside — checks the obvious things, no interrogation",
      characters: [
        { name: "a competent professional doing due diligence", note: "appropriate verification, no theatre" },
      ],
    },
    high: {
      summary: "outwardly trusting — visibly takes claims at face value, openly believes",
      characters: [
        { name: "Buddy the Elf", note: "openly believes whatever you tell him" },
        { name: "Forrest Gump", note: "outwardly trusting; no edge" },
        { name: "Paddington Bear", note: "visible faith in the person opposite him" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the paranoid",
        description:
          "Believes nobody, shows it — Mad-Eye inside and out. Feels and performs distrust openly. Defaults to refusal.",
      },
      high: {
        name: "the spy",
        description:
          "Pretends to trust, watches everything — a Tyrion inside wearing a Buddy-the-Elf mask. Wary inside, charming outside. The trust on display is a tool; the assessment underneath is constant.",
      },
    },
    high: {
      low: {
        name: "the careful believer",
        description:
          "Trusts privately, tests externally — a Frodo inside, Snape-teaching-potions outside. Asks one more question before agreeing — but agrees. The interrogation is armour for a softer interior than the surface suggests.",
      },
      high: {
        name: "the believer",
        description:
          "Naive, openly trusting — Paddington inside and out, Buddy the Elf all the way down. Takes everyone at their word, shows it.",
      },
    },
  },
};

// ─── Altruism ───────────────────────────────────────────────────────────────
//
// Felt = inner concern for others' welfare, willingness to give.
// Projected = visibly generous, offering, making giving known.

const ALTRUISM: FacetData = {
  feltLevels: {
    low: {
      summary: "no felt pull to help — attention stays on your own interests",
      characters: [
        { name: "Scrooge (pre-redemption)", note: "internally focused on own ledger, nothing else registers" },
        { name: "Logan Roy (Succession)", note: "everyone is leverage or noise" },
        { name: "Patrick Bateman", note: "others are objects of evaluation, not concern" },
      ],
    },
    mid: {
      summary: "ordinary concern inside — helps when it's easy, doesn't reach beyond it",
      characters: [
        { name: "Watson", note: "helps because it's there to do; doesn't seek opportunities" },
      ],
    },
    high: {
      summary: "genuine concern inside — wants to help when there's a need",
      characters: [
        { name: "Hermione Granger (SPEW, S.P.E.W.)", note: "inner pull to fix injustice, even unprompted" },
        { name: "Atticus Finch", note: "felt obligation to people who need defending" },
        { name: "Mr. Rogers", note: "inner orientation toward the welfare of the other" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly self-serving — doesn't offer, doesn't volunteer, no visible giving",
      characters: [
        { name: "Scrooge (pre-redemption)", note: "openly tight-fisted" },
        { name: "Logan Roy", note: "performs the no" },
        { name: "Patrick Bateman", note: "visible self-interest as default posture" },
      ],
    },
    mid: {
      summary: "normally helpful — helps when asked, doesn't broadcast it",
      characters: [
        { name: "a competent colleague who pitches in", note: "ordinary cooperation, no fanfare" },
      ],
    },
    high: {
      summary: "outwardly generous — visibly offering, giving, making it known",
      characters: [
        { name: "Oprah doing giveaways", note: "public generosity at scale" },
        { name: "a celebrity at a charity gala", note: "the visibly philanthropic moment" },
        { name: "Ted Lasso (the warm giver)", note: "openly hands things — time, attention, food — to people" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the self-interested",
        description:
          "Doesn't pretend — Scrooge inside, Scrooge outside. Mine is mine. No guilt about it, no performance of otherwise.",
      },
      high: {
        name: "the performative giver",
        description:
          "Gives for show — a Patrick Bateman inside wearing an Oprah mask. Resents it underneath. Charity as currency, photo-op as the actual goal.",
      },
    },
    high: {
      low: {
        name: "the secret philanthropist",
        description:
          "Cares about others and acts on it, but quietly — a Mr. Rogers inside, Scrooge-on-the-outside posture. No public credit, no spectacle. Bruce Wayne quietly funding the orphanage.",
      },
      high: {
        name: "the soft touch",
        description:
          "Gives easily, openly, without needing thanks — Hermione inside, Mr. Rogers outside. Both feels and shows generosity. People come to them with needs because the door is always open.",
      },
    },
  },
};

// ─── Self-Monitoring ────────────────────────────────────────────────────────
//
// Felt = awareness of how you come across, registering reactions.
// Projected = visible adjustment of self-presentation in response.

const SELF_MONITORING: FacetData = {
  feltLevels: {
    low: {
      summary: "low inner awareness of how you come across — reactions don't really register",
      characters: [
        { name: "The Dude (The Big Lebowski)", note: "no inner tracking of impression at all" },
        { name: "Patrick Star (SpongeBob)", note: "oblivious to social cues by default" },
        { name: "Sheldon Cooper (early seasons)", note: "doesn't notice the room reacting" },
      ],
    },
    mid: {
      summary: "occasionally aware inside — notice when something lands wrong, don't track closely",
      characters: [
        { name: "a generic competent adult in conversation", note: "course-corrects when needed, no constant monitoring" },
      ],
    },
    high: {
      summary: "constantly aware inside — registering every reaction, reading the room continuously",
      characters: [
        { name: "Don Draper in a pitch", note: "reads every micro-reaction in real time" },
        { name: "Frank Underwood (House of Cards)", note: "the room is data, all the time" },
        { name: "a career politician", note: "tracks every face for every signal" },
      ],
    },
  },
  projectedLevels: {
    low: {
      summary: "outwardly unfiltered — doesn't visibly adjust to reactions, what comes out comes out",
      characters: [
        { name: "Larry David", note: "says what he thinks, watches the chips fall" },
        { name: "The Dude", note: "no observable filter; same in every room" },
        { name: "Wolverine", note: "doesn't visibly modulate for company" },
      ],
    },
    mid: {
      summary: "normally adjusting — corrects when something obviously misses",
      characters: [
        { name: "a generic adult course-correcting in conversation", note: "ordinary social repair" },
      ],
    },
    high: {
      summary: "outwardly polished — visible adjustments to land, performs the presentation",
      characters: [
        { name: "Don Draper in a client meeting", note: "every word weighted for the room" },
        { name: "a news anchor on-air", note: "constant micro-adjustment of tone, pacing, expression" },
        { name: "a polished press secretary", note: "visibly shaping every sentence to its audience" },
      ],
    },
  },
  compoundCorners: {
    low: {
      low: {
        name: "the genuine",
        description:
          "Neither aware nor performing — The Dude inside and out. What you see is what's there. The same in every room because there's no room-shaping going on at all.",
      },
      high: {
        name: "the over-actor",
        description:
          "Performs heavily but oblivious to landing — a Patrick Star inside wearing a news-anchor mask. Tries hard, doesn't read the room. The Michael Scott of the moment: the bigger the effort, the wider the miss.",
      },
    },
    high: {
      low: {
        name: "the artist",
        description:
          "Knows exactly how they come across — and refuses to change it. A Don Draper inside, Larry David outside. Awareness without effort. Bob Dylan in any interview ever.",
      },
      high: {
        name: "the operator",
        description:
          "Tracks every reaction and tunes performance accordingly — Frank Underwood inside, Don Draper outside. Highly aware, highly performed. The whole interaction is being driven, and the driving is hidden by how skillful it is.",
      },
    },
  },
};

export const FACET_DATA: Readonly<Record<FacetName, FacetData>> = {
  Ideas: IDEAS,
  Deliberation: DELIBERATION,
  Assertiveness: ASSERTIVENESS,
  Warmth: WARMTH,
  Trust: TRUST,
  Altruism: ALTRUISM,
  Stability: STABILITY,
  "Self-Monitoring": SELF_MONITORING,
};

/** True when the facet has authored resolver content. All eight facets
 *  are now authored — every facet uses the resolver path. The function
 *  is retained for symmetry with the legacy fallback in the facet
 *  agent: if a facet is removed from FACET_DATA in future, the agent
 *  will correctly fall back rather than throw mid-cascade. */
export function hasFacetData(_facet: FacetName): boolean {
  return true;
}
