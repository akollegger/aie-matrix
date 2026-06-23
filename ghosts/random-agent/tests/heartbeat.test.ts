import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import will fail until heartbeat.ts is created (TDD)
import { startHeartbeat } from "../src/heartbeat.js";

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls the heartbeat endpoint at the configured interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionActive: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSessionChange = vi.fn();
    const stop = startHeartbeat({
      agentId: "test-agent",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 30_000,
      onSessionChange,
    });

    // Advance past the initial 0ms timeout so the first beat fires
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/catalog/test-agent/heartbeat",
      expect.objectContaining({ method: "POST" }),
    );

    stop();
  });

  it("calls onSessionChange when sessionId changes", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      const sessionId = callCount === 1 ? "session-1" : "session-2";
      return {
        ok: true,
        json: () => Promise.resolve({ sessionActive: true, sessionId }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSessionChange = vi.fn();
    const stop = startHeartbeat({
      agentId: "test-agent",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 100,
      onSessionChange,
    });

    // First tick — no prior session, so first sessionId triggers change
    await vi.advanceTimersByTimeAsync(10);
    // Second tick — session changed
    await vi.advanceTimersByTimeAsync(110);

    // onSessionChange should have been called at least once
    expect(onSessionChange).toHaveBeenCalledWith("session-2");

    stop();
  });

  it("does NOT call onSessionChange when sessionId is unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionActive: true, sessionId: "same-session" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSessionChange = vi.fn();
    const stop = startHeartbeat({
      agentId: "test-agent",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 100,
      onSessionChange,
    });

    // Advance to fire 3 times
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(110);
    await vi.advanceTimersByTimeAsync(110);

    // onSessionChange should be called once (on first encounter of the session ID)
    // Subsequent same-ID responses should NOT trigger it
    expect(onSessionChange.mock.calls.length).toBeLessThanOrEqual(1);

    stop();
  });

  it("calls onNotRegistered and stops the loop on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const onSessionChange = vi.fn();
    const onNotRegistered = vi.fn();
    const stop = startHeartbeat({
      agentId: "test-agent",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 100,
      onSessionChange,
      onNotRegistered,
    });

    // Fire first beat
    await vi.advanceTimersByTimeAsync(10);
    expect(onNotRegistered).toHaveBeenCalledTimes(1);

    // Advance further — loop should have stopped, no additional fetches
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("silently retries (no crash) when heartbeat HTTP fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const onSessionChange = vi.fn();
    let stop!: () => void;
    expect(() => {
      stop = startHeartbeat({
        agentId: "test-agent",
        agentHostUrl: "http://localhost:4000",
        token: "secret",
        intervalMs: 100,
        onSessionChange,
      });
    }).not.toThrow();

    // Advance — should not throw
    await vi.advanceTimersByTimeAsync(150);
    expect(onSessionChange).not.toHaveBeenCalled();

    stop?.();
  });
});
