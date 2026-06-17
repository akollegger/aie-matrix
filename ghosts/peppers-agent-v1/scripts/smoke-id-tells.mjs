#!/usr/bin/env node
/**
 * Cheap behavioural smoke for the Id pipeline's TELL + PLAN CONTINUITY
 * changes. Calls the LLM directly with hand-crafted fixtures — does NOT
 * spawn ghosts, does NOT touch Neo4j, does NOT need the demo running.
 *
 * Costs: ~12 model calls per run (8 facet agents + impulse + convergence
 * + synthesis + surface). At gpt-5.4-nano-2026-03-17 pricing that's
 * sub-penny per invocation. Cheap enough to iterate from the keyboard.
 *
 * What it checks (HUMAN-readable, not assertions):
 *
 *   SCENARIO A: Confidence imbalance (low I, high E)
 *     → Synthesis monologue should sound brittle/overcompensating,
 *       NOT calmly confident.
 *
 *   SCENARIO B: Aligned warmth (high I, high E)
 *     → Synthesis should sound naturally warm — no tells.
 *
 *   SCENARIO C: Plan continuity
 *     → Three recent super-objectives all about "reach Black Bart's
 *       with allies" + a new utterance asking again "shall we go?"
 *       → Convergence super-objective should preserve the plan
 *       ("move now, words later") instead of regenerating a fresh
 *       "make new friends" objective.
 *
 * Run with:
 *   pnpm --filter @aie-matrix/ghost-peppers-agent-v1 exec node scripts/smoke-id-tells.mjs
 */

import { loadRootEnv } from "@aie-matrix/root-env";
import { samplePersonality, midpointPersonality, fromDisplay } from "@aie-matrix/ghost-peppers-inner";

import { invokeId } from "../dist/reason-id.js";
import { invokeSurface } from "../dist/reason-surface.js";

loadRootEnv();

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY must be set in repo-root .env");
  process.exit(1);
}

// ----------------------------------------------------------------------
// Fixture helpers
// ----------------------------------------------------------------------

/**
 * Build a personality where one facet has a wide I/E split and the
 * rest are midpoint. Lets us isolate the tell behaviour for a single
 * facet (the rest stay quiet so noise doesn't drown the signal).
 */
function imbalanced(facet, internal, external) {
  const p = { ...midpointPersonality() };
  // SliderValue is { logit }; use fromDisplay(0..10) to set a real value.
  p[facet] = {
    internal: fromDisplay(internal),
    external: fromDisplay(external),
  };
  return p;
}

/** Pretty-print the cascade so the human reading it can judge fast. */
function printResult(label, result) {
  console.log(`\n===== ${label} =====`);
  console.log("Emotional read:");
  console.log("  " + result.emotionalRead);
  console.log("Super-objective:");
  console.log("  " + result.superObjective);
  console.log("Monologue:");
  console.log("  " + result.monologue);
}

// ----------------------------------------------------------------------
// Scenarios
// ----------------------------------------------------------------------

async function scenarioA_BrittleConfidence() {
  // Low I (1.5) + High E (9.0) on Assertiveness — classic bluster.
  const personality = imbalanced("Assertiveness", 1.5, 9.0);
  const stimulus = {
    kind: "utterance",
    from: "Tuco Acyclica",
    text: "You sure you're up for the table? Stakes are real.",
  };
  const id = await invokeId({
    personality,
    stimulus,
    recentCascades: [],
    objective: "Win Cyphers at Black Bart's poker saloon.",
    selfDisplayName: "Doc Hopliday",
  });
  printResult("A — BRITTLE CONFIDENCE (lookfor bluster)", id);
}

async function scenarioB_AlignedWarmth() {
  // High I (8.5) + High E (8.0) on Warmth — naturally warm.
  const personality = imbalanced("Warmth", 8.5, 8.0);
  const stimulus = {
    kind: "utterance",
    from: "Calamity Cypher",
    text: "Hey — you've been quiet. Long day?",
  };
  const id = await invokeId({
    personality,
    stimulus,
    recentCascades: [],
    objective: "Make allies on the way to Black Bart's.",
    selfDisplayName: "Annie Adjacency",
  });
  printResult("B — ALIGNED WARMTH (look for natural, untel'd)", id);
}

async function scenarioC_PlanContinuity() {
  // Neutral personality; the test is whether plan persists.
  const personality = samplePersonality({ seed: 42, stddev: 1.0 });
  const stimulus = {
    kind: "utterance",
    from: "Pancho Vertilla",
    text: "So we headed northwest to Black Bart's together then?",
  };
  const id = await invokeId({
    personality,
    stimulus,
    recentCascades: [],
    objective: "Win Cyphers at Black Bart's poker saloon.",
    selfDisplayName: "Will Walker",
    // Three prior cascades all about going to Black Bart's. Convergence
    // should preserve this, not regenerate "make friends" from scratch.
    recentSuperObjectives: [
      "reach Black Bart's with the crew",
      "press northwest toward the saloon",
      "move now, words later",
    ],
  });
  printResult("C — PLAN CONTINUITY (super-objective should preserve commitment, NOT regen 'make friends')", id);
}

