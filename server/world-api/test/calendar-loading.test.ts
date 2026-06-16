/**
 * End-to-end smoke tests for calendar loading (T025, T026 — US5).
 */
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { Effect, ManagedRuntime } from "effect";
import { parseCalendarGramFile } from "../src/calendar/parse-calendar-gram.js";
import { makeWorldCalendarLayer, WorldCalendarService } from "../src/calendar/WorldCalendarService.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../src/calendar/fixtures");
const sampleCalendarPath = join(fixtureDir, "sample.calendar.gram");

test("calendar loading: sample fixture loads 4 event templates", async () => {
  const events = await Effect.runPromise(parseCalendarGramFile(sampleCalendarPath));
  assert.equal(events.length, 4, "should load 4 event templates");
  const ids = events.map((e) => e.id);
  assert.ok(ids.includes("opening-keynote"));
  assert.ok(ids.includes("morning-break"));
  assert.ok(ids.includes("booth-12-raffle"));
  assert.ok(ids.includes("hourly-checkin"));

  // Verify time-of-day format: HH:MM or HH:MM:SS with no date or timezone component
  const TIME_ONLY_RE = /^\d{2}:\d{2}(:\d{2})?$/;
  for (const event of events) {
    assert.ok(
      TIME_ONLY_RE.test(event.startsAt),
      `startsAt should be time-only (e.g. "09:00:00"), got: ${event.startsAt}`,
    );
  }
});

test("calendar loading: recurring event has repeat and until fields", async () => {
  const events = await Effect.runPromise(parseCalendarGramFile(sampleCalendarPath));
  const checkin = events.find((e) => e.id === "hourly-checkin")!;
  assert.equal(checkin.repeat, 60);
  assert.equal(checkin.until, "18:00:00");
});

test("calendar loading: WorldCalendarService starts without error", async () => {
  const events = await Effect.runPromise(parseCalendarGramFile(sampleCalendarPath));
  const layer = makeWorldCalendarLayer(events);
  const runtime = ManagedRuntime.make(layer);
  try {
    const upcoming = await runtime.runPromise(
      Effect.gen(function* () {
        const calendar = yield* WorldCalendarService;
        return yield* calendar.upcomingEvents(10);
      }),
    );
    // Events fire daily — upcoming depends on current time of day, so just verify shape
    assert.ok(Array.isArray(upcoming));
    for (const event of upcoming) {
      assert.ok(typeof event.id === "string");
      assert.ok(typeof event.title === "string");
      assert.ok(!("enterCommands" in event), "enterCommands must not be exposed");
      assert.ok(!("exitCommands" in event), "exitCommands must not be exposed");
    }
  } finally {
    await runtime.dispose();
  }
});

test("calendar loading: empty calendar works", async () => {
  const layer = makeWorldCalendarLayer([]);
  const runtime = ManagedRuntime.make(layer);
  try {
    const upcoming = await runtime.runPromise(
      Effect.gen(function* () {
        const calendar = yield* WorldCalendarService;
        return yield* calendar.upcomingEvents(3);
      }),
    );
    assert.deepEqual(upcoming, []);
  } finally {
    await runtime.dispose();
  }
});

test("calendar loading: malformed file fails with CalendarParseError", async () => {
  const tmpFile = join(tmpdir(), `test-malformed-${Date.now()}.calendar.gram`);
  await writeFile(tmpFile, `(bad:Event { title: "No description", kind: "session", startsAt: "09:00:00", duration: 60, enterCommands: [], exitCommands: [] })`, "utf8");
  try {
    const result = await Effect.runPromise(Effect.either(parseCalendarGramFile(tmpFile)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("description"));
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
});

test("calendar loading: invalid startsAt (datetime instead of time) fails", async () => {
  const tmpFile = join(tmpdir(), `test-datetime-${Date.now()}.calendar.gram`);
  await writeFile(tmpFile, `(bad:Event { title: "T", description: "d", kind: "session", startsAt: "2099-06-05T09:00:00-07:00", duration: 60, enterCommands: [], exitCommands: [] })`, "utf8");
  try {
    const result = await Effect.runPromise(Effect.either(parseCalendarGramFile(tmpFile)));
    assert.equal(result._tag, "Left", "full datetime should be rejected in time-only mode");
    if (result._tag === "Left") assert.ok(result.left.message.includes("wall-clock time"));
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
});
