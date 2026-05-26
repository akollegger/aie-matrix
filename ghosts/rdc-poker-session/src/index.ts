/**
 * @aie-matrix/ghost-rdc-poker-session
 *
 * Per-table poker mini-game session — RFC-0019 Barnacle Protocol.
 * One process represents one PokerTable platform; ghosts seated at it
 * are managed in-process by the auto-loop (`session-loop.ts`). The
 * session speaks only the Barnacle wire (handoff + heartbeat); turn /
 * outcome / reflect dispatch happens in-process via `decide-in-process`.
 *
 * Phase 5b.2c (2026-05-24): legacy A2A schemas + the rdc-orchestrator
 * package were retired in this revision. The host-side encounter brain
 * and social cascade now live in peppers-agent; this package's surface
 * is the Barnacle session host plus the supporting domain modules
 * (animal assignment, math schools, poker brain, ledger writes).
 */

export { buildRdcAgentCard } from "./buildAgentCard.js";
export {
  RdcAgentExecutor,
  sendBarnacleComplete,
  setActiveTable,
  getActiveTable,
  getLedger,
} from "./executor.js";

// RFC-0019 — per-table session model.
export {
  ActiveTable,
  type TableConfig,
  type TableSeat,
} from "./table-state.js";

// RFC-0019 phase 5b.2b — in-session auto-loop + direct-call decide.
export {
  startSessionLoop,
  type SessionLoopOptions,
  type SessionLoopHandle,
} from "./session-loop.js";
export { buildInProcessDecide } from "./decide-in-process.js";

// Table-driver + shared utilities — the in-process hand driver.
export {
  runOneHand,
  type SeatedAgent,
  type TableRunnerEvent,
} from "./table-runner.js";
export {
  persistHand,
  fetchRecentHands,
  fetchOpponentReads,
  closeMemory,
  type PokerHandRecord,
} from "./memory-writer.js";
export { assignAnimals, type PlayerFitness } from "./animal-assignment.js";
export { invokePokerBrain } from "./poker-brain.js";
export { invokeReflectionBrain } from "./reflect-brain.js";
export {
  personaFromSliders,
  type PersonaDerivationInput,
} from "./persona-from-sliders.js";

export {
  ANIMAL_TYPES,
  ANIMAL_DESCRIPTIONS,
  animalFitness,
  type AnimalType,
  type AnimalFitness,
} from "./hellmuth-profile.js";

export {
  MATH_SCHOOLS,
  SCHOOL_FLAVOR_NAMES,
  assignMathSchool,
  type MathSchool,
} from "./math-schools.js";
