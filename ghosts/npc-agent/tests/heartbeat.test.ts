import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startHeartbeat } from "../src/heartbeat.js";

describe("startHeartbeat (npc-agent)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls the heartbeat endpoint at the configured interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const stop = startHeartbeat({
      agentId: "npc-agent-test",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 30_000,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/catalog/npc-agent-test/heartbeat",
      expect.objectContaining({ method: "POST" }),
    );

    stop();
  });

  it("calls onNotRegistered and stops the loop on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const onNotRegistered = vi.fn();
    const stop = startHeartbeat({
      agentId: "npc-agent-test",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 100,
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

  it("silently retries (no crash) when heartbeat network fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const onNotRegistered = vi.fn();
    let stop!: () => void;
    expect(() => {
      stop = startHeartbeat({
        agentId: "npc-agent-test",
        agentHostUrl: "http://localhost:4000",
        token: "secret",
        intervalMs: 100,
        onNotRegistered,
      });
    }).not.toThrow();

    await vi.advanceTimersByTimeAsync(150);
    expect(onNotRegistered).not.toHaveBeenCalled();

    stop?.();
  });

  it("continues beating normally on non-404 non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const onNotRegistered = vi.fn();
    const stop = startHeartbeat({
      agentId: "npc-agent-test",
      agentHostUrl: "http://localhost:4000",
      token: "secret",
      intervalMs: 100,
      onNotRegistered,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(110);
    await vi.advanceTimersByTimeAsync(110);

    // 503 should not trigger onNotRegistered and should keep looping
    expect(onNotRegistered).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();
  });
});
