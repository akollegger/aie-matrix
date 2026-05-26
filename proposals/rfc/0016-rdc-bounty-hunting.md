# RFC-0013: RDC Bounty Hunting — claim mechanics

| Status | Draft |
|--------|-------|
| Author | Claude (drafted during 2026-05-07 RDC spike, reviewed by @henrardo) |
| Discussion | _open_ |

## Summary

The first RDC implementation (delivered alongside this RFC) ships **bounty placement** — any RDC agent can escrow Aura on another ghost via the ledger. This RFC defines **bounty claiming** — how a hunter actually catches their target and collects.

Out of scope: bounty placement (already done), capability gating (RFC-0014).

## Motivation

A bounty without a claim mechanism is just escrow. The whole tension of "make sure you're not the one with the lowest credits" only lands when bounties drive actual ghost behaviour — hunters chasing targets, targets evading, marshalls policing the street.

## Design

Two complementary catch paths:

### Path 1 — Catch via duel

If a hunter wins a duel against a target whose head carries an open bounty, the bounty resolves to that hunter automatically. This composes RFC-0012 (duels) with the existing `Ledger.claimBounty()` already in `rdc-ledger`.

**Required**: RFC-0012 implementation lands first.

Implementation: when `runDuel()` resolves with `winner !== loser`, the orchestrator queries the ledger for `listOpenBounties(loser)` and claims each one to the winner via `claimBounty()`. Hunter Aura goes up, escrow zeroes out.

### Path 2 — Catch via bring-in (capture, not kill)

A more flavorful mechanic: the hunter captures the target by **trapping them in a tile** and calling for the marshall. Mechanically:

1. Hunter and target share a tile.
2. Hunter calls `claim_bounty(targetId, bountyId)` via a new MCP-style tool.
3. The target gets a chance to **resist** (an A2A `bounty.resist.v1` message; same brain-switch pattern). Resistance triggers a duel (Path 1).
4. If the target accepts capture, ledger awards the hunter; the target's Aura takes a configurable hit on top of the escrow loss.

**Required**: tile co-occupation must be observable to the orchestrator — we need a Colyseus subscription (deferred from the v1 spike) or a new world-api query.

### Marshalls

Marshall agents (declared via a `role: "marshall"` field on the A2A card's `matrix` extension) get bonus claim rewards: capturing an outlaw earns 1.25× the bounty instead of 1×. Cosmetic for v1; mechanically optional.

### Memory persistence

A `BountyClaim` node per claim, linked to the `Bounty` node and to both `Ghost` nodes (claimer, target). Lets the social brain read "I was caught last week by ghost_X" or "I bagged ghost_Y for 200" as conversational context.

## Open questions

1. **Resist deadline** — how long does the target have to respond to a capture? A2A response timeout is the natural ceiling but a tighter (3-5s) timer is more dramatic.
2. **Stale bounties** — should bounties expire after some duration? If so, escrow returns to placer.
3. **Stacked bounties** — multiple bounties on the same target are independent. Captured once = all bounties on that target resolve to the same hunter? Or sequential?
4. **Cross-house** — can a peppers agent place a bounty on an RDC ghost? Implementation is allowed (the ledger doesn't gate by class); flavor is questionable.

## Impact

- New endpoint on rdc-orchestrator: `POST /bounties/:id/claim { hunterId, method: "duel" | "capture" }`.
- New A2A schemas in rdc-agent: `bounty.resist.v1`.
- New memory node type in rdc-orchestrator's memory writer: `BountyClaim`.
- Path 2 requires Colyseus subscription (deferred infrastructure; same one needed for full poker auto-invite from saloon presence).

No world-api changes for Path 1. Path 2 needs co-occupation observability (covered by Colyseus subscription, not new world-api code).
