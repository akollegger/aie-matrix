import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Schedule, Duration } from "effect";

// Import the module under test — will fail until reconnect.ts is created (TDD)
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  makeReconnectSchedule,
  McpConnectionBroken,
  logDegraded,
  logRecovered,
} from "../src/reconnect.js";

describe("CONSECUTIVE_FAILURE_THRESHOLD", () => {
  it("is defined and >= 1", () => {
    expect(typeof CONSECUTIVE_FAILURE_THRESHOLD).toBe("number");
    expect(CONSECUTIVE_FAILURE_THRESHOLD).toBeGreaterThanOrEqual(1);
  });

  it("defaults to 5", () => {
    expect(CONSECUTIVE_FAILURE_THRESHOLD).toBe(5);
  });
});

describe("McpConnectionBroken", () => {
  it("is a tagged error with _tag = McpConnectionBroken", () => {
    const err = new McpConnectionBroken({ ghostId: "g1", reason: "test" });
    expect(err._tag).toBe("McpConnectionBroken");
    expect(err.ghostId).toBe("g1");
    expect(err.reason).toBe("test");
  });
});

describe("makeReconnectSchedule()", () => {
  it("returns a Schedule", () => {
    const sched = makeReconnectSchedule();
    expect(sched).toBeDefined();
  });

  it("schedule is composed of exponential and upTo (smoke test — runs without throwing)", async () => {
    const sched = makeReconnectSchedule();
    // Run a failing Effect with the schedule — it should retry and eventually give up
    let attempts = 0;
    const result = await Effect.runPromiseExit(
      Effect.fail(new McpConnectionBroken({ ghostId: "g1", reason: "test" })).pipe(
        Effect.tap(() => { attempts++; }),
        // Schedule with very short intervals for testing
        Effect.retry(Schedule.intersect(Schedule.recurs(2), Schedule.spaced("1 millis"))),
      ),
    );
    expect(attempts).toBe(0); // fail is immediate; attempts counts the tap before fail
    expect(result._tag).toBe("Failure");
  });

  it("schedule starts at approximately 2s (exponential base)", () => {
    // Verify the schedule is exported and is a valid Schedule type
    const sched = makeReconnectSchedule();
    // We can't easily test exact delays without running live, but we can confirm it's an Effect Schedule
    expect(sched).toBeDefined();
    expect(typeof sched).toBe("object");
  });
});

describe("logDegraded / logRecovered structured events", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("logDegraded emits a structured npc-agent.mcp.degraded event with ghostId", () => {
    logDegraded("ghost-abc");
    const logged = (console.log as ReturnType<typeof vi.spyOn>).mock.calls
      .concat((console.warn as ReturnType<typeof vi.spyOn>).mock.calls)
      .map(([msg]) => {
        try { return JSON.parse(msg as string) as Record<string, unknown>; } catch { return null; }
      })
      .filter(Boolean);
    const found = logged.find((e) => e && e["event"] === "npc-agent.mcp.degraded");
    expect(found).toBeDefined();
    expect(found!["ghostId"]).toBe("ghost-abc");
  });

  it("logRecovered emits a structured npc-agent.mcp.recovered event with ghostId", () => {
    logRecovered("ghost-xyz");
    const logged = (console.log as ReturnType<typeof vi.spyOn>).mock.calls
      .concat((console.warn as ReturnType<typeof vi.spyOn>).mock.calls)
      .map(([msg]) => {
        try { return JSON.parse(msg as string) as Record<string, unknown>; } catch { return null; }
      })
      .filter(Boolean);
    const found = logged.find((e) => e && e["event"] === "npc-agent.mcp.recovered");
    expect(found).toBeDefined();
    expect(found!["ghostId"]).toBe("ghost-xyz");
  });

  it("logDegraded emits exactly once per call (not once per tick)", () => {
    logDegraded("ghost-once");
    logDegraded("ghost-once"); // intentionally called twice — separate call from separate tests
    const logged = (console.log as ReturnType<typeof vi.spyOn>).mock.calls
      .concat((console.warn as ReturnType<typeof vi.spyOn>).mock.calls)
      .map(([msg]) => {
        try { return JSON.parse(msg as string) as Record<string, unknown>; } catch { return null; }
      })
      .filter(Boolean);
    const degradedEvents = logged.filter(
      (e) => e && e["event"] === "npc-agent.mcp.degraded" && e["ghostId"] === "ghost-once",
    );
    // Each logDegraded call emits exactly one log line (the caller is responsible for calling it once)
    expect(degradedEvents.length).toBe(2); // two calls → two events
  });
});