// ----------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------

/**
 * SCENARIO D: Speech register decoupling.
 *   Monologue (synthesis) and Speech (Surface) should be in DIFFERENT
 *   registers. The interior is private — the words that come out of
 *   the mouth depend on speaker + listener + situation, not on the
 *   monologue's prose style. We pass a deliberately poetic monologue
 *   and check whether the Surface speech still sounds like a person
 *   talking to another person rather than parroting interior cadence.
 */
async function scenarioD_SpeechRegister() {
  const stimulus = {
    kind: "utterance",
    from: "Tuco Acyclica",
    text: "Heard you talkin' big about the cards. You actually playin' or just hot air?",
  };
  // Deliberately overwrought monologue — what synthesis used to emit.
  // If Surface still mirrors it, the speech leak isn't fixed.
  const monologue =
    "Brass under a lamp, polished but with a hairline crack — Tuco's voice in the dark, a warm open hand that isn't really warm. Wet stone smell, the kind that remembers rain. Press northwest, words later.";
  const surface = await invokeSurface({
    personality: midpointPersonality(),
    monologue,
    stimulus,
    objective: "Win Cyphers at Black Bart's poker saloon.",
    selfDisplayName: "Doc Hopliday",
    worldContext: {
      availableExits: ["n", "s", "ne", "nw", "se", "sw"],
      nearbyGhostIds: ["Tuco Acyclica"],
      inConversationalMode: true,
      turnsSinceLastSayWithNoReply: 0,
      socialAnchorTurnsLeft: 3,
    },
  });
  console.log("\n===== D — SPEECH REGISTER (Doc should sound like a person, NOT echo monologue's prose) =====");
  console.log("Monologue handed in (intentionally poetic):");
  console.log("  " + monologue);
  console.log("Surface action:");
  console.log("  " + JSON.stringify(surface.action));
}

/**
 * SCENARIO F: Stage-direction ban.
 *   The model was prefixing every "say" line with its own name like a
 *   screenplay ("Curly Bipartite. Yeah—Black Bart's..."). The new
 *   prompt rule bans self-naming preambles. Hand it a stimulus and a
 *   monologue with the character's name baked in; the spoken line
 *   should NOT begin with the character's name.
 */
async function scenarioF_NoStageDirection() {
  const stimulus = {
    kind: "utterance",
    from: "Neo Foreigner",
    text: "Hey—Neo Foreigner. You heading anywhere in particular?",
  };
  const monologue =
    "Neo Foreigner already said hi. I'm Curly. They're going to Black Bart's — same as me.";
  const surface = await invokeSurface({
    personality: midpointPersonality(),
    monologue,
    stimulus,
    objective: "Win Cyphers at Black Bart's poker saloon.",
    selfDisplayName: "Curly Bipartite",
    worldContext: {
      availableExits: ["n", "ne", "nw"],
      nearbyGhostIds: ["Neo Foreigner"],
      inConversationalMode: true,
      turnsSinceLastSayWithNoReply: 0,
      socialAnchorTurnsLeft: 2,
      consecutiveSayTurns: 1,
    },
  });
  console.log("\n===== F — STAGE DIRECTION BAN (say text should NOT start with 'Curly Bipartite.') =====");
  console.log("Surface action:");
  console.log("  " + JSON.stringify(surface.action));
  if (surface.action.kind === "say") {
    const text = surface.action.text ?? "";
    const startsWithName = text.trimStart().toLowerCase().startsWith("curly bipartite");
    console.log(
      startsWithName
        ? "  ✗ STILL starts with own name — prompt rule not followed"
        : "  ✓ does NOT start with own name",
    );
  } else {
    console.log("  (action wasn't 'say' — n/a)");
  }
}

/**
 * SCENARIO E: Impetus — break the talk loop.
 *   Same shape as Will Walker in the live demo: 19+ "let's go to
 *   Black Bart's" exchanges, all `say`, no movement. We hand the
 *   Surface a high consecutiveSayTurns counter while inConversational
 *   mode. The IMPETUS rule should push the action to "bye" (not yet
 *   another say). At counter 5+ this is a near-deterministic ask.
 */
