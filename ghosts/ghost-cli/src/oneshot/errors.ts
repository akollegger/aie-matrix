import { Data } from "effect";

/** Invalid user input before any network call (exit 1 after printing the message). */
export class CliUsageError extends Data.TaggedError("GhostCli.CliUsage")<{
  readonly message: string;
}> {}

/**
 * User-facing output was already written; the runner should only set the process exit code.
 * Used so scoped MCP cleanup runs instead of calling `process.exit` mid-pipeline.
 */
export class CliSilentExit extends Data.TaggedError("GhostCli.CliSilentExit")<{
  readonly exitCode: number;
}> {}

export type OneshotCliError = CliUsageError | CliSilentExit;
