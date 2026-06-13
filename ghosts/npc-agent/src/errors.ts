import { Data } from "effect";

/** Typed failure for a GhostMcpClient.callTool() call. */
export class McpCallError extends Data.TaggedError("McpCallError")<{
  readonly tool: string;
  readonly cause: unknown;
}> {}
