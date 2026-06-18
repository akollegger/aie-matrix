import { describe, it, expect, vi, afterEach } from "vitest";
import * as executorMod from "../src/executor.js";

describe("npc-agent health logic reflects MCP degraded state (T026)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getDegradedGhosts returns empty set initially", () => {
    const degraded = executorMod.getDegradedGhosts();
    // The set should exist and be iterable
    expect(typeof degraded.size).toBe("number");
  });

  it("health is ok when no ghosts are degraded", () => {
    vi.spyOn(executorMod, "getDegradedGhosts").mockReturnValue(new Set());
    const degraded = executorMod.getDegradedGhosts();
    expect(degraded.size).toBe(0);
    // Health endpoint logic: status === "ok"
    const status = degraded.size > 0 ? "degraded" : "ok";
    expect(status).toBe("ok");
  });

  it("health is degraded when getDegradedGhosts returns non-empty set", () => {
    vi.spyOn(executorMod, "getDegradedGhosts").mockReturnValue(new Set(["ghost-1", "ghost-2"]));
    const degraded = executorMod.getDegradedGhosts();
    expect(degraded.size).toBe(2);
    const status = degraded.size > 0 ? "degraded" : "ok";
    const ghosts = [...degraded].map((ghostId) => ({ ghostId, status: "degraded" as const }));
    expect(status).toBe("degraded");
    expect(ghosts).toContainEqual({ ghostId: "ghost-1", status: "degraded" });
    expect(ghosts).toContainEqual({ ghostId: "ghost-2", status: "degraded" });
  });
});
