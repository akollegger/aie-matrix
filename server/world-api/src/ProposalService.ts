/**
 * ProposalService — in-memory store of pending ghost-to-ghost trade proposals.
 *
 * A proposal is ephemeral: it lives only in memory, expires after a configurable TTL,
 * and is never persisted. Only the final agreed ledger transaction is durable.
 * This matches RFC-0023 §4: "higher-level mechanic, with the ledger seeing only the
 * final consented transaction."
 */
import { Context, Effect, Layer } from "effect";
import { ulid } from "ulid";
import type { ActorId, Proposal, ResourceId } from "@aie-matrix/shared-types";
import {
  LedgerConservationViolation,
  LedgerCounterpartyNotNearby,
  LedgerDuplicateTransaction,
  LedgerInsufficientFunds,
  LedgerPersistenceError,
  LedgerProposalExpired,
  LedgerProposalNotFound,
  LedgerSelfAgreeDenied,
  LedgerUnknownResource,
} from "./ledger-errors.js";
import { GroupResourceMismatch } from "./group-errors.js";
import { LedgerService } from "./LedgerService.js";
import { GroupService } from "./GroupService.js";

export const PROPOSAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ProposeParams {
  initiatorId: ActorId;
  counterpartyId: ActorId;
  give: { resource: ResourceId; qty: number };
  want: { resource: ResourceId; qty: number };
  /**
   * When true, both sides contribute equal amounts of the same resource to a
   * newly created group bag (group formation) rather than exchanging with each
   * other. FR-011: give.resource must equal want.resource when shared is true.
   */
  shared?: boolean;
  /** Override the default TTL for this proposal. Unix ms absolute expiry. */
  expiresAtMs?: number;
}

/** Lookup function for ghost cell — injected to avoid a hard WorldBridgeService dependency. */
export type GhostCellLookup = (ghostId: ActorId) => string | undefined;

/**
 * Callback invoked by ProposalService.agree() when a shared (group formation)
 * proposal is accepted. Injected to avoid a circular dependency on GroupService.
 * Returns the new groupId.
 */
export type GroupFormationCallback = (params: {
  groupId: string;
  ghostA: ActorId;
  ghostB: ActorId;
  resource: string;
  amount: number;
  formationTxId: string;
}) => Promise<{ groupId: string; name: string }>;

export interface ProposalServiceOps {
  /** Create a pending proposal. Returns the proposal ID and expiry timestamp.
   *  Pass `getGhostCell` to enforce same-tile proximity; omit to skip the check.
   *  When `params.shared` is true, both sides must use the same resource (FR-011). */
  propose(params: ProposeParams, getGhostCell?: GhostCellLookup): Effect.Effect<{ proposalId: string; expiresAt: number }, LedgerCounterpartyNotNearby | GroupResourceMismatch>;

  /**
   * Accept a pending proposal. Atomically commits the ledger transaction carrying
   * both actors' consent. Marks proposal as agreed.
   * Fails if: caller is the initiator, proposal not found, proposal expired,
   * or insufficient funds.
   */
  agree(
    proposalId: string,
    callerId: ActorId,
  ): Effect.Effect<
    Proposal,
    | LedgerProposalNotFound
    | LedgerProposalExpired
    | LedgerSelfAgreeDenied
    | LedgerInsufficientFunds
    | LedgerConservationViolation
    | LedgerDuplicateTransaction
    | LedgerUnknownResource
    | LedgerPersistenceError
  >;

  /** Cancel or reject a proposal. Either party may call this. */
  decline(
    proposalId: string,
    callerId: ActorId,
  ): Effect.Effect<Proposal, LedgerProposalNotFound>;

  /** Return all proposals that involve the given actor (as initiator or counterparty). */
  listFor(actorId: ActorId): Effect.Effect<Proposal[]>;
}

export class ProposalService extends Context.Tag("world-api/ProposalService")<
  ProposalService,
  ProposalServiceOps
