import { Data } from "effect";

export class McpHandlerError extends Data.TaggedError("McpHandlerError")<{
  readonly message: string;
}> {}
