/**
 * @aie-matrix/ghost-peppers-inner
 *
 * Pure library for the Surface/Id multi-agent ghost architecture per
 * RFC-0007. This milestone ships only the slider math + starter facet
 * set + adjustment selector; LLM prompting, Aura Agents provisioning,
 * and Neo4j Agent Memory wiring land in later milestones.
 */

export {
  DEFAULT_DELTA,
  DISPLAY_MAX,
  DISPLAY_MIDPOINT,
  DISPLAY_MIN,
  applyDelta,
  fromDisplay,
  midpoint,
  toDisplay,
  type Axis,
  type Direction,
  type SliderValue,
} from "./sliders.js";

export {
  STARTER_FACETS,
  midpointPersonality,
  samplePersonality,
  type BirthConfig,
  type FacetName,
  type PersonalityState,
  type TraitState,
} from "./facets.js";

export {
  type Adjustment,
  type AppliedAdjustment,
} from "./adjustments.js";

export {
  createExternalStimulusEvent,
  createIdAdjustmentEvent,
  createIdThoughtEvent,
  createSurfaceActionEvent,
  type ActionOutcome,
  type BaseEvent,
  type Compass,
  type Event,
  type EventOptions,
  type EventType,
  type ExternalStimulusEvent,
  type IdAdjustmentEvent,
  type IdThought,
  type IdThoughtEvent,
  type Stimulus,
  type SurfaceAction,
  type SurfaceActionEvent,
  type ThoughtRole,
} from "./events.js";

export {
  CascadeBuilder,
  CascadeClosedError,
  type CascadeTrace,
  type CascadeTrigger,
  type CompleteOptions,
} from "./cascade.js";
