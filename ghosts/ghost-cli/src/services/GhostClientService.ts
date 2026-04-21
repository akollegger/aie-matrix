import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { Context, Data, Effect, Layer, Scope } from "effect";

import type { GhostConfig } from "../config.js";

export type GhostToolName =
  | "whoami"
  | "whereami"
  | "look"
  | "exits"
  | "go"
  | "say"
  | "bye"
  | "inbox";

export class NetworkError extends Data.TaggedError("GhostClient.NetworkError")<{
  readonly message: string;
}> {}

export class ProtocolError extends Data.TaggedError("GhostClient.ProtocolError")<{
  readonly message: string;
}> {}

export class ToolError extends Data.TaggedError("GhostClient.ToolError")<{
  readonly code: string;
  readonly message: string;
}> {}

export type GhostClientError = NetworkError | ProtocolError | ToolError;

export class GhostClientService extends Context.Tag("@aie-matrix/ghost-cli/GhostClientService")<
  GhostClientService,
  {
    readonly callTool: (
      name: GhostToolName,
      args?: Record<string, unknown>,
    ) => Effect.Effect<unknown, GhostClientError>;
  }
>() {}

function mapCallError(e: unknown): GhostClientError {
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();
  if (lower.includes("fetch") || lower.includes("econnrefused") || lower.includes("network")) {
    return new NetworkError({ message: msg });
  }
  if (lower.includes("protocol") || lower.includes("jsonrpc")) {
    return new ProtocolError({ message: msg });
  }
  try {
    const parsed = JSON.parse(msg) as { code?: unknown; message?: unknown };
    const code = typeof parsed.code === "string" ? parsed.code : "TOOL_ERROR";
    const message = typeof parsed.message === "string" ? parsed.message : msg;
    return new ToolError({ code, message });
  } catch {
    return new ToolError({ code: "TOOL_ERROR", message: msg });
  }
}

export const GhostClientLayer = (
  config: GhostConfig,
): Layer.Layer<GhostClientService, GhostClientError, Scope.Scope> =>
  Layer.scoped(
    GhostClientService,
    Effect.gen(function* () {
      const client = new GhostMcpClient({
        worldApiBaseUrl: config.url.trim(),
        token: config.token.trim(),
      });
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => client.connect(),
          catch: mapCallError,
        }),
        () => Effect.promise(() => client.disconnect()),
      );
      return GhostClientService.of({
        callTool: (name, args = {}) =>
          Effect.tryPromise({
            try: () => client.callTool(name, args),
            catch: mapCallError,
          }),
      });
    }),
  );
