/**
 * RFC-0019 — Barnacle Protocol message schemas.
 *
 * The contract by which mini-game processes attach to the host world.
 * Supervisor (ghost-house) ↔ mini-game (e.g. rdc-poker-agent) speak
 * these schemas exclusively. Peppers's pause/resume/encounter schemas
 * live in `@aie-matrix/ghost-peppers-agent`'s `spawn-types.ts`; this
 * file covers the mini-game side of the contract.
 */

/**
 * Personality shape used in the handoff bundle. Structurally compatible
 * with `@aie-matrix/ghost-peppers-inner`'s `PersonalityState` — declared
 * here so `shared-types` doesn't take a ghost-package dependency.
 * Consumers that import the real `PersonalityState` can cast.
 */
export type BarnaclePersonalitySnapshot = Readonly<
  Record<string, { readonly internal: number; readonly external: number }>
>;

// ── Catalog ─────────────────────────────────────────────────────────

/**
 * Mini-game catalog entry — registered with ghost-house so the
 * supervisor knows which mini-game to hand off to when a ghost accepts
 * an encounter on a particular `platformClass`.
 */
export interface BarnacleCatalogEntry {
  readonly kind: "mini-game";
  readonly agentId: string; // e.g. "rdc-poker"
  readonly baseUrl: string; // A2A endpoint of the mini-game process
  /** World-item classes this mini-game handles, e.g. ["PokerTable"]. */
  readonly platformClasses: ReadonlyArray<string>;
  /** Optional override of the supervisor's default hard timeout (ms). */
  readonly hardTimeoutMs?: number;
}

// ── Handoff: supervisor → mini-game ─────────────────────────────────

export const BARNACLE_HANDOFF_SCHEMA = "aie-matrix.barnacle.handoff.v1";

export interface BarnacleHandoff {
  readonly schema: typeof BARNACLE_HANDOFF_SCHEMA;
  /** Unique per encounter. The mini-game uses this to track its session. */
  readonly sessionId: string;
  readonly ghostId: string;
  readonly displayName: string;
  /** Game-agnostic role hint; optional. */
  readonly role?: string;
  /** Snapshot of the social ghost's slider profile at handoff time. */
  readonly personality: BarnaclePersonalitySnapshot;
  /** Auth + endpoint for shared world services (ledger, world-MCP). */
  readonly worldCredential: {
    readonly token: string;
    readonly worldApiBaseUrl: string;
  };
  /** H3 cell to teleport the ghost back to on session-end. */
  readonly spawnCell: string;
  /** Platform instance the ghost engaged. */
  readonly platformId: string;
  /** Platform class (matches one of the mini-game's catalog `platformClasses`). */
  readonly platformClass: string;
  /** Host endpoints the mini-game uses to report back. */
  readonly hostEndpoints: {
    /** A2A base for posting heartbeat + complete (supervisor's address). */
    readonly supervisorA2A: string;
  };
}

export interface BarnacleHandoffAck {
  readonly schema: typeof BARNACLE_HANDOFF_SCHEMA;
  readonly sessionId: string;
  /** False → supervisor immediately reverts the handoff (re-place ghost in world, resume peppers). */
  readonly accepted: boolean;
  /**
   * Mini-game's preferred heartbeat cadence. Supervisor will honour this
   * within sane bounds (>=1s, <=60s). Default 30000.
   */
  readonly heartbeatIntervalMs?: number;
  /**
   * Self-declared maximum session length. Supervisor caps at its own
   * configured hard timeout regardless (default 2h).
   */
  readonly hardTimeoutMs?: number;
}

// ── Heartbeat: supervisor → mini-game ───────────────────────────────

export const BARNACLE_HEARTBEAT_SCHEMA = "aie-matrix.barnacle.heartbeat.v1";

export interface BarnacleHeartbeat {
  readonly schema: typeof BARNACLE_HEARTBEAT_SCHEMA;
  readonly sessionId: string;
}

export interface BarnacleHeartbeatAck {
  readonly schema: typeof BARNACLE_HEARTBEAT_SCHEMA;
  readonly sessionId: string;
  readonly status: "alive";
}

// ── Peppers ↔ supervisor schemas ────────────────────────────────────
// These live here (not in peppers-agent) so ghost-house's Barnacle
// supervisor can speak them without taking a dep on a ghost-package.
// Peppers re-exports them for its own consumers' convenience.

/** Supervisor → peppers: halt the social cascade. Idempotent. */
export const PEPPERS_PAUSE_SCHEMA = "aie-matrix.peppers.pause.v1";
export interface PeppersPause {
  readonly schema: typeof PEPPERS_PAUSE_SCHEMA;
  readonly ghostId: string;
  /** Free-text reason for the pause — for logs only. */
  readonly reason?: string;
}

/** Supervisor → peppers: restart the social cascade, optionally with
 *  a narrative summary of what just happened in the mini-game session. */
export const PEPPERS_RESUME_SCHEMA = "aie-matrix.peppers.resume.v1";
export interface PeppersResume {
  readonly schema: typeof PEPPERS_RESUME_SCHEMA;
  readonly ghostId: string;
  readonly narrative?: string;
}

/** Supervisor → peppers: "you see a mini-game venue near you; want to
 *  engage?" Game-agnostic — `platformClass` + `hints` carry the
 *  specifics. Peppers's encounter brain decides accept/decline. */
export const PLATFORM_ENCOUNTER_SCHEMA = "aie-matrix.platform.encounter.v1";
export interface PlatformEncounter {
  readonly schema: typeof PLATFORM_ENCOUNTER_SCHEMA;
  readonly platformId: string;
  readonly ghostId: string;
  readonly platformClass: string;
  readonly seatsOpen: number;
  readonly seatsTotal: number;
  readonly seatedNames: ReadonlyArray<string>;
  readonly setting: string;
  readonly barker?: string;
  readonly hints?: Readonly<Record<string, string | number>>;
}

export interface PlatformEncounterReply {
  readonly schema: typeof PLATFORM_ENCOUNTER_SCHEMA;
  readonly platformId: string;
  readonly ghostId: string;
  readonly accept: boolean;
  readonly reasoning: string;
  /**
   * Slider snapshot at the moment of accept — supervisor uses this to
   * build the Barnacle handoff bundle for the mini-game. Only present
   * on `accept: true`; declines omit it.
   */
  readonly personality?: BarnaclePersonalitySnapshot;
}

// ── Complete: mini-game → supervisor ────────────────────────────────

export const BARNACLE_COMPLETE_SCHEMA = "aie-matrix.barnacle.complete.v1";

export interface BarnacleComplete {
  readonly schema: typeof BARNACLE_COMPLETE_SCHEMA;
  readonly sessionId: string;
  readonly ghostId: string;
  /** One-line summary handed back to peppers as resume narrative. */
  readonly narrative?: string;
  readonly lastEventIso: string;
}

export interface BarnacleCompleteAck {
  readonly schema: typeof BARNACLE_COMPLETE_SCHEMA;
  readonly sessionId: string;
  /** True if the supervisor accepted the completion and will respawn + resume. */
  readonly accepted: boolean;
}
