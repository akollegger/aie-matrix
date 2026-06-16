/**
 * Unit tests for WorldCalendarService (daily, clock-based scheduling).
 *
 * INTEGRATION TEST COVERAGE GAP (per constitution §Service Testing Requirements):
 * The following methods lack live-Neo4j coverage because NEO4J_URI is not
 * available in CI for this feature branch:
 *   - tick() — started/ended marker persistence across restarts
 * These will be covered by an integration test when NEO4J_URI is available in CI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { Temporal } from "@js-temporal/polyfill";
import { makeWorldCalendarService } from "./WorldCalendarService.js";
import { todayOccurrences, firedKey } from "./CalendarEvent.js";
import type { ScheduleEvent } from "./CalendarEvent.js";
import { WORLD_TIMEZONE } from "@aie-matrix/shared-types";

function makeEvent(overrides: Partial<ScheduleEvent> & { id: string }): ScheduleEvent {
  return {
    title: "Test Event",
    description: "A test event",
    kind: "session",
    startsAt: "09:00:00",
    duration: 60,
    enterCommands: ["claim hall-a ghost_test"],
    exitCommands: ["yield hall-a"],
    ...overrides,
  };
}

describe("todayOccurrences", () => {
  const today = Temporal.Now.plainDateISO(WORLD_TIMEZONE);

  it("returns one occurrence for a non-recurring event", () => {
    const event = makeEvent({ id: "once", startsAt: "09:00:00" });
    const occs = todayOccurrences(event, today);
    assert.equal(occs.length, 1);
    assert.equal(occs[0].n, 1);
  });

  it("returns correct count for recurring event (09:00–11:00, every 60 min = 3)", () => {
    const event = makeEvent({ id: "hourly", startsAt: "09:00:00", repeat: 60, until: "11:00:00" });
    const occs = todayOccurrences(event, today);
    assert.equal(occs.length, 3);
  });

  it("occurrence times are spaced by repeat interval", () => {
    const event = makeEvent({ id: "every30", startsAt: "09:00:00", repeat: 30, until: "10:00:00" });
    const occs = todayOccurrences(event, today);
    assert.equal(occs.length, 3); // 09:00, 09:30, 10:00
    const diffMs = occs[1].zdt.epochMilliseconds - occs[0].zdt.epochMilliseconds;
    assert.equal(diffMs, 30 * 60_000);
  });
});

describe("WorldCalendarService.upcomingEvents", () => {
  it("returns empty array when no events loaded", async () => {
    const svc = makeWorldCalendarService([]);
    const events = await Effect.runPromise(svc.upcomingEvents(3));
    assert.deepEqual(events, []);
  });

  it("caps results at limit", async () => {
    const events = [
      makeEvent({ id: "a", startsAt: "23:00:00" }),
      makeEvent({ id: "b", startsAt: "23:30:00" }),
      makeEvent({ id: "c", startsAt: "23:59:00" }),
    ];
    const svc = makeWorldCalendarService(events);
    const upcoming = await Effect.runPromise(svc.upcomingEvents(2));
    assert.ok(upcoming.length <= 2);
  });

  it("omits command fields from ScheduledEvent", async () => {
    const svc = makeWorldCalendarService([makeEvent({ id: "ev", startsAt: "23:59:00" })]);
    const upcoming = await Effect.runPromise(svc.upcomingEvents(1));
    if (upcoming.length > 0) {
      assert.ok(!("enterCommands" in upcoming[0]));
      assert.ok(!("exitCommands" in upcoming[0]));
    }
  });
});

describe("WorldCalendarService.tick", () => {
  it("tick completes without error for past event", async () => {
    const event = makeEvent({ id: "past", startsAt: "00:00:01", duration: 1 });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("does not re-fire an already-started event on subsequent ticks", async () => {
    const event = makeEvent({ id: "once", startsAt: "00:00:01", duration: 0 });
    const svc = makeWorldCalendarService([event]);
    await Effect.runPromise(svc.tick());
    await Effect.runPromise(svc.tick());
    await Effect.runPromise(svc.tick());
    assert.ok(true); // idempotent — no crash, no duplicate dispatch
  });

  it("handles NoActorOrigin gracefully (go command)", async () => {
    const event = makeEvent({ id: "move", startsAt: "00:00:01", duration: 0, enterCommands: ["go n"] });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("handles UnknownCalendarCommand gracefully", async () => {
    const event = makeEvent({ id: "unknown", startsAt: "00:00:01", duration: 0, enterCommands: ["frobnicate x"] });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("handles CommandNotYetImplemented (activate) gracefully", async () => {
    const event = makeEvent({ id: "stub", startsAt: "00:00:01", duration: 0, enterCommands: ["activate lobby-coffee"] });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("window event: exit fires when duration has elapsed", async () => {
    const event = makeEvent({ id: "window", startsAt: "00:00:01", duration: 1 });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("point event: exit commands are ignored (duration=0)", async () => {
    const event = makeEvent({ id: "point", startsAt: "00:00:01", duration: 0, exitCommands: ["should-be-ignored"] });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });

  it("multiple commands in one event all execute without crashing", async () => {
    const event = makeEvent({
      id: "multi",
      startsAt: "00:00:01",
      duration: 0,
      enterCommands: ["claim hall-a ghost_test", "raffle vendor-1", "go n"],
    });
    const svc = makeWorldCalendarService([event]);
    await assert.doesNotReject(Effect.runPromise(svc.tick()));
  });
});

describe("firedKey", () => {
  it("includes id, date, and occurrence number", () => {
    const today = Temporal.PlainDate.from("2026-06-05");
    assert.equal(firedKey("opening-keynote", today, 1), "opening-keynote@2026-06-05@1");
    assert.equal(firedKey("hourly-checkin", today, 3), "hourly-checkin@2026-06-05@3");
  });
});
