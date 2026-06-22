import { describe, it, expect } from "vitest";
import { buildIdentityMap } from "./ghostIdentityMap.js";

describe("buildIdentityMap — identity resolution", () => {
  const catalog = [
    { agentId: "npc-agent-local", tier: "npc",      about: "A rule-based NPC" },
    { agentId: "random-agent",    tier: "wanderer",  about: "A wanderer"       },
  ];

  it("uses session displayName when present", () => {
    const sessions = [{ ghostId: "g1", agentId: "npc-agent-local", status: "running", displayName: "The Broker" }];
    const map = buildIdentityMap(sessions, catalog);
    expect(map.get("g1")?.name).toBe("The Broker");
  });

  it("falls back to catalog about when session has no displayName", () => {
    const sessions = [{ ghostId: "g2", agentId: "random-agent", status: "running" }];
    const map = buildIdentityMap(sessions, catalog);
    expect(map.get("g2")?.name).toBe("A wanderer");
  });

  it("falls back to ghostId prefix when agent has no catalog entry", () => {
    const sessions = [{ ghostId: "abcdef123456789", agentId: "unknown-agent", status: "running" }];
    const map = buildIdentityMap(sessions, catalog);
    expect(map.get("abcdef123456789")?.name).toBe("abcdef123456");
  });

  it("sets ghostClass from catalog tier", () => {
    const sessions = [{ ghostId: "g3", agentId: "npc-agent-local", status: "running", displayName: "NPC" }];
    const map = buildIdentityMap(sessions, catalog);
    expect(map.get("g3")?.ghostClass).toBe("npc");
  });

  it("defaults ghostClass to 'agent' when catalog entry is missing", () => {
    const sessions = [{ ghostId: "g4", agentId: "mystery-agent", status: "running" }];
    const map = buildIdentityMap(sessions, []);
    expect(map.get("g4")?.ghostClass).toBe("agent");
  });

  it("builds entries for every session, keyed by ghostId", () => {
    const sessions = [
      { ghostId: "g1", agentId: "npc-agent-local", status: "running", displayName: "The Broker" },
      { ghostId: "g2", agentId: "random-agent",    status: "running" },
    ];
    const map = buildIdentityMap(sessions, catalog);
    expect(map.size).toBe(2);
    expect(map.has("g1")).toBe(true);
    expect(map.has("g2")).toBe(true);
  });

  it("returns empty map for empty sessions", () => {
    expect(buildIdentityMap([], catalog).size).toBe(0);
  });
});
