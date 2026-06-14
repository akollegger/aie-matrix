/**
 * BarnacleSupervisor — RFC-0019 mini-game lifecycle manager.
 *
 * Drives the handoff sequence (withdraw → pause → handoff), polls
 * heartbeats, detects crashes, processes `BarnacleComplete` from
 * mini-games, and respawns + resumes peppers on session-end.
 *
 * v1 — not yet wired to any encounter-trigger source. Phase 5b connects
 * a Colyseus subscriber inside ghost-house to drive `beginSession`
 * calls. For now, the service exists and is callable programmatically.
 */
import { Context, Effect, Layer } from "effect";
import { ulid } from "ulid";
import { logger } from "@aie-matrix/logger";

import { CatalogService } from "../catalog/CatalogService.js";

import {
  BARNACLE_HANDOFF_SCHEMA,
  BARNACLE_HEARTBEAT_SCHEMA,
  PEPPERS_PAUSE_SCHEMA,
  PEPPERS_RESUME_SCHEMA,
  type BarnacleComplete,
  type BarnacleHandoff,
  type BarnacleHandoffAck,
  type BarnacleHeartbeat,
} from "@aie-matrix/shared-types";

import type { ICatalogService } from "../catalog/CatalogService.js";
import { getBarnacleA2AClient, sendDataAndAwaitReply } from "./a2a-client.js";
import type {
  BarnacleSessionRecord,
  BeginBarnacleSessionInput,
  BeginSessionResult,
} from "./types.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h
const MAX_CONSECUTIVE_MISSED_HEARTBEATS = 3;
const HANDOFF_TIMEOUT_MS = 15_000;
const PEPPERS_PAUSE_TIMEOUT_MS = 10_000;
const PEPPERS_RESUME_TIMEOUT_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;

function slog(kind: string, fields: Record<string, unknown>): void {
  logger.info({ kind, ...fields } as Parameters<typeof logger.info>[0]);
}

function swarn(kind: string, fields: Record<string, unknown>): void {
  logger.warn({ kind, ...fields } as Parameters<typeof logger.warn>[0]);
}

export interface IBarnacleSupervisor {
  /**
   * Drive the full handoff sequence. Caller (the encounter trigger —
   * Colyseus subscriber in phase 5b) supplies the bundle; supervisor
   * does: withdraw ghost from world → pause peppers → handoff to
   * mini-game. On success, begins heartbeat polling.
   *
   * Failures at any step revert as much as possible: a failed pause
   * after a successful withdraw will re-place the ghost; a failed
   * handoff will resume peppers; etc. Either the session is fully
   * begun (returns ok) or the world is left unchanged (returns reason).
   */
  readonly beginSession: (
    input: BeginBarnacleSessionInput,
  ) => Effect.Effect<BeginSessionResult>;

  /**
   * Process an incoming `BarnacleComplete` from a mini-game.
   * Idempotent — repeated complete for the same session is a no-op.
   * Calls registry /respawn, sends peppers.resume.v1, forgets session.
   */
  readonly onCompleteReceived: (complete: BarnacleComplete) => Effect.Effect<void>;

  /** Snapshot of active sessions (inspection / tests / observability). */
  readonly listActiveSessions: () => ReadonlyArray<BarnacleSessionRecord>;

  /** Single session lookup. */
  readonly getSession: (sessionId: string) => BarnacleSessionRecord | undefined;

  /**
   * Stop the heartbeat poller. Used in shutdown / tests.
   */
  readonly stop: () => void;
}

export class BarnacleSupervisor extends Context.Tag(
  "ghost-house/BarnacleSupervisor",
)<BarnacleSupervisor, IBarnacleSupervisor>() {}

