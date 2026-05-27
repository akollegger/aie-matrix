/**
 * In-memory ledger with optional file-backed persistence.
 *
 * All mutations happen synchronously on a single in-memory snapshot, and
 * a queue serialises file writes so concurrent transfers can't tear the
 * on-disk JSON.
 *
 * For v1 this is enough — we expect single-orchestrator-process traffic.
 * If we ever shard the orchestrator, this becomes either Neo4j-backed or
 * gates behind a small key/value service.
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  Bounty,
  LedgerEvent,
  LedgerError,
  LedgerResult,
  LedgerSnapshot,
  SkillProfile,
  SkillTier,
} from "./types.js";

export interface LedgerOptions {
  /** Optional path for JSON persistence. Without it the ledger is RAM-only. */
  readonly persistPath?: string;
  /** Initial credit each ghost starts with on first balance lookup. */
  readonly startingBalance?: number;
}

const DEFAULT_STARTING = 500;

/** RFC-0018 promotion thresholds — `handsPlayed >=` boundary. */
const TIER_THRESHOLDS: ReadonlyArray<readonly [number, SkillTier]> = [
  [200, "Eagle"],
  [50, "Veteran"],
  [10, "Journeyman"],
  [0, "Greenhorn"],
];

function tierForHands(handsPlayed: number): SkillTier {
  for (const [floor, tier] of TIER_THRESHOLDS) {
    if (handsPlayed >= floor) return tier;
  }
  return "Greenhorn";
}

/** Strict ordering for `transferSkill` tier-max semantics. */
const TIER_RANK: Readonly<Record<SkillTier, number>> = {
  Greenhorn: 0,
  Journeyman: 1,
  Veteran: 2,
  Eagle: 3,
};

function nowIso(): string {
  return new Date().toISOString();
}

function ok<T>(value: T): LedgerResult<T> {
  return { ok: true, value };
}

function err(error: LedgerError): LedgerResult<never> {
  return { ok: false, error };
}

export class Ledger {
  private readonly persistPath: string | undefined;
  private readonly startingBalance: number;
  private balances: Map<string, number>;
  private bounties: Map<string, Bounty>;
  private events: LedgerEvent[];
  private skills: Map<string, SkillProfile>;
  private writeQueue: Promise<void>;

  constructor(opts: LedgerOptions = {}) {
    this.persistPath = opts.persistPath;
    this.startingBalance = opts.startingBalance ?? DEFAULT_STARTING;
    this.balances = new Map();
    this.bounties = new Map();
    this.events = [];
    this.skills = new Map();
    this.writeQueue = Promise.resolve();
  }

  /**
   * Restore ledger state from disk if a `persistPath` was set. Idempotent.
   */
  async load(): Promise<void> {
    if (!this.persistPath) return;
    let raw: string;
    try {
      raw = await fs.readFile(this.persistPath, "utf8");
    } catch (e) {
      // Missing file is fine — first run.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    const snap = JSON.parse(raw) as LedgerSnapshot;
    this.balances = new Map(Object.entries(snap.balances ?? {}));
    this.bounties = new Map(
      (snap.bounties ?? []).map((b) => [b.id, b] as const),
    );
    this.events = [...(snap.events ?? [])];
    this.skills = new Map(Object.entries(snap.skills ?? {}));
  }

  /** Take a structured snapshot — useful for inspection and overlay rendering. */
  snapshot(): LedgerSnapshot {
    return {
      balances: Object.fromEntries(this.balances.entries()),
      bounties: Array.from(this.bounties.values()),
      events: [...this.events],
      skills: Object.fromEntries(this.skills.entries()),
    };
  }

  // -------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------

  getBalance(ghostId: string): number {
    if (!this.balances.has(ghostId)) {
      this.balances.set(ghostId, this.startingBalance);
    }
    return this.balances.get(ghostId)!;
  }

  /** Mint credits to a ghost (e.g., pot award on hand resolution). */
  award(ghostId: string, amount: number, reason: string): LedgerResult<number> {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return err({
        code: "INVALID_AMOUNT",
        reason: `award amount must be positive; got ${amount}`,
      });
    }
    const next = this.getBalance(ghostId) + amount;
    this.balances.set(ghostId, next);
    this.recordEvent({
      kind: "credit",
      ghostId,
      amount,
      reason,
      atIso: nowIso(),
    });
    void this.persist();
    return ok(next);
  }

