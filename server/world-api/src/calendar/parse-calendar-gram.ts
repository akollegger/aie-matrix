import { readFile } from "node:fs/promises";
import { Data, Effect, HashMap, HashSet, Option } from "effect";
import { Temporal } from "@js-temporal/polyfill";
import { Gram } from "@relateby/pattern";
import type { Subject } from "@relateby/pattern";
import type { Pattern } from "@relateby/pattern";
import type { ScheduleEvent, ScheduleEventKind } from "./CalendarEvent.js";

export class CalendarParseError extends Data.TaggedError("CalendarParseError")<{
  readonly message: string;
  readonly source?: string;
}> {}

// ── Value extraction helpers ─────────────────────────────────────────────────

function getString(subject: Subject, key: string): string | undefined {
  return Option.match(HashMap.get(subject.properties, key), {
    onNone: () => undefined,
    onSome: (val) => {
      if (val && typeof val === "object" && "_tag" in val) {
        const v = val as { _tag: string; value?: unknown };
        if (v._tag === "StringVal" && typeof v.value === "string") return v.value;
      }
      return undefined;
    },
  });
}

function getInt(subject: Subject, key: string): number | undefined {
  return Option.match(HashMap.get(subject.properties, key), {
    onNone: () => undefined,
    onSome: (val) => {
      if (val && typeof val === "object" && "_tag" in val) {
        const v = val as { _tag: string; value?: unknown };
        if ((v._tag === "IntVal" || v._tag === "FloatVal") && typeof v.value === "number") {
          return v.value;
        }
      }
      return undefined;
    },
  });
}

function getStringArray(subject: Subject, key: string): string[] | undefined {
  return Option.match(HashMap.get(subject.properties, key), {
    onNone: () => undefined,
    onSome: (val) => {
      if (val && typeof val === "object" && "_tag" in val) {
        const v = val as { _tag: string; items?: unknown[] };
        if (v._tag === "ArrayVal" && Array.isArray(v.items)) {
          const result: string[] = [];
          for (const item of v.items) {
            if (item && typeof item === "object" && "_tag" in item) {
              const iv = item as { _tag: string; value?: unknown };
              if (iv._tag === "StringVal" && typeof iv.value === "string") {
                result.push(iv.value);
              }
            }
          }
          return result;
        }
      }
      return undefined;
    },
  });
}

const VALID_KINDS = new Set<string>(["session", "break", "raffle", "custom"]);

// ── Node extraction ──────────────────────────────────────────────────────────

