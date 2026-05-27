/**
 * Internal types for the Barnacle supervisor (RFC-0019).
 */
import type { BarnaclePersonalitySnapshot } from "@aie-matrix/shared-types";

/** Per-active-session record the supervisor keeps in memory. */
export interface BarnacleSessionRecord {
  readonly sessionId: string;
  readonly ghostId: string;
  readonly displayName: string;
  readonly platformId: string;
  readonly platformClass: string;
  /** A2A base URL of the mini-game we handed off to. */
  readonly miniGameBaseUrl: string;
  /** A2A base URL of peppers — needed to send pause/resume. */
  readonly peppersBaseUrl: string;
  /** H3 cell the supervisor will respawn the ghost on at session-end. */
  readonly spawnCell: string;
  /** Heartbeat cadence the mini-game requested at handoff. Default 30s. */
  readonly heartbeatIntervalMs: number;
  /** Hard timeout — supervisor force-evicts after this. */
  readonly hardTimeoutMs: number;
  /** Wall-clock when the session began (for hard-timeout enforcement). */
  readonly startedAtMs: number;
  /** Wall-clock of the most recent successful heartbeat (for staleness checks). */
  lastHeartbeatAtMs: number;
  /** Consecutive heartbeat failures since the last success. */
  consecutiveMissedHeartbeats: number;
  /** Whether the supervisor has already begun teardown for this session
   *  (`complete` arrived or crash detected). Idempotency guard. */
  terminating: boolean;
}

/** Input to `beginSession` — what the encounter-trigger side hands
 *  the supervisor when peppers accepts. */
export interface BeginBarnacleSessionInput {
  readonly ghostId: string;
  readonly displayName: string;
  /** Optional game-agnostic role hint. */
  readonly role?: string;
  /** Snapshot of peppers's current sliders (for the handoff bundle). */
  readonly personality: BarnaclePersonalitySnapshot;
  /** Auth + endpoint the mini-game uses for ledger/memory writes. */
  readonly worldCredential: {
    readonly token: string;
    readonly worldApiBaseUrl: string;
  };
  /** Where the ghost should be respawned at session-end. */
  readonly spawnCell: string;
  /** The world-item that triggered the encounter (e.g. tile cell + class). */
  readonly platformId: string;
  readonly platformClass: string;
  /** A2A base of peppers for the pause/resume round-trip. */
  readonly peppersBaseUrl: string;
}

/** Outcomes of `beginSession` for telemetry / callers. */
export type BeginSessionResult =
  | { readonly ok: true; readonly session: BarnacleSessionRecord }
  | { readonly ok: false; readonly reason: BeginSessionFailure };

export type BeginSessionFailure =
  | { readonly kind: "no-mini-game-for-class"; readonly platformClass: string }
  | { readonly kind: "handoff-rejected"; readonly miniGameMessage?: string }
  | { readonly kind: "handoff-timeout" }
  | { readonly kind: "handoff-network-error"; readonly message: string }
  | { readonly kind: "withdraw-failed"; readonly message: string }
  | { readonly kind: "pause-failed"; readonly message: string };
