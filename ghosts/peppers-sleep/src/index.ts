/**
 * Public API for the agent-sleep consolidation pipeline.
 *
 * Designed to be ported to Python as an extension to
 * `neo4j-agent-memory`. The package's only external dependencies are
 * `neo4j-driver` and `openai` — both have direct Python equivalents,
 * so the lift-and-port is a code translation rather than an
 * architecture port. Internal modules avoid framework-specific
 * idioms (Effect, RxJS, etc.) for the same reason.
 */

export {
  openDriver,
  openSession,
  openSessionFromEnv,
  type SleepDriverOptions,
} from "./graph/connection.js";

export {
  CONSOLIDATED_LABEL,
  createConsolidation,
  relabelManyAsConsolidated,
  createSkill,
  addContradicts,
  deleteConsolidations,
  type BaseLabel,
} from "./graph/consolidations.js";

export {
  PROCEDURE_SCHEMA,
  quickShapeCheck,
  type AipProcedure,
} from "./aip/index.js";

export {
  normalizeStimulusClass,
  stripLocationQualifiers,
} from "./pipeline/stimulus-class.js";

export {
  fetchCurrentNarrative,
  createSelfNarrative,
  fetchAllNarratives,
  loadAllNarrativesFromEnv,
  type SelfNarrative,
} from "./graph/narrative.js";

export {
  recordKarmicLesson,
  fetchKarmicLesson,
  recordKarmicLessonFromEnv,
  loadKarmicLessonFromEnv,
  createKarmicSkill,
  seedKarmicSkillFromEnv,
  copyKarmicSkillsForward,
  carryKarmicSkillsFromEnv,
  type KarmicLesson,
} from "./graph/karma.js";

export { runBlackout } from "./run-blackout.js";

export {
  shannonEntropyBits,
  distributionsByClass,
} from "./pipeline/entropy.js";