  /** Burn credits from a ghost (e.g., poker buy-in). Fails on insufficient funds. */
  debit(ghostId: string, amount: number, reason: string): LedgerResult<number> {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return err({
        code: "INVALID_AMOUNT",
        reason: `debit amount must be positive; got ${amount}`,
      });
    }
    const balance = this.getBalance(ghostId);
    if (balance < amount) {
      return err({
        code: "INSUFFICIENT_FUNDS",
        available: balance,
        required: amount,
      });
    }
    const next = balance - amount;
    this.balances.set(ghostId, next);
    this.recordEvent({
      kind: "debit",
      ghostId,
      amount,
      reason,
      atIso: nowIso(),
    });
    void this.persist();
    return ok(next);
  }

  /**
   * Atomic transfer between two ghosts. Either both balances move or
   * neither does.
   */
  transfer(
    fromGhostId: string,
    toGhostId: string,
    amount: number,
    reason: string,
  ): LedgerResult<{ fromBalance: number; toBalance: number }> {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return err({
        code: "INVALID_AMOUNT",
        reason: `transfer amount must be positive; got ${amount}`,
      });
    }
    const fromBalance = this.getBalance(fromGhostId);
    if (fromBalance < amount) {
      return err({
        code: "INSUFFICIENT_FUNDS",
        available: fromBalance,
        required: amount,
      });
    }
    const newFrom = fromBalance - amount;
    const newTo = this.getBalance(toGhostId) + amount;
    this.balances.set(fromGhostId, newFrom);
    this.balances.set(toGhostId, newTo);
    this.recordEvent({
      kind: "transfer",
      fromGhostId,
      toGhostId,
      amount,
      reason,
      atIso: nowIso(),
    });
    void this.persist();
    return ok({ fromBalance: newFrom, toBalance: newTo });
  }

  // -------------------------------------------------------------------
  // Bounties
  // -------------------------------------------------------------------

  /**
   * Place a bounty on a target ghost. The placer's `amount` is escrowed
   * (debited from their balance) and held by the bounty until claimed or
   * revoked.
   */
  placeBounty(
    placerId: string,
    targetGhostId: string,
    amount: number,
    reason = "wanted",
  ): LedgerResult<Bounty> {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return err({
        code: "INVALID_AMOUNT",
        reason: `bounty amount must be positive; got ${amount}`,
      });
    }
    const debited = this.debit(placerId, amount, `bounty escrow on ${targetGhostId}`);
    if (!debited.ok) return debited;
    const bounty: Bounty = {
      id: randomUUID(),
      targetGhostId,
      placerId,
      amount,
      reason,
      placedAtIso: nowIso(),
      status: "open",
    };
    this.bounties.set(bounty.id, bounty);
    this.recordEvent({
      kind: "bounty-placed",
      bountyId: bounty.id,
      targetGhostId,
      placerId,
      amount,
      reason,
      atIso: bounty.placedAtIso,
    });
    void this.persist();
    return ok(bounty);
  }

  /**
   * Claim an open bounty. Awards the escrowed amount to the claimer.
   * Self-claims (claimer === target) are rejected — the target can't
   * collect their own bounty.
   */
  claimBounty(bountyId: string, claimerId: string): LedgerResult<Bounty> {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) return err({ code: "BOUNTY_NOT_FOUND" });
    if (bounty.status !== "open") return err({ code: "BOUNTY_NOT_OPEN" });
    if (bounty.targetGhostId === claimerId) {
      return err({ code: "BOUNTY_SELF_CLAIM" });
    }

    const newBalance = this.getBalance(claimerId) + bounty.amount;
    this.balances.set(claimerId, newBalance);
    const claimedIso = nowIso();
    const updated: Bounty = {
      ...bounty,
      claimedBy: claimerId,
      claimedAtIso: claimedIso,
      status: "claimed",
    };
    this.bounties.set(bountyId, updated);
    this.recordEvent({
      kind: "bounty-claimed",
      bountyId,
      claimerId,
      amount: bounty.amount,
      atIso: claimedIso,
    });
    void this.persist();
    return ok(updated);
  }

  /** Revoke an open bounty — refunds escrow to the placer. */
  revokeBounty(bountyId: string): LedgerResult<Bounty> {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) return err({ code: "BOUNTY_NOT_FOUND" });
    if (bounty.status !== "open") return err({ code: "BOUNTY_NOT_OPEN" });

    const refunded = this.getBalance(bounty.placerId) + bounty.amount;
    this.balances.set(bounty.placerId, refunded);
    const updated: Bounty = { ...bounty, status: "revoked" };
    this.bounties.set(bountyId, updated);
    this.recordEvent({
      kind: "bounty-revoked",
      bountyId,
      atIso: nowIso(),
    });
    void this.persist();
    return ok(updated);
  }

  /** List open bounties, optionally filtered to one target. */
  listOpenBounties(targetGhostId?: string): Bounty[] {
    return Array.from(this.bounties.values()).filter(
      (b) =>
        b.status === "open" &&
        (targetGhostId === undefined || b.targetGhostId === targetGhostId),
    );
  }

  // -------------------------------------------------------------------
  // Skill profiles — RFC-0018
  // -------------------------------------------------------------------

  /**
   * Read a ghost's skill profile. Lazily initialised on first access
   * (Greenhorn, 0 hands, no school) — same idiom as `getBalance`.
   */
  getSkillProfile(ghostId: string): SkillProfile {
    const existing = this.skills.get(ghostId);
    if (existing) return existing;
    const fresh: SkillProfile = { handsPlayed: 0, tier: "Greenhorn" };
    this.skills.set(ghostId, fresh);
    return fresh;
  }

  /**
   * Increment the ghost's hand count by one and auto-promote tier if a
   * threshold is crossed. Returns the new profile plus whether the tier
   * changed (callers may want to broadcast a promotion event).
   */
  recordHandPlayed(ghostId: string): { profile: SkillProfile; promoted: boolean } {
    const prev = this.getSkillProfile(ghostId);
    const handsPlayed = prev.handsPlayed + 1;
    const tier = tierForHands(handsPlayed);
    const profile: SkillProfile = { ...prev, handsPlayed, tier };
    this.skills.set(ghostId, profile);
    void this.persist();
    return { profile, promoted: tier !== prev.tier };
  }

  /**
   * Commit the math school the agent assigned itself on first sit. Sticky:
   * once a school is recorded, calls with the same school are no-ops, and
   * calls with a different school are ignored (school is supposed to be
   * deterministic on starting personality).
   */
  setSkillSchool(ghostId: string, school: string): SkillProfile {
    const prev = this.getSkillProfile(ghostId);
    if (prev.school) return prev;
    const profile: SkillProfile = { ...prev, school };
    this.skills.set(ghostId, profile);
    void this.persist();
    return profile;
  }

  /**
   * Bounty-skill-transfer (RFC-0018). Copies the donor's skill onto the
   * recipient by taking the max along each dimension — never reduces the
   * recipient's existing standing. `mode: "max"` is the v1 default; other
   * modes (`replace`, `merge`) remain a future RFC question.
   */
  transferSkill(
    fromGhostId: string,
    toGhostId: string,
    mode: "max" = "max",
  ): SkillProfile {
    const from = this.getSkillProfile(fromGhostId);
    const to = this.getSkillProfile(toGhostId);
    if (mode !== "max") {
      throw new Error(`transferSkill mode '${mode}' not implemented`);
    }
    const handsPlayed = Math.max(from.handsPlayed, to.handsPlayed);
    const tier =
      TIER_RANK[from.tier] > TIER_RANK[to.tier] ? from.tier : to.tier;
    // School is sticky: don't overwrite a school the recipient already chose.
    const school = to.school ?? from.school;
    const merged: SkillProfile = { handsPlayed, tier, school };
    this.skills.set(toGhostId, merged);
    void this.persist();
    return merged;
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private recordEvent(e: LedgerEvent): void {
    this.events.push(e);
  }

  /**
   * File-write queue: every persistence call chains onto a single
   * Promise so two concurrent transfers don't interleave their JSON
   * writes. Reads happen from the in-memory state, never from disk.
   */
  private persist(): Promise<void> {
    if (!this.persistPath) return Promise.resolve();
    const path = this.persistPath;
    this.writeQueue = this.writeQueue
      .catch(() => {
        /* swallow prior errors so the queue keeps moving */
      })
      .then(async () => {
        await fs.mkdir(dirname(path), { recursive: true });
        const snap = this.snapshot();
        const tmp = `${path}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(snap, null, 2));
        await fs.rename(tmp, path);
      });
    return this.writeQueue;
  }
}
