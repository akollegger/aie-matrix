import { Data } from "effect";

export class AgentCardInvalid extends Data.TaggedError("AgentCardInvalid")<{
  readonly message: string;
  readonly fieldErrors?: readonly string[];
}> {}

export class AgentAlreadyRegistered extends Data.TaggedError("AgentAlreadyRegistered")<{
  readonly agentId: string;
}> {}

export class AgentCardFetchFailed extends Data.TaggedError("AgentCardFetchFailed")<{
  readonly url: string;
  readonly message: string;
  readonly status?: number;
}> {}

export class AgentNotFound extends Data.TaggedError("AgentNotFound")<{
  readonly agentId: string;
}> {}

export class SpawnFailed extends Data.TaggedError("SpawnFailed")<{
  readonly message: string;
}> {}

export class SpawnTimeout extends Data.TaggedError("SpawnTimeout")<{
  readonly message: string;
}> {}

export class HealthCheckTimeout extends Data.TaggedError("HealthCheckTimeout")<{
  readonly sessionId: string;
}> {}

export class RetryLimitExceeded extends Data.TaggedError("RetryLimitExceeded")<{
  readonly sessionId: string;
}> {}

export class CapabilityUnmet extends Data.TaggedError("CapabilityUnmet")<{
  readonly missing: readonly string[];
}> {}

export class Unauthorized extends Data.TaggedError("Unauthorized")<{
  readonly message: string;
}> {}

export class ActiveSessionsPreventDeregister extends Data.TaggedError("ActiveSessionsPreventDeregister")<{
  readonly agentId: string;
  readonly count: number;
}> {}

export class McpToolRejected extends Data.TaggedError("McpToolRejected")<{
  readonly toolName: string;
  readonly message: string;
}> {}

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly sessionId: string;
}> {}

export type HouseHttpError =
  | AgentCardInvalid
  | AgentAlreadyRegistered
  | AgentCardFetchFailed
  | AgentNotFound
  | SpawnFailed
  | SpawnTimeout
  | CapabilityUnmet
  | Unauthorized
  | ActiveSessionsPreventDeregister
  | McpToolRejected
  | SessionNotFound;
