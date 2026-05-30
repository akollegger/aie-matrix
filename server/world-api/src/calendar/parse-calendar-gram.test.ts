import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { parseCalendarGramFile, parseCalendarGramText, CalendarParseError } from "./parse-calendar-gram.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseCalendarGramFile", () => {
  it("loads all 4 event templates from sample.calendar.gram", async () => {
    const events = await Effect.runPromise(
      parseCalendarGramFile(join(fixtureDir, "sample.calendar.gram")),
    );
    assert.equal(events.length, 4);
    const ids = events.map((e) => e.id);
    assert.ok(ids.includes("opening-keynote"));
    assert.ok(ids.includes("morning-break"));
    assert.ok(ids.includes("booth-12-raffle"));
    assert.ok(ids.includes("hourly-checkin"));
  });

  it("parses event fields correctly", async () => {
    const events = await Effect.runPromise(
      parseCalendarGramFile(join(fixtureDir, "sample.calendar.gram")),
    );
    const keynote = events.find((e) => e.id === "opening-keynote")!;
    assert.equal(keynote.title, "Opening Keynote");
    assert.equal(keynote.kind, "session");
    assert.equal(keynote.startsAt, "09:00:00");
    assert.equal(keynote.duration, 60);
    assert.equal(keynote.location, "hall-a");
    assert.deepEqual(keynote.enterCommands, ["claim hall-a ghost_keynote_speaker"]);
    assert.deepEqual(keynote.exitCommands, ["yield hall-a"]);

    const checkin = events.find((e) => e.id === "hourly-checkin")!;
    assert.equal(checkin.repeat, 60);
    assert.equal(checkin.until, "18:00:00");
  });
});

describe("parseCalendarGramText", () => {
  it("returns CalendarParseError for missing required field", async () => {
    const text = `(bad-event:Event {
      title: "No description",
      kind: "session",
      startsAt: "09:00:00",
      duration: 60,
      enterCommands: [],
      exitCommands: []
    })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left instanceof CalendarParseError);
  });

  it("returns CalendarParseError for negative duration", async () => {
    const text = `(bad:Event {
      title: "Bad", description: "d", kind: "session",
      startsAt: "09:00:00", duration: -1,
      enterCommands: [], exitCommands: []
    })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("negative"));
  });

  it("returns CalendarParseError for invalid startsAt (not a time)", async () => {
    const text = `(bad:Event {
      title: "Bad", description: "d", kind: "session",
      startsAt: "not-a-time", duration: 60,
      enterCommands: [], exitCommands: []
    })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("wall-clock time"));
  });

  it("returns CalendarParseError for duplicate node identifier", async () => {
    const text = `
    (dupe:Event { title: "A", description: "d", kind: "session", startsAt: "09:00:00", duration: 0, enterCommands: [], exitCommands: [] })
    (dupe:Event { title: "B", description: "d", kind: "session", startsAt: "10:00:00", duration: 0, enterCommands: [], exitCommands: [] })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("Duplicate"));
  });

  it("embedded [:Schedule | ...] block produces same output as flat text", async () => {
    const flat = `(ev:Event { title: "Test", description: "desc", kind: "custom", startsAt: "09:00:00", duration: 30, enterCommands: ["activate x"], exitCommands: ["deactivate x"] })`;
    const embedded = `[:Schedule | (ev:Event { title: "Test", description: "desc", kind: "custom", startsAt: "09:00:00", duration: 30, enterCommands: ["activate x"], exitCommands: ["deactivate x"] }) ]`;
    const flatEvents = await Effect.runPromise(parseCalendarGramText(flat));
    const embeddedEvents = await Effect.runPromise(parseCalendarGramText(embedded));
    assert.equal(flatEvents.length, 1);
    assert.equal(embeddedEvents.length, 1);
    assert.equal(flatEvents[0].id, embeddedEvents[0].id);
    assert.equal(flatEvents[0].startsAt, embeddedEvents[0].startsAt);
  });

  it("returns empty array for text with no Event nodes", async () => {
    const events = await Effect.runPromise(parseCalendarGramText("(a:Foo { x: 1 })"));
    assert.equal(events.length, 0);
  });
});

describe("recurring event validation", () => {
  it("returns CalendarParseError when repeat is set without until", async () => {
    const text = `(bad:Event { title: "T", description: "d", kind: "custom", startsAt: "09:00:00", duration: 0, repeat: 60, enterCommands: [], exitCommands: [] })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("until"));
  });

  it("returns CalendarParseError when until is set without repeat", async () => {
    const text = `(bad:Event { title: "T", description: "d", kind: "custom", startsAt: "09:00:00", duration: 0, until: "18:00:00", enterCommands: [], exitCommands: [] })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("repeat"));
  });

  it("returns CalendarParseError for non-positive repeat", async () => {
    const text = `(bad:Event { title: "T", description: "d", kind: "custom", startsAt: "09:00:00", duration: 0, repeat: 0, until: "18:00:00", enterCommands: [], exitCommands: [] })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("non-positive"));
  });

  it("returns CalendarParseError when until is before startsAt", async () => {
    const text = `(bad:Event { title: "T", description: "d", kind: "custom", startsAt: "18:00:00", duration: 0, repeat: 60, until: "09:00:00", enterCommands: [], exitCommands: [] })`;
    const result = await Effect.runPromise(Effect.either(parseCalendarGramText(text)));
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") assert.ok(result.left.message.includes("before startsAt"));
  });

  it("valid recurring event parses successfully", async () => {
    const text = `(hourly:Event { title: "Hourly", description: "d", kind: "custom", startsAt: "09:00:00", duration: 10, repeat: 60, until: "18:00:00", enterCommands: [], exitCommands: [] })`;
    const events = await Effect.runPromise(parseCalendarGramText(text));
    assert.equal(events.length, 1);
    assert.equal(events[0].repeat, 60);
    assert.equal(events[0].until, "18:00:00");
  });
});
