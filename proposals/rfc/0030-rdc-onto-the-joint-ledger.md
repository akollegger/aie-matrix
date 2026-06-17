# RFC-0030: RDC onto the Joint Ledger (Cyphers → gold)

- **Status:** Draft (backlog — NOT on the vending-machine critical path)
- **Author:** henrardo
- **Date:** 2026-06-15
- **Affects:** `ghosts/rdc-ledger` (removed), `ghosts/rdc-poker-session`, `ghosts/rdc-poker`; deployment (RDC enters the Docker stack)
- **Related:** RFC-0023 (Resource Ledger — the joint ledger), RFC-0029 (Item–Ledger Unification — makes the joint ledger the single source of truth), RFC-0018 (RDC Skill Tiers), RFC-0015/0016 (RDC duels & bounties)
- **Depends on:** RFC-0029 (the joint ledger as substrate). This RFC folds RDC *onto* that substrate.

## Summary

RDC runs its own **parallel ledger** (`ghosts/rdc-ledger`: a private `balances` map, audit `events`, bounty escrow, "Cyphers") that is disconnected from the world. Fold it onto the **joint `LedgerService`**: rename the currency **Cyphers → `gold`**, replace the parallel ledger with world-ledger transfers, and run RDC inside the Docker stack so it shares the one source of truth. The payoff: **poker winnings *are* world gold** — a ghost can win at the table and spend it at a vending machine; there is one currency, one balance, one audit trail across the whole world.

## Motivation

Today RDC's economy is an island. `rdc-poker-session/executor.ts` imports `Ledger` from `@aie-matrix/ghost-rdc-ledger`; buy-ins, pots, winnings, and bounty escrow all move "Cyphers" in an in-memory map with its own audit log — none of it visible to or conserved with the world ledger, and RDC isn't deployed in the Docker stack at all (its world-api wiring is stubbed). This is the "RDC is a parallel impl — must refactor onto substrate" debt. Once RFC-0029 makes the joint ledger the single source of truth for all value, RDC keeping a second ledger is pure duplication — and it blocks the obvious cross-game economy (win at poker, eat at a vending machine).

## Design

### 1. Currency: Cyphers → `gold`
"Cyphers" was RDC's name for the saloon token. It becomes the world's `gold` (conserved ledger resource, RFC-0023). Rename throughout `rdc-ledger`/`rdc-poker-session`: balances, buy-in gate, winnings, escrow, the agent prompts (`encounter-brain.ts`), and the memory-writer lines ("Won N gold"). No semantic change — it was always a fungible conserved token; now it's *the* one.

### 2. Parallel ledger → joint ledger
Delete `ghosts/rdc-ledger`'s balance/event store; route everything through `LedgerService`:
- **Buy-in / cash-out / pot / winnings** → `LedgerService.commit` transfers between seated ghosts and a **table actor** (the pot is the table actor's bag during a hand; payout transfers table→winner). Conservation is automatic.
- **Audit** → the joint ledger's hash-chained log replaces `rdc-ledger`'s `events` array (provenance + verifiability for free).
- **Bounty escrow** (RFC-0015/0016) → a **bounty-escrow actor** bag (RFC-0023 actor model): place = `placer → escrow`; claim = `escrow → claimer`; revoke = `escrow → placer`.
- **Errors** → `INSUFFICIENT_FUNDS` maps onto `LedgerInsufficientFunds`; bounty-specific errors (`BOUNTY_NOT_OPEN`, `BOUNTY_SELF_CLAIM`, …) stay RDC-side.

### 3. Skills stay RDC-side
`SkillProfile` (RFC-0018: `handsPlayed`, tier, school) is **not currency** — it lived next to Cyphers only out of convenience. It moves to an RDC-owned skill store, not the ledger. The bounty **skill-transfer** rides alongside the escrow `claim` as RDC orchestration, not a ledger op.

### 4. Deployment
With its economy on the joint `LedgerService` (which lives in the world-api server), RDC must run where that server runs: add RDC to the Docker stack (a service, like `peppers`/`random-agent`), wiring the stubbed world-api integration (`say`, position, etc.). This is the bulk of the effort and the reason this RFC is its own thing.

## Non-goals / sequencing

This is **not** a prerequisite for the vending machine. RFC-0029 changes items + `take`/`drop`/`consume` in the world-api; RDC uses none of those, so RFC-0029 neither needs nor breaks RDC. Do RFC-0029 (vending machine) first; schedule this RDC fold-in afterward.

## Migration steps

1. Cyphers → `gold` rename across `rdc-*` (mechanical).
2. Replace `rdc-ledger` balance/event ops with `LedgerService` transfers (table actor for pots).
3. Bounty escrow → escrow-actor bags; move `SkillProfile` to an RDC skill store.
4. Delete `ghosts/rdc-ledger`.
5. Dockerize RDC + wire the stubbed world-api integration.
6. Verify: a ghost's poker winnings show in `inventory` as `gold` and are spendable elsewhere (e.g. a vending machine).
