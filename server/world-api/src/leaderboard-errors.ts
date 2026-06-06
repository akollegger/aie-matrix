import { Data } from "effect";

export class LeaderboardNotFound extends Data.TaggedError("LeaderboardError.NotFound")<{
  readonly leaderboardId: string;
}> {}

export class LeaderboardPersistenceError extends Data.TaggedError("LeaderboardError.PersistenceError")<{
  readonly cause: string;
}> {}

export type LeaderboardError = LeaderboardNotFound | LeaderboardPersistenceError;
