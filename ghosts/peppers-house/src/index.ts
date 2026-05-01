/**
 * @aie-matrix/ghost-peppers-house
 *
 * Orchestrator package: takes a stimulus, runs the Id reasoning loop,
 * runs the Surface action loop, persists the cascade, and returns the
 * updated ghost state. Sits on top of `peppers-inner` (pure logic) and
 * `peppers-mem` (Agent Memory MCP adapter).
 */

export { DEFAULT_MODEL } from "./llm-client.js";

export { invokeId, type IdReasoning, type InvokeIdRequest } from "./reason-id.js";

export {
  invokeSurface,
  type InvokeSurfaceRequest,
  type SurfaceReasoning,
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
