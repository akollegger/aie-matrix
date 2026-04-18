import { describe, expect, it } from "vitest";

import { formatDiagnostic, toExitCode } from "../src/diagnostics.js";
import {
  EnvMissingToken,
  EnvMissingUrl,
  GhostNotFound,
  HostNotFound,
  McpEndpointNotFound,
  ServerUnreachable,
  TokenRejected,
  UnknownNetworkError,
  UrlMissingMcpSuffix,
} from "../src/preflight/errors.js";

describe("formatDiagnostic", () => {
  const cases = [
    new EnvMissingToken({ inRepoRoot: true }),
    new EnvMissingToken({ inRepoRoot: false, workspaceRoot: "/tmp/aie-matrix" }),
    new EnvMissingUrl({ hasEnvFile: false }),
    new EnvMissingUrl({ hasEnvFile: true }),
    new UrlMissingMcpSuffix({ url: "http://x" }),
    new ServerUnreachable({ host: "127.0.0.1", port: 8787, errno: "ECONNREFUSED" }),
    new ServerUnreachable({ host: "127.0.0.1", port: 9999, errno: "ECONNREFUSED" }),
    new ServerUnreachable({ host: "127.0.0.1", port: 8787, errno: "ETIMEDOUT" }),
    new HostNotFound({ host: "nope.local" }),
    new McpEndpointNotFound({ url: "http://127.0.0.1:8787/mcp" }),
    new McpEndpointNotFound({ url: "http://127.0.0.1:8787/mcp", originStatus: 200 }),
    new TokenRejected(),
    new GhostNotFound(),
    new UnknownNetworkError({ url: "http://x/mcp", detail: "oops" }),
  ] as const;

  it("returns non-empty message and remedy for guided-resolution types", () => {
    for (const e of cases) {
      if (e instanceof UnknownNetworkError) {
        continue;
      }
      const d = formatDiagnostic(e);
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.remedy.length).toBeGreaterThan(0);
    }
  });

  it("UnknownNetworkError has empty remedy", () => {
    const d = formatDiagnostic(new UnknownNetworkError({ url: "u", detail: "d" }));
    expect(d.remedy).toBe("");
  });

  it("reachability: default port ECONNREFUSED mentions world server and server script", () => {
    const d = formatDiagnostic(
      new ServerUnreachable({ host: "127.0.0.1", port: 8787, errno: "ECONNREFUSED" }),
    );
    expect(d.message.toLowerCase()).toContain("world server");
    expect(d.remedy).toContain("pnpm run server");
  });

  it("reachability: non-default port ECONNREFUSED describes nothing listening", () => {
    const d = formatDiagnostic(
      new ServerUnreachable({ host: "127.0.0.1", port: 9999, errno: "ECONNREFUSED" }),
    );
    expect(d.message).toContain("9999");
    expect(d.message.toLowerCase()).toContain("nothing is listening");
  });

  it("reachability: HostNotFound describes DNS / resolution", () => {
    const d = formatDiagnostic(new HostNotFound({ host: "nope.local" }));
    expect(d.message.toLowerCase()).toMatch(/resolve|dns/);
  });

  it("reachability: MCP 404 with healthy origin describes server up but MCP missing", () => {
    const d = formatDiagnostic(
      new McpEndpointNotFound({ url: "http://127.0.0.1:8787/mcp", originStatus: 200 }),
    );
    expect(d.message).toContain("200");
    expect(d.message.toLowerCase()).toMatch(/404|mcp/);
  });

  it("env-scan: missing token at repo root uses repo-specific remedy", () => {
    const d = formatDiagnostic(new EnvMissingToken({ inRepoRoot: true }));
    expect(d.remedy).toContain("pnpm run ghost:register");
    expect(d.remedy).toContain(".env");
  });

  it("env-scan: missing token outside repo root with workspaceRoot uses cd", () => {
    const d = formatDiagnostic(
      new EnvMissingToken({ inRepoRoot: false, workspaceRoot: "/abs/repo" }),
    );
    expect(d.remedy).toContain("cd");
    expect(d.remedy).toContain("/abs/repo");
  });

  it("env-scan: missing URL with .env instructs editing .env", () => {
    const d = formatDiagnostic(new EnvMissingUrl({ hasEnvFile: true }));
    expect(d.remedy.toLowerCase()).toContain(".env");
    expect(d.remedy).toContain("WORLD_API_URL");
  });
});

describe("toExitCode (IC-005)", () => {
  it("maps configuration errors to 1", () => {
    expect(toExitCode(new EnvMissingToken({ inRepoRoot: true }))).toBe(1);
    expect(toExitCode(new EnvMissingUrl({ hasEnvFile: true }))).toBe(1);
    expect(toExitCode(new UrlMissingMcpSuffix({ url: "x" }))).toBe(1);
  });

  it("maps infrastructure-style errors to 2", () => {
    expect(toExitCode(new ServerUnreachable({ host: "h", port: 1, errno: "E" }))).toBe(2);
    expect(toExitCode(new HostNotFound({ host: "h" }))).toBe(2);
    expect(toExitCode(new McpEndpointNotFound({ url: "u", originStatus: 200 }))).toBe(2);
    expect(toExitCode(new UnknownNetworkError({ url: "u", detail: "d" }))).toBe(2);
  });

  it("maps auth errors to 3", () => {
    expect(toExitCode(new TokenRejected())).toBe(3);
    expect(toExitCode(new GhostNotFound())).toBe(3);
  });
});
