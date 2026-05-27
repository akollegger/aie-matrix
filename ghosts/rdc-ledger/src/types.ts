/**
 * Shared types for the RDC ledger.
 *
 * Cyphers are the universal in-world currency of the saloon. Purely a
 * game token — no real-world analogue, no exchange path. Bounties are
 * placement records pinned to a target ghost; claiming a bounty
 * transfers the placer's escrowed Cyphers to the claimer.
 */

export interface LedgerSnapshot {
  /** Map of ghostId → current Cyphers balance. */
  readonly balances: Readonly<Record<string, number>>;
  readonly bounties: ReadonlyArray<Bounty>;
  /** Append-only ledger of every Cyphers-changing event (audit trail). */
  readonly events: ReadonlyArray<LedgerEvent>;
  /**
   * Per-ghost skill profile (RFC-0018). Lives next to the Cyphers
   * balance because both are long-term, persisted, ghost-scoped
   * attributes. Bounty-claim can transfer this profile from a target
   * to the claimer.
   */
  readonly skills?: Readonly<Record<string, SkillProfile>>;
}

/**
 * Skill tiers (RFC-0018 §"Tier definitions"). Promoted automatically as
 * `handsPlayed` crosses thresholds. The `Eagle` tier can also be reached
 * by claiming a bounty on a higher-tier ghost (bounty-skill-transfer).
 */
export type SkillTier = "Greenhorn" | "Journeyman" | "Veteran" | "Eagle";

export interface SkillProfile {
  /** Total hands this ghost has played at any RDC poker table. */
  readonly handsPlayed: number;
  readonly tier: SkillTier;
  /**
   * Math school identifier (RFC-0018). Set by the orchestrator after the
   * agent reports it on encounter-accept. The ledger doesn't validate
   * the string; the rdc-agent enum is the source of truth.
   */
  readonly school?: string;
}

export interface Bounty {
  readonly id: string;
  /** Ghost the bounty is on. */
  readonly targetGhostId: string;
  /** Ghost who placed the bounty. */
  readonly placerId: string;
  /** Cyphers held in escrow until claimed or revoked. */
  readonly amount: number;
  /** Free-text reason — defaults to "wanted" if none given. */
  readonly reason: string;
  readonly placedAtIso: string;
  /** Set when a hunter claims the bounty. */
  readonly claimedBy?: string;
  readonly claimedAtIso?: string;
  readonly status: "open" | "claimed" | "revoked";
}

export type LedgerEvent =
  | {
      readonly kind: "credit";
      readonly ghostId: string;
      readonly amount: number;
      readonly reason: string;
      readonly atIso: string;
    }
  | {
      readonly kind: "debit";
      readonly ghostId: string;
      readonly amount: number;
      readonly reason: string;
      readonly atIso: string;
    }
  | {
      readonly kind: "transfer";
      readonly fromGhostId: string;
      readonly toGhostId: string;
      readonly amount: number;
      readonly reason: string;
      readonly atIso: string;
    }
  | {
      readonly kind: "bounty-placed";
      readonly bountyId: string;
      readonly targetGhostId: string;
      readonly placerId: string;
      readonly amount: number;
      readonly reason: string;
      readonly atIso: string;
    }
  | {
      readonly kind: "bounty-claimed";
      readonly bountyId: string;
      readonly claimerId: string;
      readonly amount: number;
      readonly atIso: string;
    }
  | {
      readonly kind: "bounty-revoked";
      readonly bountyId: string;
      readonly atIso: string;
    };

export type LedgerError =
  | { readonly code: "INSUFFICIENT_FUNDS"; readonly available: number; readonly required: number }
  | { readonly code: "BOUNTY_NOT_FOUND" }
  | { readonly code: "BOUNTY_NOT_OPEN" }
  | { readonly code: "BOUNTY_SELF_CLAIM" }
  | { readonly code: "INVALID_AMOUNT"; readonly reason: string };

export type LedgerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LedgerError };
