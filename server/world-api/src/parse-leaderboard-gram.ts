import { Effect, HashMap, HashSet, Option } from "effect";
import { Gram } from "@relateby/pattern";
import type { Subject, Pattern } from "@relateby/pattern";
import type { LeaderboardSpec } from "@aie-matrix/shared-types";

// ── Value extraction helpers ─────────────────────────────────────────────────

function getString(subject: Subject, key: string): string | undefined {
  return Option.match(HashMap.get(subject.properties, key), {
    onNone: () => undefined,
    onSome: (val) => {
      if (val && typeof val === "object" && "_tag" in val) {
        const v = val as { _tag: string; value?: unknown };
        if (v._tag === "StringVal" && typeof v.value === "string") return v.value;
      }
      return undefined;
    },
  });
}

function extractSpecs(patterns: ReadonlyArray<Pattern<Subject>>): LeaderboardSpec[] {
  const specs: LeaderboardSpec[] = [];

  for (const pattern of patterns) {
    const subject = pattern.value;
    if (!HashSet.has(subject.labels, "Leaderboards")) continue;

    for (const elemPattern of pattern.elements) {
      const elem = elemPattern.value;
      if (!HashSet.has(elem.labels, "Leaderboard")) continue;

      const id = elem.identity;
      if (!id) {
        console.warn("Leaderboard node missing identity — skipped");
        continue;
      }

      const title = getString(elem, "title");
      const description = getString(elem, "description");
      const resource = getString(elem, "resource");
      const aggregation = getString(elem, "aggregation") as LeaderboardSpec["aggregation"] | undefined;
      const direction = getString(elem, "direction") as LeaderboardSpec["direction"] | undefined;
      const actorKind = getString(elem, "actorKind") as LeaderboardSpec["actorKind"] | undefined;
      const cause = getString(elem, "cause");

      if (!title || !description || !resource || !aggregation || !direction || !actorKind) {
        console.warn(`Leaderboard "${id}" missing required fields — skipped`);
        continue;
      }

      specs.push({
        id,
        title,
        description,
        resource,
        aggregation,
        direction,
        actorKind,
        ...(cause !== undefined ? { cause } : {}),
      });
    }
  }

  return specs;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse LeaderboardSpec nodes from a Gram text string.
 * Looks for a `[lb:Leaderboards | (id:Leaderboard { ... }), ...]` block.
 * Returns an empty array when no block is present or on parse error.
 * Skips invalid nodes with a warning rather than failing hard.
 */
export function parseLeaderboardGramText(text: string): Promise<LeaderboardSpec[]> {
  return Effect.runPromise(
    Effect.match(Gram.parse(text), {
      onFailure: (e) => {
        console.warn(`parseLeaderboardGramText: parse error — ${String(e)}`);
        return [] as LeaderboardSpec[];
      },
      onSuccess: (patterns) => extractSpecs(patterns),
    }),
  );
}
