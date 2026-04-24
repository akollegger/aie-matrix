import { describe, it, expect } from "vitest";
import { mapHouseError } from "../../src/http-error-map.js";
import {
  ActiveSessionsPreventDeregister,
  AgentAlreadyRegistered,
  AgentCardFetchFailed,
  AgentCardInvalid,
  AgentNotFound,
  CapabilityUnmet,
  McpToolRejected,
  SessionNotFound,
  SpawnFailed,
  SpawnTimeout,
  Unauthorized,
} from "../../src/errors.js";

describe("mapHouseError", () => {
  it("Unauthorized → 401 UNAUTHORIZED", () => {
    const r = mapHouseError(new Unauthorized({ message: "bad token" }));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("UNAUTHORIZED");
  });

  it("AgentCardInvalid → 400 VALIDATION_FAILED", () => {
    const r = mapHouseError(new AgentCardInvalid({ message: "missing field" }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_FAILED");
  });

  it("AgentAlreadyRegistered → 409 ALREADY_REGISTERED", () => {
    const r = mapHouseError(new AgentAlreadyRegistered({ agentId: "a1" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ALREADY_REGISTERED");
  });

  it("AgentCardFetchFailed → 502 AGENT_CARD_FETCH_FAILED", () => {
    const r = mapHouseError(new AgentCardFetchFailed({ url: "http://x", message: "timeout" }));
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("AGENT_CARD_FETCH_FAILED");
  });

  it("AgentNotFound → 404 NOT_FOUND", () => {
    const r = mapHouseError(new AgentNotFound({ agentId: "missing" }));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("NOT_FOUND");
  });

  it("SpawnFailed → 503 AGENT_UNREACHABLE", () => {
    const r = mapHouseError(new SpawnFailed({ message: "refused" }));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AGENT_UNREACHABLE");
  });

  it("SpawnTimeout → 503 AGENT_UNREACHABLE", () => {
    const r = mapHouseError(new SpawnTimeout({ message: "timed out" }));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AGENT_UNREACHABLE");
  });

  it("CapabilityUnmet → 422 CAPABILITY_UNMET", () => {
    const r = mapHouseError(new CapabilityUnmet({ missing: ["streaming"] }));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("CAPABILITY_UNMET");
  });

  it("ActiveSessionsPreventDeregister → 409 ACTIVE_SESSIONS", () => {
    const r = mapHouseError(new ActiveSessionsPreventDeregister({ agentId: "a1", count: 2 }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ACTIVE_SESSIONS");
  });

  it("McpToolRejected → 403 MCP_TOOL_REJECTED", () => {
    const r = mapHouseError(new McpToolRejected({ toolName: "go", message: "not declared" }));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("MCP_TOOL_REJECTED");
  });

  it("SessionNotFound → 404 NOT_FOUND", () => {
    const r = mapHouseError(new SessionNotFound({ sessionId: "s1" }));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("NOT_FOUND");
  });

  it("unknown Error → 500 INTERNAL", () => {
    const r = mapHouseError(new Error("unexpected boom"));
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL");
    expect(r.body.error).toBe("unexpected boom");
  });

  it("non-Error → 500 INTERNAL", () => {
    const r = mapHouseError("something weird");
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL");
  });
});
