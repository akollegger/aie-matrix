import { describe, expect, it } from "vitest";
import { buildWandererAgentCard } from "../src/buildAgentCard.js";

describe("buildWandererAgentCard", () => {
  it("ic-001 wanderer fields", () => {
    const c = buildWandererAgentCard("http://127.0.0.1:4001");
    expect(c.protocolVersion).toBe("0.3.0");
    expect(c.matrix.tier).toBe("wanderer");
    expect(c.capabilities.streaming).toBe(true);
    expect(c.capabilities.pushNotifications).toBe(false);
    expect(c.matrix.requiredTools).toContain("whereami");
  });
});
