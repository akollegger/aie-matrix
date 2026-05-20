import { describe, it, expect } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { makeMcpProxy } from "../../src/mcp-proxy/McpProxyService.js";
import type { AgentSession } from "../../src/types.js";

function makeSession(requiredTools: string[]): AgentSession {
  return {
    sessionId: "s1",
    agentId: "a1",
    ghostId: "g1",
    status: "running",
    restartCount: 0,
    lastHealthCheckAt: null,
    spawnedAt: new Date(),
    mcpToken: "tok",
    worldCredential: { token: "t", worldApiBaseUrl: "http://example.com/mcp" },
    requiredTools,
    currentTaskId: null,
    currentA2AContextId: null,
    usesA2APush: false,
    restartWindow: [],
    currentBackoffMs: 5_000,
  };
}

const toolCallBody = (name: string): Buffer =>
  Buffer.from(JSON.stringify({ method: "tools/call", params: { name } }));

describe("McpProxy.assertToolAllowed", () => {
  const proxy = makeMcpProxy();

  it("allows declared tools", async () => {
    const result = await Effect.runPromiseExit(
      proxy.assertToolAllowed(makeSession(["whereami"]), "POST", toolCallBody("whereami")),
    );
    expect(Exit.isSuccess(result)).toBe(true);
  });

  it("rejects undeclared tools with McpToolRejected", async () => {
    const result = await Effect.runPromiseExit(
      proxy.assertToolAllowed(makeSession(["whereami"]), "POST", toolCallBody("go")),
    );
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const err = Cause.failureOption(result.cause);
      expect(err._tag).toBe("Some");
      if (err._tag === "Some") {
        expect(err.value._tag).toBe("McpToolRejected");
        expect(err.value.toolName).toBe("go");
      }
    }
  });

  it("allows empty required-tools list only for non-call requests", async () => {
    const body = Buffer.from(JSON.stringify({ method: "tools/list", params: {} }));
    const result = await Effect.runPromiseExit(
      proxy.assertToolAllowed(makeSession([]), "POST", body),
    );
    expect(Exit.isSuccess(result)).toBe(true);
  });

  it("passes empty body without error", async () => {
    const result = await Effect.runPromiseExit(
      proxy.assertToolAllowed(makeSession([]), "POST", Buffer.from("")),
    );
    expect(Exit.isSuccess(result)).toBe(true);
  });

  it("passes malformed JSON without error", async () => {
    const result = await Effect.runPromiseExit(
      proxy.assertToolAllowed(makeSession([]), "POST", Buffer.from("{bad json")),
    );
    expect(Exit.isSuccess(result)).toBe(true);
  });
});
