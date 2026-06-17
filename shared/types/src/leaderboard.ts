export type LeaderboardAggregation = "sum" | "count" | "max";
export type LeaderboardDirection = "received" | "distributed" | "net";
export type LeaderboardActorKind = "ghost" | "group" | "any";

export interface LeaderboardSpec {
  id: string;
  title: string;
  description: string;
  resource: string; // "*" matches any
  aggregation: LeaderboardAggregation;
  direction: LeaderboardDirection;
  actorKind: LeaderboardActorKind;
  cause?: string; // optional filter
}

export interface LeaderboardEntry {
  actorId: string;
  displayName: string;
  score: number;
  lastContributingAt: string; // ISO timestamp, for tie-breaking
}

export interface LeaderboardResult {
  id: string;
  title: string;
  description: string;
  entries: LeaderboardEntry[];
  computedAt: string; // ISO timestamp
  isFinal: boolean;
}
