/**
 * Semantic event types for the cascade graph per RFC-0007.
 *
 * Every input, output, and reasoning step is a first-class event. The
 * event payloads describe *what happened* — not which wire protocol
 * carried it — so the same event log remains meaningful if the world
 * protocol changes (e.g., MCP → A2A). Events are persisted to Neo4j
 * Agent Memory as `ReasoningStep` nodes with per-type specializations.
 */

import { ulid } from "ulid";

import type { AppliedAdjustment } from "./adjustments.js";

/**
 * Compass directions used by the existing world-api for adjacent
 * movement. The canonical enumeration matches RFC-0004 / RFC-0006;
 * `"n"` and `"s"` exist as aliases in some interfaces but are not
 * reachable on odd-q hex layouts — included here for completeness.
 */
export type Compass = "n" | "s" | "ne" | "nw" | "se" | "sw";

// ---------------------------------------------------------------------------
// Stimulus — what the world pushes at the ghost
// ---------------------------------------------------------------------------

export type Stimulus =
  | {
      readonly kind: "utterance";
      /** Ghost that spoke. */
      readonly from: string;
      readonly text: string;
    }
  | {
      readonly kind: "cluster-entered";
      /** Ghosts now co-present in the 7-cell cluster. */
      readonly ghostIds: readonly string[];
    }
  | {
      readonly kind: "cluster-left";
      readonly ghostIds: readonly string[];
    }
  | {
      readonly kind: "mcguffin-in-view";
      readonly itemRef: string;
      /** `"here"` when on the current tile; a compass when on an adjacent tile. */
      readonly at: "here" | Compass;
    }
  | {
      readonly kind: "tile-entered";
      readonly h3Index: string;
      readonly tileClass: string;
    }
  | {
      readonly kind: "idle";
      /** How long the ghost has had no externally-driven stimulus, in milliseconds. */
      readonly quietForMs: number;
    };

// ---------------------------------------------------------------------------
// Surface action — what the ghost intends to do
// ---------------------------------------------------------------------------

export type SurfaceAction =
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "go"; readonly toward: Compass | string }
  | { readonly kind: "take"; readonly itemRef: string }
  | { readonly kind: "drop"; readonly itemRef: string }
  | { readonly kind: "inspect"; readonly itemRef: string }
  | { readonly kind: "look"; readonly at: "here" | "around" }
  | { readonly kind: "exits" }
  | { readonly kind: "inventory" }
  | { readonly kind: "whoami" }
  | { readonly kind: "whereami" }
  | { readonly kind: "bye" };

/** Observed outcome of a Surface action — success with optional data, or a structured denial. */
export type ActionOutcome =
  | { readonly ok: true; readonly data?: unknown }
  | { readonly ok: false; readonly code: string; readonly reason?: string };

// ---------------------------------------------------------------------------
// Id thought — inner-monologue fragment
// ---------------------------------------------------------------------------

/** Whether a thought is the first inner-monologue fragment or a subsequent reflection within the cascade. */
export type ThoughtRole = "monologue" | "reflection";

export interface IdThought {
  readonly role: ThoughtRole;
  /** First-person natural-language content. Must not expose slider names or numeric values. */
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Event envelope types
// ---------------------------------------------------------------------------

export type EventType = "EXTERNAL_STIMULUS" | "SURFACE_ACTION" | "ID_THOUGHT" | "ID_ADJUSTMENT";

/** Fields common to every event. */
export interface BaseEvent {
  readonly id: string;
  readonly timestamp: number;
  /** Immediate predecessor event id, or `undefined` for a cascade-triggering event. */
  readonly causedBy?: string;
}

export interface ExternalStimulusEvent extends BaseEvent {
  readonly type: "EXTERNAL_STIMULUS";
  readonly stimulus: Stimulus;
}

export interface SurfaceActionEvent extends BaseEvent {
  readonly type: "SURFACE_ACTION";
  readonly action: SurfaceAction;
  readonly outcome: ActionOutcome;
}

export interface IdThoughtEvent extends BaseEvent {
  readonly type: "ID_THOUGHT";
  readonly thought: IdThought;
}

export interface IdAdjustmentEvent extends BaseEvent {
  readonly type: "ID_ADJUSTMENT";
  readonly adjustment: AppliedAdjustment;
}

export type Event = ExternalStimulusEvent | SurfaceActionEvent | IdThoughtEvent | IdAdjustmentEvent;

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

/** Optional overrides when constructing an event — useful for deterministic tests. */
export interface EventOptions {
  readonly id?: string;
  readonly timestamp?: number;
  readonly causedBy?: string;
}

function baseFields(opts: EventOptions | undefined): BaseEvent {
  const base: BaseEvent = {
    id: opts?.id ?? ulid(),
    timestamp: opts?.timestamp ?? Date.now(),
  };
  return opts?.causedBy === undefined ? base : { ...base, causedBy: opts.causedBy };
}

export function createExternalStimulusEvent(
  stimulus: Stimulus,
  opts?: EventOptions,
): ExternalStimulusEvent {
  return { ...baseFields(opts), type: "EXTERNAL_STIMULUS", stimulus };
}

export function createSurfaceActionEvent(
  action: SurfaceAction,
  outcome: ActionOutcome,
  opts?: EventOptions,
): SurfaceActionEvent {
  return { ...baseFields(opts), type: "SURFACE_ACTION", action, outcome };
}

export function createIdThoughtEvent(thought: IdThought, opts?: EventOptions): IdThoughtEvent {
  return { ...baseFields(opts), type: "ID_THOUGHT", thought };
}

export function createIdAdjustmentEvent(
  adjustment: AppliedAdjustment,
  opts?: EventOptions,
): IdAdjustmentEvent {
  return { ...baseFields(opts), type: "ID_ADJUSTMENT", adjustment };
}
