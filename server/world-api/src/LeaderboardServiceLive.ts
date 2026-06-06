import { Effect, Layer } from "effect";
import type { Driver } from "neo4j-driver";
import type { LeaderboardEntry, LeaderboardResult, LeaderboardSpec } from "@aie-matrix/shared-types";
import { LeaderboardNotFound, LeaderboardPersistenceError } from "./leaderboard-errors.js";
import { LeaderboardService, type LeaderboardServiceOps } from "./LeaderboardService.js";
import { WorldBridgeService } from "./WorldBridgeService.js";

// ---------------------------------------------------------------------------
// Transfer shape from ledger entries
// ---------------------------------------------------------------------------

interface LedgerTransfer {
  resource: string;
  qty: number;
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function isGroup(actorId: string): boolean {
  return actorId.startsWith("group:");
}

function actorMatchesKind(actorId: string, kind: LeaderboardSpec["actorKind"]): boolean {
  if (kind === "any") return true;
  if (kind === "group") return isGroup(actorId);
  return !isGroup(actorId); // "ghost"
}

function computeScores(
  entries: Array<{ transfersJson: string | null; cause: string; ts: string | number }>,
  spec: LeaderboardSpec,
): Map<string, { score: number; lastTs: string }> {
  const scores = new Map<string, { score: number; lastTs: string }>();

  for (const entry of entries) {
    if (!entry.transfersJson) continue;

    let transfers: LedgerTransfer[];
    try {
      transfers = JSON.parse(entry.transfersJson) as LedgerTransfer[];
    } catch {
      continue;
    }

    // cause filter
    if (spec.cause !== undefined && entry.cause !== spec.cause) continue;

    const tsStr = typeof entry.ts === "number"
      ? new Date(entry.ts).toISOString()
      : String(entry.ts);

    for (const t of transfers) {
      // resource filter
      if (spec.resource !== "*" && t.resource !== spec.resource) continue;

      const candidates: string[] = [];
      if (spec.direction === "received") {
        candidates.push(t.to);
      } else if (spec.direction === "distributed") {
        candidates.push(t.from);
      } else {
        // net: both actors may accumulate on different sides
        candidates.push(t.to);
        candidates.push(t.from);
      }

      for (const actor of candidates) {
        if (!actorMatchesKind(actor, spec.actorKind)) continue;

        let delta = 0;
        if (spec.direction === "received") {
          delta = spec.aggregation === "count" ? 1 : t.qty;
        } else if (spec.direction === "distributed") {
          delta = spec.aggregation === "count" ? 1 : t.qty;
        } else {
          // net
          if (actor === t.to) {
            delta = spec.aggregation === "count" ? 1 : t.qty;
          } else {
            delta = spec.aggregation === "count" ? -1 : -t.qty;
          }
        }

        const existing = scores.get(actor);
        if (!existing) {
          scores.set(actor, { score: delta, lastTs: tsStr });
        } else {
          const newScore =
            spec.aggregation === "max"
              ? Math.max(existing.score, delta)
              : existing.score + delta;
          const newTs =
            tsStr > existing.lastTs ? tsStr : existing.lastTs;
          scores.set(actor, { score: newScore, lastTs: newTs });
        }
      }
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Neo4j-backed implementation
// ---------------------------------------------------------------------------

function makeLeaderboardServiceLive(
  driver: Driver,
  bridge: WorldBridgeService["Type"],
): LeaderboardServiceOps {
  const ttlMs = Number(process.env.LEADERBOARD_TTL_MS ?? "60000");
  const specs = new Map<string, LeaderboardSpec>();
  const cache = new Map<string, { result: LeaderboardResult; computedAt: number }>();
  const finalSnapshots = new Map<string, LeaderboardResult>();
  let isFinal = false;

  // ── Helpers ──

  async function fetchActiveSessionId(): Promise<string | null> {
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (s:LiveSession { status: "active" }) RETURN s.id AS sessionId LIMIT 1`,
        ),
      );
      if (result.records.length === 0) return null;
      return result.records[0]!.get("sessionId") as string;
    } finally {
      await session.close();
    }
  }

  async function fetchLedgerEntries(
    sessionId: string,
  ): Promise<Array<{ transfersJson: string | null; cause: string; ts: string | number }>> {
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (s:LiveSession { id: $sessionId })-[:LEDGER_HEAD]->(head:LedgerEntry)
           MATCH (head)-[:NEXT_ENTRY*0..]->(e:LedgerEntry)
           RETURN e.transfers AS transfersJson, e.cause AS cause, e.ts AS ts`,
          { sessionId },
        ),
      );
      return result.records.map((r) => ({
        transfersJson: r.get("transfersJson") as string | null,
        cause: r.get("cause") as string,
        // Neo4j may return integers as neo4j.Integer objects — coerce to JS number
        ts: (r.get("ts") as any).toNumber?.() ?? Number(r.get("ts")),
      }));
    } finally {
      await session.close();
    }
  }

  async function fetchDisplayNames(actorIds: string[]): Promise<Map<string, string>> {
    if (actorIds.length === 0) return new Map();
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (g:Ghost) WHERE g.id IN $actorIds RETURN g.id AS id, g.instanceName AS instanceName`,
          { actorIds },
        ),
      );
      const names = new Map<string, string>();
      for (const r of result.records) {
        const id = r.get("id") as string;
        const name = r.get("instanceName") as string | null;
        if (name) names.set(id, name);
      }
      return names;
    } finally {
      await session.close();
    }
  }

  async function computeLeaderboardResult(spec: LeaderboardSpec): Promise<LeaderboardResult> {
    const sessionId = await fetchActiveSessionId();

    const entries: LeaderboardEntry[] = [];

    if (sessionId) {
      const ledgerEntries = await fetchLedgerEntries(sessionId);
      const scores = computeScores(ledgerEntries, spec);

      const actorIds = Array.from(scores.keys());
      const displayNames = await fetchDisplayNames(actorIds);

      for (const [actorId, { score, lastTs }] of scores) {
        entries.push({
          actorId,
          displayName: displayNames.get(actorId) ?? actorId,
          score,
          lastContributingAt: lastTs,
        });
      }
    }

    // Sort: higher score first; tie-break by lastContributingAt ascending
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.lastContributingAt.localeCompare(b.lastContributingAt);
    });

    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      entries,
      computedAt: new Date().toISOString(),
      isFinal,
    };
  }

  function emitLeaderboardUpdated(result: LeaderboardResult): void {
    try {
      bridge.fanoutWorldV1({
        t: "leaderboard.updated",
        leaderboardId: result.id,
        title: result.title,
        isFinal: result.isFinal,
        computedAt: result.computedAt,
        entries: result.entries.slice(0, 10), // top 10 for broadcast
      });
    } catch {
      // bridge may not be connected yet — ignore
    }
  }

  function rankingsChanged(prev: LeaderboardResult | undefined, next: LeaderboardResult): boolean {
    if (!prev) return next.entries.length > 0;
    if (prev.entries.length !== next.entries.length) return true;
    return prev.entries.some((e, i) => {
      const n = next.entries[i];
      return !n || e.actorId !== n.actorId || e.score !== n.score;
    });
  }

  // ── Service ops ──

  const ops: LeaderboardServiceOps = {
    init(newSpecs) {
      return Effect.sync(() => {
        specs.clear();
        cache.clear();
        finalSnapshots.clear();
        isFinal = false;
        for (const spec of newSpecs) {
          specs.set(spec.id, spec);
        }
      });
    },

    listLeaderboards() {
      return Effect.sync(() =>
        Array.from(specs.values()).map(({ id, title, description }) => ({
          id,
          title,
          description,
        })),
      );
    },

    getLeaderboard(id) {
      return Effect.gen(function* () {
        const spec = specs.get(id);
        if (!spec) {
          return yield* Effect.fail(new LeaderboardNotFound({ leaderboardId: id }));
        }

        // If finalized, return frozen snapshot
        if (isFinal) {
          const snap = finalSnapshots.get(id);
          if (!snap) {
            return yield* Effect.fail(new LeaderboardNotFound({ leaderboardId: id }));
          }
          return snap;
        }

        // Cache hit?
        const cached = cache.get(id);
        if (cached && Date.now() - cached.computedAt <= ttlMs) {
          return cached.result;
        }

        // Compute fresh — on failure, return stale cache or empty result (no error surfaced)
        const result: LeaderboardResult = yield* Effect.tryPromise({
          try: () => computeLeaderboardResult(spec),
          catch: (e) => new LeaderboardPersistenceError({ cause: String(e) }),
        }).pipe(
          Effect.catchAll((e) => {
            console.warn(`[LeaderboardService] Query failed for "${id}":`, e.cause);
            if (cached) return Effect.succeed(cached.result);
            return Effect.succeed({
              id: spec.id,
              title: spec.title,
              description: spec.description,
              entries: [],
              computedAt: new Date().toISOString(),
              isFinal: false,
            } satisfies LeaderboardResult);
          }),
        );

        const prev = cached?.result;
        cache.set(id, { result, computedAt: Date.now() });

        if (rankingsChanged(prev, result)) {
          emitLeaderboardUpdated(result);
        }

        return result;
      });
    },

    finalizeLeaderboards() {
      return Effect.gen(function* () {
        const allSpecs = Array.from(specs.values());

        // Fetch active session id once so snapshots are linked correctly
        const sessionId = yield* Effect.tryPromise({
          try: () => fetchActiveSessionId(),
          catch: (e) => new LeaderboardPersistenceError({ cause: String(e) }),
        });

        // Idempotent — if already finalized, no-op
        if (isFinal) return;

        // Compute all leaderboards
        const results = yield* Effect.tryPromise({
          try: async () => {
            const out: LeaderboardResult[] = [];
            for (const spec of allSpecs) {
              const result = await computeLeaderboardResult(spec);
              out.push(result);
            }
            return out;
          },
          catch: (e) => new LeaderboardPersistenceError({ cause: String(e) }),
        });

        // Mark final
        isFinal = true;

        // Persist snapshots to Neo4j
        yield* Effect.tryPromise({
          try: async () => {
            const session = driver.session();
            try {
              for (const result of results) {
                const snapshotId = sessionId
                  ? `${sessionId}:${result.id}`
                  : `orphan:${result.id}`;
                await session.executeWrite((tx) =>
                  tx.run(
                    `MERGE (snap:LeaderboardSnapshot { snapshotId: $snapshotId })
                     SET snap.sessionId = $sessionId,
                         snap.leaderboardId = $leaderboardId,
                         snap.computedAt = $computedAt,
                         snap.isFinal = true,
                         snap.entriesJson = $entriesJson
                     WITH snap
                     MATCH (s:LiveSession { id: $sessionId })
                     MERGE (snap)-[:SNAPSHOT_OF]->(s)`,
                    {
                      snapshotId,
                      sessionId,
                      leaderboardId: result.id,
                      computedAt: result.computedAt,
                      entriesJson: JSON.stringify(result.entries),
                    },
                  ),
                );
              }
            } finally {
              await session.close();
            }
          },
          catch: (e) => new LeaderboardPersistenceError({ cause: String(e) }),
        });

        // Store final snapshots in memory + emit events
        for (const result of results) {
          const finalResult: LeaderboardResult = { ...result, isFinal: true };
          finalSnapshots.set(result.id, finalResult);
          cache.set(result.id, { result: finalResult, computedAt: Date.now() });
          emitLeaderboardUpdated(finalResult);
        }
      });
    },
  };

  return ops;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export function makeLeaderboardServiceLiveLayer(
  driver: Driver,
): Layer.Layer<LeaderboardService, never, WorldBridgeService> {
  return Layer.effect(
    LeaderboardService,
    Effect.gen(function* () {
      const bridge = yield* WorldBridgeService;
      return makeLeaderboardServiceLive(driver, bridge);
    }),
  );
}
