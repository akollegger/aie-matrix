import { Effect, Layer } from "effect";
import type { LeaderboardEntry, LeaderboardResult, LeaderboardSpec } from "@aie-matrix/shared-types";
import { LeaderboardNotFound } from "./leaderboard-errors.js";
import { LeaderboardService, type LeaderboardServiceOps } from "./LeaderboardService.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeLeaderboardServiceInMemory(): LeaderboardServiceOps & {
  seed(id: string, entries: LeaderboardEntry[]): void;
} {
  const specs = new Map<string, LeaderboardSpec>();
  const results = new Map<string, LeaderboardResult>();
  let isFinal = false;

  function computeResult(spec: LeaderboardSpec): LeaderboardResult {
    const existing = results.get(spec.id);
    const entries = existing ? existing.entries : [];
    // Sort: higher score first; tie-break by lastContributingAt ascending (earlier = ranked higher)
    const sorted = [...entries].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.lastContributingAt.localeCompare(b.lastContributingAt);
    });
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      entries: sorted,
      computedAt: new Date().toISOString(),
      isFinal,
    };
  }

  return {
    init(newSpecs) {
      return Effect.sync(() => {
        specs.clear();
        for (const spec of newSpecs) {
          specs.set(spec.id, spec);
        }
      });
    },

    listLeaderboards() {
      return Effect.sync(() =>
        Array.from(specs.values()).map(({ id, title, description }) => ({ id, title, description })),
      );
    },

    getLeaderboard(id) {
      return Effect.sync(() => {
        const spec = specs.get(id);
        if (!spec) {
          return null as unknown as LeaderboardResult;
        }
        return computeResult(spec);
      }).pipe(
        Effect.flatMap((result) => {
          if (result === null) {
            return Effect.fail(new LeaderboardNotFound({ leaderboardId: id }));
          }
          return Effect.succeed(result);
        }),
      );
    },

    finalizeLeaderboards() {
      return Effect.sync(() => {
        isFinal = true;
      });
    },

    seed(id, entries) {
      const spec = specs.get(id);
      if (!spec) return;
      results.set(id, {
        id: spec.id,
        title: spec.title,
        description: spec.description,
        entries,
        computedAt: new Date().toISOString(),
        isFinal,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const LeaderboardServiceInMemoryLayer: Layer.Layer<LeaderboardService, never, never> =
  Layer.sync(LeaderboardService, () => makeLeaderboardServiceInMemory());