function extractCalendarEvent(
  pattern: Pattern<Subject>,
  seenIds: Set<string>,
  source?: string,
): Effect.Effect<ScheduleEvent | null, CalendarParseError> {
  const subject = pattern.value;
  // Only process nodes labeled Event
  if (!HashSet.has(subject.labels, "Event")) return Effect.succeed(null);

  const id = subject.identity;
  if (!id) {
    return Effect.fail(
      new CalendarParseError({ message: "Event node missing identifier", source }),
    );
  }
  if (seenIds.has(id)) {
    return Effect.fail(
      new CalendarParseError({
        message: `Duplicate Event identifier: "${id}"`,
        source,
      }),
    );
  }

  const title = getString(subject, "title");
  const description = getString(subject, "description");
  const kindRaw = getString(subject, "kind");
  const startsAt = getString(subject, "startsAt");
  const duration = getInt(subject, "duration");
  const location = getString(subject, "location");
  const enterCommands = getStringArray(subject, "enterCommands");
  const exitCommands = getStringArray(subject, "exitCommands");

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!description) missing.push("description");
  if (!kindRaw) missing.push("kind");
  if (!startsAt) missing.push("startsAt");
  if (duration === undefined) missing.push("duration");
  if (!enterCommands) missing.push("enterCommands");
  if (!exitCommands) missing.push("exitCommands");

  if (missing.length > 0) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" missing required fields: ${missing.join(", ")}`,
        source,
      }),
    );
  }

  if (!VALID_KINDS.has(kindRaw!)) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has invalid kind "${kindRaw}". Must be one of: session, break, raffle, custom`,
        source,
      }),
    );
  }

  if (duration! < 0) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has negative duration ${duration}`,
        source,
      }),
    );
  }

  // Validate startsAt is a plain time-of-day string, not a full datetime.
  // Temporal.PlainTime.from() accepts full datetimes by extracting the time component,
  // so we check the string format explicitly first.
  if (startsAt!.includes("T") || startsAt!.includes("Z") || startsAt!.includes("+") || /^\d{4}-/.test(startsAt!)) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has invalid startsAt "${startsAt}" — must be a wall-clock time like "09:00:00", not a full datetime`,
        source,
      }),
    );
  }
  try {
    Temporal.PlainTime.from(startsAt!);
  } catch {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has invalid startsAt "${startsAt}" — must be a wall-clock time like "09:00:00"`,
        source,
      }),
    );
  }

  const repeat = getInt(subject, "repeat");
  const until = getString(subject, "until");

  if (repeat !== undefined && repeat <= 0) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has non-positive repeat interval ${repeat} — must be > 0`,
        source,
      }),
    );
  }

  if (repeat !== undefined && until === undefined) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has repeat but no until — open-ended recurrence is not supported`,
        source,
      }),
    );
  }

  if (until !== undefined && repeat === undefined) {
    return Effect.fail(
      new CalendarParseError({
        message: `Event "${id}" has until but no repeat — until is only valid on recurring events`,
        source,
      }),
    );
  }

  if (until !== undefined) {
    try {
      Temporal.PlainTime.from(until);
    } catch {
      return Effect.fail(
        new CalendarParseError({
          message: `Event "${id}" has invalid until "${until}" — must be a wall-clock time like "18:00:00"`,
          source,
        }),
      );
    }
    const startTime = Temporal.PlainTime.from(startsAt!);
    const untilTime = Temporal.PlainTime.from(until);
    if (Temporal.PlainTime.compare(untilTime, startTime) < 0) {
      return Effect.fail(
        new CalendarParseError({
          message: `Event "${id}" has until "${until}" before startsAt "${startsAt}"`,
          source,
        }),
      );
    }
  }

  seenIds.add(id);
  const event: ScheduleEvent = {
    id,
    title: title!,
    description: description!,
    kind: kindRaw as ScheduleEventKind,
    startsAt: startsAt!,
    duration: duration!,
    enterCommands: enterCommands!,
    exitCommands: exitCommands!,
    ...(repeat !== undefined ? { repeat, until: until! } : {}),
  };
  if (location !== undefined) {
    return Effect.succeed({ ...event, location });
  }
  return Effect.succeed(event);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse Event nodes from a Gram text string (flat or embedded [:Schedule | ...] block).
 * Returns CalendarParseError on any validation failure.
 */
export function parseCalendarGramText(
  text: string,
  source?: string,
): Effect.Effect<ScheduleEvent[], CalendarParseError> {
  return Effect.flatMap(
    Effect.mapError(Gram.parse(text), (e) =>
      new CalendarParseError({ message: e.message ?? String(e), source }),
    ),
    (patterns) => extractFromPatterns(patterns, source),
  );
}

function extractFromPatterns(
  patterns: ReadonlyArray<Pattern<Subject>>,
  source?: string,
): Effect.Effect<ScheduleEvent[], CalendarParseError> {
  return Effect.gen(function* () {
    const seenIds = new Set<string>();
    const events: ScheduleEvent[] = [];

    for (const pattern of patterns) {
      // Detect embedded [:Schedule | ...] block: a pattern whose value has
      // label "Schedule" and whose elements contain the actual event nodes.
      if (HashSet.has(pattern.value.labels, "Schedule") && pattern.elements.length > 0) {
        for (const inner of pattern.elements) {
          const event = yield* extractCalendarEvent(inner, seenIds, source);
          if (event !== null) events.push(event);
        }
        continue;
      }
      const event = yield* extractCalendarEvent(pattern, seenIds, source);
      if (event !== null) events.push(event);
    }

    return events;
  });
}

/**
 * Read a `.calendar.gram` file and parse all Event nodes.
 */
export function parseCalendarGramFile(
  absolutePath: string,
): Effect.Effect<ScheduleEvent[], CalendarParseError | Error> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
    (text) => parseCalendarGramText(text, absolutePath),
  );
}
