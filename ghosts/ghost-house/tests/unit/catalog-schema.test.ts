import { describe, expect, it } from "vitest";
import { isUrlSafeAgentId, parseAndValidateAgentCard } from "../../src/catalog/agent-card-schema.js";

describe("agent-card-schema", () => {
  it("rejects bad agentId", () => {
    expect(isUrlSafeAgentId("a/b")).toBe(false);
    expect(isUrlSafeAgentId("ok")).toBe(true);
  });

  it("validates ic-001 sample shape", () => {
    const r = parseAndValidateAgentCard({
      name: "x",
      description: "d",
      protocolVersion: "0.3.0",
      version: "0.0.1",
      url: "http://127.0.0.1:1",
      capabilities: { streaming: true, pushNotifications: false },
      skills: [{ id: "s", name: "S", description: "D" }],
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      matrix: {
        schemaVersion: 1,
        tier: "wanderer",
        ghostClasses: ["any"],
        requiredTools: ["whereami", "exits", "go"],
        capabilitiesRequired: [],
        memoryKind: "none",
        llmProvider: "none",
        profile: { about: "about" },
        authors: ["a"],
      },
    });
    expect(r.ok).toBe(true);
  });
});
