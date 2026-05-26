/**
 * Per-table session state (RFC-0019 Barnacle Protocol — phase 5b.2a).
 *
 * In the target architecture, one `rdc-poker-session` process represents
 * one poker table. Seated players arrive via `BarnacleHandoff` from
 * ghost-house's supervisor and leave via `BarnacleComplete` (when their
 * reflection brain decides "leave", or when they bust out, etc.).
 *
 * This file holds the in-memory model; the auto-loop that consumes it
 * (deal hand → settle → process leavers → repeat) lands in phase 5b.2b.
 * For 5b.2a, we expose the surface so handoffs can seat players and
 * the supervisor's complete-flow can release them.
 */
import type { PersonalityState } from "@aie-matrix/ghost-peppers-inner";

import type { AnimalType } from "./hellmuth-profile.js";
import type { MathSchool } from "./math-schools.js";

/** Per-seated-player runtime state — the session's in-game model of one ghost. */
export interface TableSeat {
  readonly ghostId: string;
  readonly displayName: string;
  readonly role: "outlaw" | "marshall";
  /** Personality snapshot from the Barnacle handoff bundle. The session
   *  derives persona / animal type / math school from this — drift
   *  during play is not propagated back to peppers (RFC-0019 non-goal). */
  readonly initialPersonality: PersonalityState;
  /** Current slider profile — may drift via reflection between hands. */
  personality: PersonalityState;
  /** Math school assigned at seating (RFC-0018), sticky for the session. */
  readonly mathSchool: MathSchool;
  /** Hellmuth animal type assigned per-table. Reassigned on reflection. */
  animalType?: AnimalType;
  /** Cached opponent reads from prior hands at this table — keyed by opponent ghostId. */
  readonly opponentReads: Map<string, string[]>;
  /** Supervisor's session id for this player — needed to send BarnacleComplete. */
  readonly barnacleSessionId: string;
  /** Where to POST BarnacleComplete. */
  readonly supervisorA2A: string;
  /** Wall-clock when seated (debug / metrics). */
  readonly seatedAtMs: number;
  /**
   * Chips in front of the player AT THE TABLE. Mutable across hands —
   * the buy-in deposits the starting stack here, hands credit/debit
   * it via the engine's final chipStack, and bust-out triggers when
   * this drops below the big blind. Cashed out to the Cyphers ledger on
   * release. This is what spectators watch grow and shrink — keeping
   * it per-hand-reset (as the original design did) destroyed the
   * spectator drama of "Frank's short, he has to gamble."
   */
  chipStack: number;

  /**
   * Sliding window of this seat's recent hand outcomes at this
   * table — last RECENT_OUTCOMES_WINDOW entries (see session-loop).
   * Fed into the tilt detector after every hand.
   */
  recentOutcomes: ("win" | "loss")[];

  /**
   * True while this seat is in a tilted state. The tilt detector
   * flips them in after a losing streak / chip stress and out after
   * a recovery (hysteresis: enter at higher pressure than exit).
   * While true, the decision pipeline rolls per turn against
   * persona.tiltSusceptibility — on a hit, the candidate generator
   * uses a one-step-worse tier, producing the "poor decisions x%
   * of the time" mechanic.
   */
  isTilted: boolean;
}

/** Static per-process table configuration — set once at session start. */
export interface TableConfig {
  /** Stable id for the table; usually `<class>:<h3>` (e.g. PokerTable:8f...cb0). */
  readonly platformId: string;
  readonly platformClass: string;
  readonly capacity: number;
  readonly minPlayers: number;
  readonly buyIn: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** Free-text setting for narrative flavour. */
  readonly setting: string;
}

/**
 * Per-process active table. One instance per session process. Holds
 * the seat roster + the auto-loop status. Mutations are synchronous
 * and from a single event loop, so no locking is needed.
 */
export class ActiveTable {
  private readonly seats = new Map<string, TableSeat>();
  /**
   * Cooldown registry — ghostId → wall-clock ms when they're allowed
   * back. Populated by `release()` and consulted by the executor's
   * handoff handler so a busted-out ghost can't immediately re-sit.
   * "There are other ghosts who want to play."
   */
  private readonly cooldownUntilMs = new Map<string, number>();
  /** Set true while the auto-loop is actively driving a hand; stops
   *  re-entry from a second seat arriving mid-hand. */
  running = false;

  constructor(public readonly config: TableConfig) {}

  hasSeat(ghostId: string): boolean {
    return this.seats.has(ghostId);
  }

  getSeat(ghostId: string): TableSeat | undefined {
    return this.seats.get(ghostId);
  }

  /** Try to seat a new player. Returns "seated" on success, "full" if
   *  capacity is reached, "already-here" if the same ghost was already
   *  in. RFC-0019 forbids waiting lists — full means full. */
  seat(seat: TableSeat): "seated" | "full" | "already-here" {
    if (this.seats.has(seat.ghostId)) return "already-here";
    if (this.seats.size >= this.config.capacity) return "full";
    this.seats.set(seat.ghostId, seat);
    return "seated";
  }

  release(ghostId: string): TableSeat | undefined {
    const seat = this.seats.get(ghostId);
    if (!seat) return undefined;
    this.seats.delete(ghostId);
    return seat;
  }

  list(): ReadonlyArray<TableSeat> {
    return [...this.seats.values()];
  }

  size(): number {
    return this.seats.size;
  }

  // ── cooldown registry ───────────────────────────────────────────────

  /**
   * Mark a ghost as on cooldown for the next `durationMs`. Called from
   * the session's `releasePlayer()` so a busted-out ghost can't
   * immediately re-buy-in and clog the seat — they have to wait, and
   * the next encounter offer from peppers gets rejected until then.
   */
  setCooldown(ghostId: string, durationMs: number): void {
    if (durationMs <= 0) {
      this.cooldownUntilMs.delete(ghostId);
      return;
    }
    this.cooldownUntilMs.set(ghostId, Date.now() + durationMs);
  }

  /**
   * Returns ms remaining in this ghost's cooldown, or 0 if they're
   * eligible to sit. Auto-prunes expired entries on read.
   */
  cooldownRemainingMs(ghostId: string): number {
    const until = this.cooldownUntilMs.get(ghostId);
    if (until === undefined) return 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      this.cooldownUntilMs.delete(ghostId);
      return 0;
    }
    return remaining;
  }
}
