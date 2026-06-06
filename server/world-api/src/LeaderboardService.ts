import { Context, Effect } from "effect";
import type { LeaderboardResult, LeaderboardSpec } from "@aie-matrix/shared-types";
import type { LeaderboardNotFound, LeaderboardPersistenceError } from "./leaderboard-errors.js";

export interface LeaderboardServiceOps {
  /** Initialize the service with the leaderboard specs declared in the active map. */
  init(specs: LeaderboardSpec[]): Effect.Effect<void, never>;
  /** List all declared leaderboards (id, title, description). */
  listLeaderboards(): Effect.Effect<Array<{ id: string; title: string; description: string }>, never>;
  /** Get ranked results for one leaderboard. Returns spec+empty entries when no session data. */
  getLeaderboard(id: string): Effect.Effect<LeaderboardResult, LeaderboardNotFound | LeaderboardPersistenceError>;
  /** Freeze all leaderboards. Idempotent. */
  finalizeLeaderboards(): Effect.Effect<void, LeaderboardPersistenceError>;
}

export class LeaderboardService extends Context.Tag("aie-matrix/LeaderboardService")<
  LeaderboardService,
  LeaderboardServiceOps
>() {}
