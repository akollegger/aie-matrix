/**
 * Cascade builder per RFC-0007.
 *
 * A cascade is the bounded chain of events triggered by a single
 * external stimulus (or, rarely, by the ghost's own prior action). It
 * groups the Id's thoughts, the Surface's action, and the Id's
 * post-action adjustments into one causally-linked structure that maps
 * onto a Neo4j Agent Memory `ReasoningTrace`.
 *
 * The builder tracks the most-recently-added event and assigns each
 * new event's `causedBy` to that predecessor by default — callers can
 * override when semantic causality branches (e.g., all adjustments
 * caused by the surface action rather than the previous adjustment).
 */

import type { AppliedAdjustment } from "./adjustments.js";
import {
  createExternalStimulusEvent,
  createIdAdjustmentEvent,
  createIdThoughtEvent,
  createSurfaceActionEvent,
  type ActionOutcome,
  type Event,
  type EventOptions,
  type ExternalStimulusEvent,
  type IdAdjustmentEvent,
  type IdThought,
  type IdThoughtEvent,
  type Stimulus,
  type SurfaceAction,
  type SurfaceActionEvent,
} from "./events.js";

/** An event that may legally trigger a new cascade. */
export type CascadeTrigger = ExternalStimulusEvent | SurfaceActionEvent;

/** Finalized, immutable record of a completed cascade. */
export interface CascadeTrace {
  readonly ghostId: string;
  /** The id of the triggering event — acts as the Neo4j `ReasoningTrace` key. */
  readonly rootEventId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  /** All events in the cascade, ordered by insertion. Includes the trigger. */
  readonly events: readonly Event[];
}

/** Thrown when the builder is used after `complete()`. */
export class CascadeClosedError extends Error {
  constructor() {
    super("CascadeBuilder: cannot add events after complete()");
    this.name = "CascadeClosedError";
  }
}

/** Optional completion-time overrides for deterministic tests. */
export interface CompleteOptions {
  readonly completedAt?: number;
}

/**
 * Stateful builder that accumulates events for a single cascade. Not
 * thread-safe; intended to live within one iteration of a ghost's
 * interaction loop.
 */
export class CascadeBuilder {
  readonly ghostId: string;
  readonly rootEventId: string;
  readonly startedAt: number;

  private readonly eventsInternal: Event[];
  private lastEventId: string;
  private closed = false;

  constructor(ghostId: string, trigger: CascadeTrigger) {
    this.ghostId = ghostId;
    this.rootEventId = trigger.id;
    this.startedAt = trigger.timestamp;
    this.eventsInternal = [trigger];
    this.lastEventId = trigger.id;
  }

  /** The events added so far, including the trigger. Snapshot; safe to read mid-build. */
  get events(): readonly Event[] {
    return this.eventsInternal.slice();
  }

  addStimulus(stimulus: Stimulus, opts?: EventOptions): ExternalStimulusEvent {
    this.assertOpen();
    const event = createExternalStimulusEvent(stimulus, this.withDefaultCausedBy(opts));
    this.commit(event);
    return event;
  }

  addSurfaceAction(
    action: SurfaceAction,
    outcome: ActionOutcome,
    opts?: EventOptions,
  ): SurfaceActionEvent {
    this.assertOpen();
    const event = createSurfaceActionEvent(action, outcome, this.withDefaultCausedBy(opts));
    this.commit(event);
    return event;
  }

  addThought(thought: IdThought, opts?: EventOptions): IdThoughtEvent {
    this.assertOpen();
    const event = createIdThoughtEvent(thought, this.withDefaultCausedBy(opts));
    this.commit(event);
    return event;
  }

  addAdjustment(adjustment: AppliedAdjustment, opts?: EventOptions): IdAdjustmentEvent {
    this.assertOpen();
    const event = createIdAdjustmentEvent(adjustment, this.withDefaultCausedBy(opts));
    this.commit(event);
    return event;
  }

  /** Finalize and return an immutable trace. Further method calls throw. */
  complete(opts?: CompleteOptions): CascadeTrace {
    this.assertOpen();
    const completedAt = opts?.completedAt ?? Date.now();
    this.closed = true;
    return Object.freeze({
      ghostId: this.ghostId,
      rootEventId: this.rootEventId,
      startedAt: this.startedAt,
      completedAt,
      events: Object.freeze(this.eventsInternal.slice()),
    });
  }

  private assertOpen(): void {
    if (this.closed) throw new CascadeClosedError();
  }

  private withDefaultCausedBy(opts: EventOptions | undefined): EventOptions {
    if (opts?.causedBy !== undefined) return opts;
    return { ...opts, causedBy: this.lastEventId };
  }

  private commit(event: Event): void {
    this.eventsInternal.push(event);
    this.lastEventId = event.id;
  }
}
