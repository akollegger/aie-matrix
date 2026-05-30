import { Temporal } from "@js-temporal/polyfill";
import { WORLD_TIMEZONE } from "@aie-matrix/shared-types";

export type ScheduleEventKind = "session" | "break" | "raffle" | "custom";

/**
 * A scheduled event. `startsAt` is a wall-clock time of day (e.g. "09:00:00"),
 * not a full datetime — events fire every day the server runs at that time.
 * This makes the calendar maintenance-free during development.
 *
 * For intra-day recurrence, add `repeat` (interval in minutes) and `until`
 * (end-of-window time of day, e.g. "18:00:00").
 */
export interface ScheduleEvent {
  /** Stable machine key — the Gram node identifier. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: ScheduleEventKind;
  /** Wall-clock time of day in HH:MM or HH:MM:SS format, e.g. "09:00:00".
   *  The event fires at this time every day in the world timezone (US/Pacific). */
  readonly startsAt: string;
  /** Duration in minutes. 0 = point event (no exit phase). */
  readonly duration: number;
  /** Polygon node identifier. Absent for non-spatial events. */
  readonly location?: string;
  readonly enterCommands: readonly string[];
  readonly exitCommands: readonly string[];
  /** Recurrence interval in minutes. Requires `until`. */
  readonly repeat?: number;
  /** End-of-window time of day for recurrence, e.g. "18:00:00". Requires `repeat`. */
  readonly until?: string;
}

/** Read-only projection (command lists omitted). */
export interface ScheduledEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: ScheduleEventKind;
  readonly startsAt: string;
  readonly duration: number;
  readonly location?: string;
}

export function toScheduledEvent(e: ScheduleEvent): ScheduledEvent {
  const base: ScheduledEvent = {
    id: e.id,
    title: e.title,
    description: e.description,
    kind: e.kind,
    startsAt: e.startsAt,
    duration: e.duration,
  };
  return e.location !== undefined ? { ...base, location: e.location } : base;
}

/**
 * Compute all occurrence times for an event on a given calendar date.
 * Non-recurring events return a single-element array.
 * Recurring events return one entry per repeat interval within [startsAt, until].
 * Each entry is { zdt: ZonedDateTime, n: number } where n is 1-indexed.
 */
export function todayOccurrences(
  event: ScheduleEvent,
  date: Temporal.PlainDate,
): Array<{ zdt: Temporal.ZonedDateTime; n: number }> {
  const startTime = Temporal.PlainTime.from(event.startsAt);
  const start = date.toZonedDateTime({ timeZone: WORLD_TIMEZONE, plainTime: startTime });

  if (event.repeat === undefined || event.until === undefined) {
    return [{ zdt: start, n: 1 }];
  }

  const untilTime = Temporal.PlainTime.from(event.until);
  const untilZdt = date.toZonedDateTime({ timeZone: WORLD_TIMEZONE, plainTime: untilTime });
  const intervalMs = event.repeat * 60_000;

  const results: Array<{ zdt: Temporal.ZonedDateTime; n: number }> = [];
  let current = start;
  let n = 1;

  while (Temporal.ZonedDateTime.compare(current, untilZdt) <= 0) {
    results.push({ zdt: current, n });
    current = current.add({ milliseconds: intervalMs });
    n++;
  }

  return results;
}

/** Stable fired-event key: "{id}@{YYYY-MM-DD}@{n}" */
export function firedKey(id: string, date: Temporal.PlainDate, n: number): string {
  return `${id}@${date.toString()}@${n}`;
}
