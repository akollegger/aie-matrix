/**
 * @aie-matrix/ghost-peppers-agent-v2
 *
 * Orchestrator package: takes a stimulus, runs the Id reasoning loop,
 * runs the Surface action loop, persists the cascade, and returns the
 * updated ghost state. Sits on top of `peppers-inner` (pure logic) and
 * `peppers-mem` (Agent Memory MCP adapter).
 */

export { DEFAULT_MODEL } from "./llm-client.js";

export {
  idAgent,
  invokeId,
  runIdAgent,
  type IdReasoning,
  type InvokeIdRequest,
} from "./reason-id.js";

export {
  renderSurfaceSpeech,
  resetSurfaceThread,
  type InvokeSurfaceRequest,
  type SurfaceReasoning,
  type SurfaceRenderRequest,
  type SurfaceRenderResult,
  type WorldContext,
} from "./reason-surface.js";

export {
  runOneStimulus,
  type ExecuteAction,
  type RunOneStimulusRequest,
  type RunRecord,
} from "./run-loop.js";

export { runHouse, type RunHouseOptions } from "./run-house.js";

export {
  emptyStimulusContext,
  executeViaMcp,
  pollNextStimulus,
  registerAndAdopt,
  type AdoptedGhost,
  type RegisterAndAdoptOptions,
  type StimulusContext,
} from "./runtime/index.js";

// RFC-0019 Barnacle Protocol — schemas, brain, and the encounter+pause+resume
// surface peppers-agent now exposes for the host's mini-game supervisor.
export {
  PEPPERS_PAUSE_SCHEMA,
  PEPPERS_RESUME_SCHEMA,
  PLATFORM_ENCOUNTER_SCHEMA,
  type SpawnContext,
  type PeppersPause,
  type PeppersResume,
  type PlatformEncounter,
  type PlatformEncounterReply,
} from "./spawn-types.js";

export {
  decideEncounter,
  type EncounterDecisionInput,
  type EncounterDecisionOutput,
} from "./encounter-brain.js";
