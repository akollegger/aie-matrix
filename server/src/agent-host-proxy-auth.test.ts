import { describe, it, expect } from "vitest";
import { isPublicAgentHostRead } from "./agent-host-proxy.js";

describe("isPublicAgentHostRead", () => {
  it("allows GET /agent-host/v1/sessions without auth", () => {
    expect(isPublicAgentHostRead("GET", "/agent-host/v1/sessions")).toBe(true);
  });

  it("allows GET /agent-host/v1/catalog without auth", () => {
    expect(isPublicAgentHostRead("GET", "/agent-host/v1/catalog")).toBe(true);
  });

  it("requires auth for POST to a public-read path", () => {
    expect(isPublicAgentHostRead("POST", "/agent-host/v1/sessions")).toBe(false);
  });

  it("requires auth for GET to any other agent-host path", () => {
    expect(isPublicAgentHostRead("GET", "/agent-host/v1/sessions/spawn-trusted/foo")).toBe(false);
    expect(isPublicAgentHostRead("GET", "/agent-host/v1/catalog/register")).toBe(false);
    expect(isPublicAgentHostRead("GET", "/agent-host/v1/anything-else")).toBe(false);
  });

  it("requires auth for write methods on any agent-host path", () => {
    expect(isPublicAgentHostRead("POST",   "/agent-host/v1/catalog/register")).toBe(false);
    expect(isPublicAgentHostRead("DELETE", "/agent-host/v1/catalog/some-agent")).toBe(false);
    expect(isPublicAgentHostRead("PUT",    "/agent-host/v1/catalog/some-agent")).toBe(false);
  });
});
