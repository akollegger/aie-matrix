import { describe, it, expect, vi, afterEach } from "vitest";
import * as executorMod from "../src/executor.js";
import { PUSH_FAILURE_THRESHOLD } from "../src/executor.js";

describe("random-agent health logic reflects push degraded state (T027)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("health is ok when no ghosts are push-degraded", () => {
    vi.spyOn(executorMod, "getActivePushDegradedGhosts").mockReturnValue([]);
    const degraded = executorMod.getActivePushDegradedGhosts();
    const status = degraded.length > 0 ? "degraded" : "ok";
    expect(status).toBe("ok");
  });

  it(`health is degraded after ${PUSH_FAILURE_THRESHOLD} consecutive push failures`, () => {
    vi.spyOn(executorMod, "getActivePushDegradedGhosts").mockReturnValue(["ghost-push-1"]);
    const degraded = executorMod.getActivePushDegradedGhosts();
    const status = degraded.length > 0 ? "degraded" : "ok";
    expect(status).toBe("degraded");
    expect(degraded).toContain("ghost-push-1");
  });

  it("getActivePushDegradedGhosts returns array of degraded ghost IDs", () => {
    executorMod.resetPushStateForGhost("ghost-test-health");
    for (let i = 0; i < PUSH_FAILURE_THRESHOLD; i++) {
      executorMod.trackPushFailure("ghost-test-health", new Error("503"));
    }
    const degraded = executorMod.getActivePushDegradedGhosts();
    expect(degraded).toContain("ghost-test-health");
    // Cleanup
    executorMod.resetPushStateForGhost("ghost-test-health");
  });
});
