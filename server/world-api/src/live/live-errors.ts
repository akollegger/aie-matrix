import { Data } from "effect";

export class LiveSessionNotFoundError extends Data.TaggedError("LiveSessionNotFoundError")<{
  readonly id: string;
}> {}

export class LiveSessionMapNotPublishedError extends Data.TaggedError("LiveSessionMapNotPublishedError")<{
  readonly mapId: string;
}> {}

export class LiveSessionAlreadyEndedError extends Data.TaggedError("LiveSessionAlreadyEndedError")<{
  readonly id: string;
}> {}
