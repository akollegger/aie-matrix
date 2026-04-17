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
    new EnvMissingUrl({ hasEnvFile: false }),
    new UrlMissingMcpSuffix({ url: "http://x" }),
    new ServerUnreachable({ host: "127.0.0.1", port: 8787, errno: "ECONNREFUSED" }),
    new HostNotFound({ host: "nope.local" }),
    new McpEndpointNotFound({ url: "http://127.0.0.1:8787/mcp" }),
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
    expect(toExitCode(new McpEndpointNotFound({ url: "u" }))).toBe(2);
    expect(toExitCode(new UnknownNetworkError({ url: "u", detail: "d" }))).toBe(2);
  });

  it("maps auth errors to 3", () => {
    expect(toExitCode(new TokenRejected())).toBe(3);
    expect(toExitCode(new GhostNotFound())).toBe(3);
  });
});