async function scenarioE_Impetus() {
  const stimulus = {
    kind: "utterance",
    from: "Bolt Brody",
    text: "Yeah—Black Bart's. You coming with, or scouting?",
  };
  const monologue =
    "Black Bart's. We've been saying that for ten turns. Time to actually get there.";
  const surface = await invokeSurface({
    personality: midpointPersonality(),
    monologue,
    stimulus,
    objective: "Win Cyphers at Black Bart's poker saloon.",
    selfDisplayName: "Rooster Nodeburn",
    worldContext: {
      availableExits: ["n", "s", "ne", "nw", "se", "sw"],
      nearbyGhostIds: ["Bolt Brody"],
      inConversationalMode: true,
      turnsSinceLastSayWithNoReply: 0,
      socialAnchorTurnsLeft: 2,
      consecutiveSayTurns: 6, // well past the hard impetus threshold
    },
  });
  console.log("\n===== E — IMPETUS (consecutiveSayTurns=6, should pick 'bye' — NOT another say) =====");
  console.log("Monologue handed in:");
  console.log("  " + monologue);
  console.log("Surface action:");
  console.log("  " + JSON.stringify(surface.action));
  console.log(
    surface.action.kind === "bye"
      ? "  ✓ broke the loop"
      : "  ✗ impetus did not fire — picked " + surface.action.kind,
  );
}

/**
 * SCENARIO G: Speech individuation — the critical check.
 *   Hand Surface the SAME monologue, same stimulus, same world, same
 *   objective — only the personality differs. The two speakers should
 *   produce noticeably different `say` text. If they sound the same,
 *   personality is still not reaching the spoken word.
 *
 *   Speaker 1 — "Aura-shape": low Deliberation, low Trust, banked
 *     Assertiveness (felt high, shown low), high Self-Monitoring.
 *     Should sound clipped, impulsive, watchful, words-as-tools.
 *
 *   Speaker 2 — "Folksy-warm": high Warmth aligned, high Trust aligned,
 *     low Self-Monitoring. Should sound easy, open, unstrategic.
 */
async function scenarioG_SpeechIndividuation() {
  const personality1 = (() => {
    const p = { ...midpointPersonality() };
    p["Deliberation"] = { internal: fromDisplay(0.8), external: fromDisplay(2.9) };
    p["Trust"] = { internal: fromDisplay(2.5), external: fromDisplay(4.3) };
    p["Assertiveness"] = { internal: fromDisplay(6.0), external: fromDisplay(3.0) };
    p["Self-Monitoring"] = { internal: fromDisplay(7.4), external: fromDisplay(6.9) };
    return p;
  })();
  const personality2 = (() => {
    const p = { ...midpointPersonality() };
    p["Warmth"] = { internal: fromDisplay(8.5), external: fromDisplay(8.0) };
    p["Trust"] = { internal: fromDisplay(7.5), external: fromDisplay(7.5) };
    p["Self-Monitoring"] = { internal: fromDisplay(2.5), external: fromDisplay(2.5) };
    return p;
  })();
  const stimulus = {
    kind: "utterance",
    from: "Marshal Hops",
    text: "Black Bart's, then? I'm headed in for a few hands.",
  };
  // Same monologue handed to both — the only differentiator is personality.
  const monologue =
    "Black Bart's. Marshal Hops wants to head in. The seats with sightlines are the ones I want.";
  const world = {
    availableExits: ["n", "ne", "nw"],
    nearbyGhostIds: ["Marshal Hops"],
    inConversationalMode: true,
    turnsSinceLastSayWithNoReply: 0,
    socialAnchorTurnsLeft: 1,
    consecutiveSayTurns: 2,
  };
  const [s1, s2] = await Promise.all([
    invokeSurface({
      personality: personality1,
      monologue,
      stimulus,
      objective: "Win Cyphers at Black Bart's poker saloon.",
      selfDisplayName: "Aura Calhoun",
      worldContext: world,
    }),
    invokeSurface({
      personality: personality2,
      monologue,
      stimulus,
      objective: "Win Cyphers at Black Bart's poker saloon.",
      selfDisplayName: "Cosy Connell",
      worldContext: world,
    }),
  ]);
  console.log("\n===== G — SPEECH INDIVIDUATION (same monologue + stimulus, different personalities) =====");
  console.log("Shared monologue: " + monologue);
  console.log("Shared stimulus: " + JSON.stringify(stimulus));
  console.log("Aura-shape (low Deliberation, low Trust, banked Assertiveness, high Self-Monitoring):");
  console.log("  " + JSON.stringify(s1.action));
  console.log("Folksy-warm (high Warmth, high Trust, low Self-Monitoring):");
  console.log("  " + JSON.stringify(s2.action));
  console.log("  ↳ If these two say-lines sound interchangeable, personality is still not reaching speech.");
}

try {
  await scenarioA_BrittleConfidence();
  await scenarioB_AlignedWarmth();
  await scenarioC_PlanContinuity();
  await scenarioD_SpeechRegister();
  await scenarioE_Impetus();
  await scenarioF_NoStageDirection();
  await scenarioG_SpeechIndividuation();
  console.log("\nDone. Read the seven blocks above — each names what to look for.");
} catch (err) {
  console.error("\nsmoke failed:", err);
  process.exit(1);
}
