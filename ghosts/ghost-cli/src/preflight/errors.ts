import { Data } from "effect";

export class EnvMissingToken extends Data.TaggedError("PreFlight.EnvMissingToken")<{
  readonly inRepoRoot: boolean;
}> {}

export class EnvMissingUrl extends Data.TaggedError("PreFlight.EnvMissingUrl")<{
  readonly hasEnvFile: boolean;
}> {}

export class UrlMissingMcpSuffix extends Data.TaggedError("PreFlight.UrlMissingMcpSuffix")<{
  readonly url: string;
}> {}

export class ServerUnreachable extends Data.TaggedError("PreFlight.ServerUnreachable")<{
  readonly host: string;
  readonly port: number;
  readonly errno: string;
}> {}

export class HostNotFound extends Data.TaggedError("PreFlight.HostNotFound")<{
  readonly host: string;
}> {}

export class McpEndpointNotFound extends Data.TaggedError("PreFlight.McpEndpointNotFound")<{
  readonly url: string;
}> {}

export class TokenRejected extends Data.TaggedError("PreFlight.TokenRejected")<{}> {}

export class GhostNotFound extends Data.TaggedError("PreFlight.GhostNotFound")<{}> {}

export class UnknownNetworkError extends Data.TaggedError("PreFlight.UnknownNetworkError")<{
  readonly url: string;
  readonly detail: string;
}> {}

export type PreFlightError =
  | EnvMissingToken
  | EnvMissingUrl
  | UrlMissingMcpSuffix
  | ServerUnreachable
  | HostNotFound
  | McpEndpointNotFound
  | TokenRejected
  | GhostNotFound
  | UnknownNetworkError;