export interface BarnacleSupervisorDeps {
  /** Catalog — used to find the mini-game registered for a platform class. */
  readonly catalog: ICatalogService;
  /** Registry base URL — POSTed to for /withdraw and /respawn. */
  readonly registryBaseUrl: string;
  /** Auth token for inter-service A2A calls (matches AGENT_HOST_TOKEN). */
  readonly devToken: string;
  /** Public A2A URL the supervisor advertises in handoffs so mini-games
   *  know where to POST BarnacleComplete. */
  readonly publicSupervisorA2A: string;
}

export function makeBarnacleSupervisor(deps: BarnacleSupervisorDeps): IBarnacleSupervisor {
  const sessions = new Map<string, BarnacleSessionRecord>();
  /** ghostId → sessionId — only one mini-game session per ghost at a time. */
  const ghostIndex = new Map<string, string>();
  let pollTimer: NodeJS.Timeout | null = null;

  async function withdrawGhost(ghostId: string): Promise<void> {
    const url = `${deps.registryBaseUrl.replace(/\/$/, "")}/registry/ghosts/${encodeURIComponent(ghostId)}/withdraw`;
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) {
      throw new Error(`withdraw ${ghostId}: HTTP ${r.status}`);
    }
  }

  async function respawnGhost(ghostId: string): Promise<void> {
    const url = `${deps.registryBaseUrl.replace(/\/$/, "")}/registry/ghosts/${encodeURIComponent(ghostId)}/respawn`;
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) {
      throw new Error(`respawn ${ghostId}: HTTP ${r.status}`);
    }
  }

  async function sendPause(peppersBaseUrl: string, ghostId: string, reason: string): Promise<void> {
    const client = await getBarnacleA2AClient(peppersBaseUrl, deps.devToken);
    await sendDataAndAwaitReply(
      client,
      { schema: PEPPERS_PAUSE_SCHEMA, ghostId, reason },
      { timeoutMs: PEPPERS_PAUSE_TIMEOUT_MS },
    );
  }

  async function sendResume(
    peppersBaseUrl: string,
    ghostId: string,
    narrative?: string,
  ): Promise<void> {
    const client = await getBarnacleA2AClient(peppersBaseUrl, deps.devToken);
    await sendDataAndAwaitReply(
      client,
      narrative
        ? { schema: PEPPERS_RESUME_SCHEMA, ghostId, narrative }
        : { schema: PEPPERS_RESUME_SCHEMA, ghostId },
      { timeoutMs: PEPPERS_RESUME_TIMEOUT_MS },
    );
  }

  async function sendHandoff(
    miniGameBaseUrl: string,
    payload: BarnacleHandoff,
  ): Promise<BarnacleHandoffAck | null> {
    const client = await getBarnacleA2AClient(miniGameBaseUrl, deps.devToken);
    const reply = await sendDataAndAwaitReply(
      client,
      payload as unknown as Record<string, unknown>,
      { timeoutMs: HANDOFF_TIMEOUT_MS },
    );
    return reply as BarnacleHandoffAck | null;
  }

  async function sendHeartbeat(session: BarnacleSessionRecord): Promise<boolean> {
    try {
      const client = await getBarnacleA2AClient(session.miniGameBaseUrl, deps.devToken);
      const body: BarnacleHeartbeat = {
        schema: BARNACLE_HEARTBEAT_SCHEMA,
        sessionId: session.sessionId,
      };
      const reply = await sendDataAndAwaitReply(
        client,
        body as unknown as Record<string, unknown>,
        { timeoutMs: HEARTBEAT_TIMEOUT_MS },
      );
      return (reply?.status as string | undefined) === "alive";
    } catch {
      return false;
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
    pollTimer.unref?.();
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce(): Promise<void> {
    const now = Date.now();
    for (const session of [...sessions.values()]) {
      if (session.terminating) continue;
      // Hard timeout — supervisor force-evicts regardless of heartbeat.
      if (now - session.startedAtMs > session.hardTimeoutMs) {
        swarn("barnacle.hard-timeout", {
          sessionId: session.sessionId,
          ghostId: session.ghostId,
          ageMs: now - session.startedAtMs,
        });
        void terminateSession(session, undefined, "hard-timeout");
        continue;
      }
      // Skip if it's not yet time for the next heartbeat.
      if (now - session.lastHeartbeatAtMs < session.heartbeatIntervalMs) continue;
      const ok = await sendHeartbeat(session);
      if (ok) {
        session.lastHeartbeatAtMs = now;
        session.consecutiveMissedHeartbeats = 0;
      } else {
        session.consecutiveMissedHeartbeats += 1;
        swarn("barnacle.heartbeat-miss", {
          sessionId: session.sessionId,
          ghostId: session.ghostId,
          consecutive: session.consecutiveMissedHeartbeats,
        });
        if (
          session.consecutiveMissedHeartbeats >= MAX_CONSECUTIVE_MISSED_HEARTBEATS
        ) {
          void terminateSession(session, undefined, "heartbeat-crash");
        }
      }
    }
  }

  async function terminateSession(
    session: BarnacleSessionRecord,
    narrative: string | undefined,
    reason: "graceful" | "heartbeat-crash" | "hard-timeout",
  ): Promise<void> {
    if (session.terminating) return;
    session.terminating = true;
    slog("barnacle.terminate", {
      sessionId: session.sessionId,
      ghostId: session.ghostId,
      reason,
    });
    // Respawn first so the ghost is back in the world before peppers
    // wakes up and asks `whereami`.
    try {
      await respawnGhost(session.ghostId);
    } catch (err) {
      swarn("barnacle.respawn-failed", {
        ghostId: session.ghostId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await sendResume(
        session.peppersBaseUrl,
        session.ghostId,
        reason === "graceful" ? narrative : undefined,
      );
    } catch (err) {
      swarn("barnacle.resume-failed", {
        ghostId: session.ghostId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    sessions.delete(session.sessionId);
    ghostIndex.delete(session.ghostId);
  }

  return {
    beginSession: (input) =>
      Effect.tryPromise({
        try: async (): Promise<BeginSessionResult> => {
          // Find the mini-game responsible for this platform class.
          const miniGame = await Effect.runPromise(
            deps.catalog.findMiniGameForPlatformClass(input.platformClass),
          );
          if (!miniGame) {
            return {
              ok: false,
              reason: { kind: "no-mini-game-for-class", platformClass: input.platformClass },
            };
          }

          // 1. Withdraw the ghost from the world.
          try {
            await withdrawGhost(input.ghostId);
          } catch (err) {
            return {
              ok: false,
              reason: {
                kind: "withdraw-failed",
                message: err instanceof Error ? err.message : String(err),
              },
            };
          }

          // 2. Pause peppers.
          try {
            await sendPause(
              input.peppersBaseUrl,
              input.ghostId,
              `barnacle-handoff:${input.platformClass}`,
            );
          } catch (err) {
            // Revert withdraw — put ghost back.
            await respawnGhost(input.ghostId).catch(() => undefined);
            return {
              ok: false,
              reason: {
                kind: "pause-failed",
                message: err instanceof Error ? err.message : String(err),
              },
            };
          }

          // 3. Handoff to the mini-game.
          const sessionId = ulid();
          const handoff: BarnacleHandoff = {
            schema: BARNACLE_HANDOFF_SCHEMA,
            sessionId,
            ghostId: input.ghostId,
            displayName: input.displayName,
            ...(input.role !== undefined ? { role: input.role } : {}),
            personality: input.personality,
            worldCredential: input.worldCredential,
            spawnCell: input.spawnCell,
            platformId: input.platformId,
            platformClass: input.platformClass,
            hostEndpoints: {
              supervisorA2A: deps.publicSupervisorA2A,
            },
          };
          let ack: BarnacleHandoffAck | null;
          try {
            ack = await sendHandoff(miniGame.baseUrl, handoff);
          } catch (err) {
            // Revert pause + withdraw — back to where we were.
            await sendResume(input.peppersBaseUrl, input.ghostId).catch(() => undefined);
            await respawnGhost(input.ghostId).catch(() => undefined);
            return {
              ok: false,
              reason: {
                kind: "handoff-network-error",
                message: err instanceof Error ? err.message : String(err),
              },
            };
          }
          if (!ack || ack.accepted !== true) {
            await sendResume(input.peppersBaseUrl, input.ghostId).catch(() => undefined);
            await respawnGhost(input.ghostId).catch(() => undefined);
            return {
              ok: false,
              reason: { kind: "handoff-rejected" },
            };
          }

          // 4. Track the session, start heartbeat polling.
          const now = Date.now();
          const record: BarnacleSessionRecord = {
            sessionId,
            ghostId: input.ghostId,
            displayName: input.displayName,
            platformId: input.platformId,
            platformClass: input.platformClass,
            miniGameBaseUrl: miniGame.baseUrl,
            peppersBaseUrl: input.peppersBaseUrl,
            spawnCell: input.spawnCell,
            heartbeatIntervalMs:
              typeof ack.heartbeatIntervalMs === "number" &&
              ack.heartbeatIntervalMs >= 1000 &&
              ack.heartbeatIntervalMs <= 60_000
                ? ack.heartbeatIntervalMs
                : DEFAULT_HEARTBEAT_INTERVAL_MS,
            hardTimeoutMs:
              typeof ack.hardTimeoutMs === "number" &&
              ack.hardTimeoutMs > 0 &&
              ack.hardTimeoutMs < DEFAULT_HARD_TIMEOUT_MS
                ? ack.hardTimeoutMs
                : (miniGame.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS),
            startedAtMs: now,
            lastHeartbeatAtMs: now,
            consecutiveMissedHeartbeats: 0,
            terminating: false,
          };
          sessions.set(sessionId, record);
          ghostIndex.set(input.ghostId, sessionId);
          startPolling();
          slog("barnacle.session-began", {
            sessionId,
            ghostId: input.ghostId,
            platformClass: input.platformClass,
            miniGameBaseUrl: miniGame.baseUrl,
          });
          return { ok: true, session: record };
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }).pipe(Effect.orDie),

    onCompleteReceived: (complete) =>
      Effect.tryPromise({
        try: async () => {
          const session = sessions.get(complete.sessionId);
          if (!session) {
            // Unknown session — log and ignore (mini-game retried? supervisor restarted?).
            swarn("barnacle.complete-for-unknown-session", {
              sessionId: complete.sessionId,
              ghostId: complete.ghostId,
            });
            return;
          }
          if (session.ghostId !== complete.ghostId) {
            swarn("barnacle.complete-ghost-mismatch", {
              sessionId: complete.sessionId,
              expectedGhostId: session.ghostId,
              receivedGhostId: complete.ghostId,
            });
            return;
          }
          await terminateSession(session, complete.narrative, "graceful");
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }).pipe(Effect.orDie),

    listActiveSessions: () => Array.from(sessions.values()),
    getSession: (sessionId) => sessions.get(sessionId),
    stop: () => stopPolling(),
  };
}

/**
 * Layer that wires the supervisor against the live `CatalogService`.
 * Config values (registry URL, dev token, public A2A) are passed in
 * — they come from process env / known startup state.
 */
export const BarnacleSupervisorLayer = (opts: {
  readonly registryBaseUrl: string;
  readonly devToken: string;
  readonly publicSupervisorA2A: string;
}): Layer.Layer<BarnacleSupervisor, never, CatalogService> =>
  Layer.effect(
    BarnacleSupervisor,
    Effect.gen(function* () {
      const catalog = yield* CatalogService;
      return makeBarnacleSupervisor({
        catalog,
        registryBaseUrl: opts.registryBaseUrl,
        devToken: opts.devToken,
        publicSupervisorA2A: opts.publicSupervisorA2A,
      });
    }),
  );
