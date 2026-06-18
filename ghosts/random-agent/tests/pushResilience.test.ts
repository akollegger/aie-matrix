import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests for push-failure degraded/recovered state (T036)
// and task-not-found discard-and-reinitiate (T037).
// These are unit tests against exported helpers from executor.ts.
import {
  trackPushFailure,
  trackPushSuccess,
  getPushState,
  resetPushStateForGhost,
  PUSH_FAILURE_THRESHOLD,
} from "../src/executor.js";

describe("push-failure degraded/recovered tracking (FR-007)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("state starts as ok", () => {
    resetPushStateForGhost("ghost-p1");
    expect(getPushState("ghost-p1").status).toBe("ok");
  });

  it("emits random-agent.push.degraded once after PUSH_FAILURE_THRESHOLD consecutive failures", () => {
    resetPushStateForGhost("ghost-p2");
    for (let i = 0; i < PUSH_FAILURE_THRESHOLD; i++) {
      trackPushFailure("ghost-p2", new Error("503 Service Unavailable"));
    }

    const logCalls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map(([m]) => {
      try { return JSON.parse(m as string) as Record<string, unknown>; } catch { return null; }
    });
    const degraded = logCalls.filter((e) => e?.event === "random-agent.push.degraded" && e.ghostId === "ghost-p2");
    // Exactly one degraded event, not one per failure
    expect(degraded.length).toBe(1);

    expect(getPushState("ghost-p2").status).toBe("degraded");
  });

  it("emits random-agent.push.recovered when push succeeds after degraded", () => {
    resetPushStateForGhost("ghost-p3");
    for (let i = 0; i < PUSH_FAILURE_THRESHOLD; i++) {
      trackPushFailure("ghost-p3", new Error("503"));
    }
    // Now succeed
    trackPushSuccess("ghost-p3");

    const logCalls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map(([m]) => {
      try { return JSON.parse(m as string) as Record<string, unknown>; } catch { return null; }
    });
    const recovered = logCalls.find((e) => e?.event === "random-agent.push.recovered" && e.ghostId === "ghost-p3");
    expect(recovered).toBeDefined();
    expect(getPushState("ghost-p3").status).toBe("ok");
  });

  it("does not crash or throw on failures below threshold", () => {
    resetPushStateForGhost("ghost-p4");
    expect(() => {
      for (let i = 0; i < PUSH_FAILURE_THRESHOLD - 1; i++) {
        trackPushFailure("ghost-p4", new Error("transient"));
      }
    }).not.toThrow();
    expect(getPushState("ghost-p4").status).toBe("ok");
  });
});

describe("task-not-found discard-and-reinitiate (FR-007a)", () => {
  // T037: When executor receives a task-not-found response shape,
  // it should discard ghostIdToTaskId and allow re-spawn.
  it("isTaskNotFoundError detects task-not-found response shape", async () => {
    const { isTaskNotFoundError } = await import("../src/executor.js");
    expect(isTaskNotFoundError({ error: "task not found" })).toBe(true);
    expect(isTaskNotFoundError({ error: "Task not found" })).toBe(true);
    expect(isTaskNotFoundError({ error: "unauthorized" })).toBe(false);
    expect(isTaskNotFoundError(null)).toBe(false);
    expect(isTaskNotFoundError({ ok: true })).toBe(false);
  });
});
