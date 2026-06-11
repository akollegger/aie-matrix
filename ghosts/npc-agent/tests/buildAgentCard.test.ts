import { describe, it, expect } from "vitest";
import { buildNpcAgentCard } from "../src/buildAgentCard.js";

describe("buildNpcAgentCard", () => {
  const base = "http://127.0.0.1:4004";
  const card = buildNpcAgentCard(base) as unknown as Record<string, unknown>;

  it("sets pushNotifications to true", () => {
    const caps = card["capabilities"] as Record<string, unknown>;
    expect(caps["pushNotifications"]).toBe(true);
  });

  it("sets llmProvider to none", () => {
    const matrix = card["matrix"] as Record<string, unknown>;
    expect(matrix["llmProvider"]).toBe("none");
  });

  it("subscribes to world.session.start and world.message.new", () => {
    const matrix = card["matrix"] as Record<string, unknown>;
    const subs = matrix["worldEventSubscriptions"] as string[];
    expect(subs).toContain("world.session.start");
    expect(subs).toContain("world.message.new");
  });

  it("points the A2A endpoint to /a2a/jsonrpc", () => {
    expect(card["url"]).toBe(`${base}/a2a/jsonrpc`);
  });

  it("does not include trailing slash in URL when base has one", () => {
    const cardWithSlash = buildNpcAgentCard(`${base}/`) as unknown as Record<string, unknown>;
    // Should produce the same clean URL as without trailing slash
    expect(cardWithSlash["url"]).toBe(`${base}/a2a/jsonrpc`);
  });
});
