import { Effect, Either } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EnvMissingToken,
  EnvMissingUrl,
  UrlMissingMcpSuffix,
} from "../src/preflight/errors.js";
import { runEnvScan } from "../src/preflight/env-scan.js";

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testsDir, "../../..");

describe("runEnvScan (phase 1)", () => {
  it("fails when token is absent", async () => {
    const e = await Effect.runPromise(
      Effect.either(runEnvScan({ token: "", url: "http://127.0.0.1:8787/mcp" }, repoRoot)),
    );
    expect(Either.isLeft(e)).toBe(true);
    if (Either.isLeft(e)) {
      expect(e.left).toBeInstanceOf(EnvMissingToken);
    }
  });

  it("fails when URL is absent", async () => {
    const e = await Effect.runPromise(Effect.either(runEnvScan({ token: "t", url: "" }, repoRoot)));
    expect(Either.isLeft(e)).toBe(true);
    if (Either.isLeft(e)) {
      expect(e.left).toBeInstanceOf(EnvMissingUrl);
    }
  });

  it("fails when URL is missing /mcp suffix", async () => {
    const e = await Effect.runPromise(
      Effect.either(runEnvScan({ token: "t", url: "http://127.0.0.1:8787/" }, repoRoot)),
    );
    expect(Either.isLeft(e)).toBe(true);
    if (Either.isLeft(e)) {
      expect(e.left).toBeInstanceOf(UrlMissingMcpSuffix);
    }
  });

  it("passes when token and valid MCP URL are present", async () => {
    const e = await Effect.runPromise(
      Effect.either(runEnvScan({ token: "abc", url: "http://127.0.0.1:8787/mcp" }, repoRoot)),
    );
    expect(Either.isRight(e)).toBe(true);
  });
});