>() {}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function makeProposalService(
  ledger: LedgerService["Type"],
  defaultCellLookup?: GhostCellLookup,
  onGroupFormation?: GroupFormationCallback,
): ProposalServiceOps {
  const proposals = new Map<string, Proposal>();

  function getActive(proposalId: string): Proposal | undefined {
    const p = proposals.get(proposalId);
    if (!p) return undefined;
    if (p.status !== "pending") return p; // return non-pending for error reporting
    if (Date.now() > p.expiresAt) {
      proposals.set(proposalId, { ...p, status: "expired" });
      return proposals.get(proposalId);
    }
    return p;
  }

  const propose = (params: ProposeParams, cellLookup?: GhostCellLookup) =>
    Effect.gen(function* () {
      // FR-011: shared formation requires same resource on both sides
      if (params.shared === true && params.give.resource !== params.want.resource) {
        yield* Effect.fail(new GroupResourceMismatch({
          giveResource: params.give.resource,
          receiveResource: params.want.resource,
        }));
      }

      // Proximity check: both ghosts must be on the same tile.
      const lookup = cellLookup ?? defaultCellLookup;
      if (lookup) {
        const initiatorCell = lookup(params.initiatorId);
        const counterpartyCell = lookup(params.counterpartyId);
        if (!initiatorCell || !counterpartyCell || initiatorCell !== counterpartyCell) {
          yield* Effect.fail(new LedgerCounterpartyNotNearby({
            initiatorId: params.initiatorId,
            counterpartyId: params.counterpartyId,
          }));
        }
      }

      const proposalId = ulid();
      const expiresAt = params.expiresAtMs ?? Date.now() + PROPOSAL_TTL_MS;
      const proposal: Proposal = {
        proposalId,
        initiatorId: params.initiatorId,
        counterpartyId: params.counterpartyId,
        give: params.give,
        want: params.want,
        expiresAt,
        status: "pending",
        ...(params.shared === true ? { shared: true } : {}),
      };
      proposals.set(proposalId, proposal);
      return { proposalId, expiresAt };
    });

  const agree = (proposalId: string, callerId: ActorId) =>
    Effect.gen(function* () {
      const p = getActive(proposalId);
      if (!p) {
        yield* Effect.fail(new LedgerProposalNotFound({ proposalId }));
        return undefined as never;
      }
      if (p.status === "expired") {
        yield* Effect.fail(new LedgerProposalExpired({ proposalId }));
        return undefined as never;
      }
      if (p.status !== "pending") {
        yield* Effect.fail(new LedgerProposalNotFound({ proposalId }));
        return undefined as never;
      }
      if (callerId !== p.counterpartyId) {
        yield* Effect.fail(new LedgerSelfAgreeDenied({ proposalId, actorId: callerId }));
        return undefined as never;
      }

      const txId = ulid();

      if (p.shared === true) {
        if (!onGroupFormation) {
          // shared=true without a formation callback is a misconfigured runtime;
          // surface it immediately rather than silently committing a ledger entry
          // to a bag that nothing owns.
          yield* Effect.fail(new LedgerPersistenceError({ cause: "GroupFormationCallback not injected into ProposalService" }));
          return undefined as never;
        }

        // Generate the groupId now so the ledger destination matches the actual
        // group bag that GroupService will create (group:{groupId}).
        const groupId = ulid();
        const groupBagId = `group:${groupId}`;

        // Only commit a ledger transfer when the ante is non-zero; amount=0
        // (communication-only bond) is valid but produces no resource movement.
        if (p.give.qty > 0) {
          yield* ledger.commit({
            id: txId,
            transfers: [
              { resource: p.give.resource, qty: p.give.qty, from: p.initiatorId, to: groupBagId },
              { resource: p.want.resource, qty: p.want.qty, from: p.counterpartyId, to: groupBagId },
            ],
            cause: "group.form",
            actors: [p.initiatorId, p.counterpartyId],
            ts: Date.now(),
          });
        }

        yield* Effect.promise(() =>
          onGroupFormation({
            groupId,
            ghostA: p.initiatorId,
            ghostB: p.counterpartyId,
            resource: p.give.resource,
            amount: p.give.qty,
            formationTxId: txId,
          }),
        );
      } else {
        // Standard trade: initiator gives, counterparty gives in return
        yield* ledger.commit({
          id: txId,
          transfers: [
            { resource: p.give.resource, qty: p.give.qty, from: p.initiatorId, to: p.counterpartyId },
            { resource: p.want.resource, qty: p.want.qty, from: p.counterpartyId, to: p.initiatorId },
          ],
          cause: "trade",
          actors: [p.initiatorId, p.counterpartyId],
          ts: Date.now(),
        });
      }

      const agreed: Proposal = { ...p, status: "agreed" };
      proposals.set(proposalId, agreed);
      return agreed;
    });

  const decline = (proposalId: string, callerId: ActorId) =>
    Effect.gen(function* () {
      const p = proposals.get(proposalId);
      if (!p) {
        yield* Effect.fail(new LedgerProposalNotFound({ proposalId }));
        return undefined as never;
      }
      if (callerId !== p.initiatorId && callerId !== p.counterpartyId) {
        yield* Effect.fail(new LedgerProposalNotFound({ proposalId }));
        return undefined as never;
      }
      const declined: Proposal = { ...p, status: "declined" };
      proposals.set(proposalId, declined);
      return declined;
    });

  const listFor = (actorId: ActorId) =>
    Effect.sync(() =>
      [...proposals.values()].filter(
        p => p.initiatorId === actorId || p.counterpartyId === actorId
      )
    );

  // TTL sweep: run every 30s, mark expired proposals
  setInterval(() => {
    const now = Date.now();
    for (const [id, p] of proposals) {
      if (p.status === "pending" && now > p.expiresAt) {
        proposals.set(id, { ...p, status: "expired" });
      }
    }
  }, 30_000).unref();

  return { propose, agree, decline, listFor };
}

/** Standalone layer when you have a ledger instance already. */
export const makeProposalServiceLayer = (
  ledger: LedgerService["Type"],
): Layer.Layer<ProposalService> =>
  Layer.succeed(ProposalService, makeProposalService(ledger));

/** Effect Layer that depends on LedgerService — use in the main runtime.
 *  Proximity enforcement is injected later via `makeProposalServiceLayer` once
 *  the WorldBridgeService instance is available (at MCP request time via offerEffect/requestEffect). */
export const ProposalServiceLayer: Layer.Layer<ProposalService, never, LedgerService> =
  Layer.effect(ProposalService, Effect.map(LedgerService, (ledger) => makeProposalService(ledger)));

/**
 * ProposalService layer wired with GroupService formation callback.
 * Use this instead of ProposalServiceLayer in runtimes that have GroupService available.
 */
export const ProposalServiceWithGroupLayer: Layer.Layer<ProposalService, never, LedgerService | GroupService> =
  Layer.effect(
    ProposalService,
    Effect.gen(function* () {
      const ledger = yield* LedgerService;
      const groups = yield* GroupService;
      const callback: GroupFormationCallback = (params) =>
        Effect.runPromise(groups.createGroup(params));
      return makeProposalService(ledger, undefined, callback);
    }),
  );
