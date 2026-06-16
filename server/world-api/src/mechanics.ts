/**
 * Server-side game mechanics that commit ledger transactions on behalf of the world.
 *
 * These are the only authorised callers for monotonic resource minting — trust-by-call-site
 * per ADR-0011 and FR-007. External callers (ghosts, HTTP clients) cannot mint monotonic
 * resources; only Effect services that receive LedgerService via Layer injection can.
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import { LedgerService } from "./LedgerService.js";
import type { ActorId } from "@aie-matrix/shared-types";

/**
 * Mint XP for an actor. Monotonic — XP accumulates and cannot be traded away.
 * The minting authority is "world.xp-issuer" (a designated world sub-actor).
 */
export const rewardXp = (
  actorId: ActorId,
  qty: number,
  cause = "xp.reward",
): Effect.Effect<void, never, LedgerService> =>
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    yield* ledger.commit({
      id: ulid(),
      transfers: [{ resource: "xp", qty, from: "world.xp-issuer", to: actorId }],
      cause,
      actors: [actorId],
      ts: Date.now(),
    }).pipe(Effect.orDie); // monotonic mint from world authority should never fail
  });

/**
 * Award a badge to an actor. Monotonic — badges accumulate and cannot be traded.
 */
export const awardBadge = (
  actorId: ActorId,
  qty = 1,
  cause = "badge.award",
): Effect.Effect<void, never, LedgerService> =>
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    yield* ledger.commit({
      id: ulid(),
      transfers: [{ resource: "badge", qty, from: "world.badge-issuer", to: actorId }],
      cause,
      actors: [actorId],
      ts: Date.now(),
    }).pipe(Effect.orDie);
  });

/**
 * Credit gold (conserved) to an actor from the world bag.
 */
export const rewardGold = (
  actorId: ActorId,
  qty: number,
  cause = "gold.reward",
): Effect.Effect<void, never, LedgerService> =>
  Effect.gen(function* () {
    const ledger = yield* LedgerService;
    yield* ledger.commit({
      id: ulid(),
      transfers: [{ resource: "gold", qty, from: "world", to: actorId }],
      cause,
      actors: [actorId],
      ts: Date.now(),
    }).pipe(Effect.orDie);
  });
