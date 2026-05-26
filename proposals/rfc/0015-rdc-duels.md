# RFC-0012: RDC Duels — turn-based combat resolver

| Status | Draft |
|--------|-------|
| Author | Claude (drafted during 2026-05-07 RDC spike, reviewed by @henrardo) |
| Discussion | _open_ |

## Summary

Add a deterministic, turn-based **duel resolver** for Red Dead Convention ghosts. Two RDC agents who agree to a duel exchange a fixed number of "shots" via A2A messages; outcomes are decided by the resolver based on each agent's slider profile, current Aura balance, and a small RNG. The winner takes a stake from the loser via the existing **rdc-ledger**.

Out of scope for this RFC: physical avatars in the world (positioning during a duel), spectator visualisation of the duel (separate UI work), and PvE combat (against world NPCs).

## Motivation

The poker mini-game (RFC-0011 implementation) is the first RDC mini-game. Duels are the second canonical Wild-West interaction and use the same architectural pattern (orchestrator-driven, agent-side fast brain, deterministic engine, ledger-settled). Defining the contract now keeps the duel engine consistent with poker and re-uses the brain-switching pattern we proved out for poker.

## Design

### Engine (`rdc-duels` package)

A pure functional state machine, mirroring `rdc-poker`'s shape:

```
createDuel(challenger, target, stakes, maxRounds) → DuelState
applyShot(state, shot: ShotAction) → DuelState
isResolved(state) → boolean
```

`DuelState` carries:

- both ghosts' identities and starting stakes (Aura escrowed),
- per-ghost `composure` (starts at 100, depleted by misses + opponent hits),
- shot history,
- current round + whose turn,
- `phase: "draw" | "shooting" | "resolved"`.

`ShotAction` is a structured `{intent: "aim"|"fire"|"feint"|"surrender", precision: 0..1}` — the agent's poker-style brain emits this per turn.

Resolution rule: composure ≤ 0 = lost; first to depletion loses. Each shot deals damage shaped by:

- shooter's slider profile (high Assertiveness + low Stability = volatile damage; high Deliberation + high Self-Monitoring = consistent precision)
- target's slider profile (high Stability = absorbs)
- a deterministic seeded RNG so replays are reproducible.

### Agent side (extends `rdc-agent`)

New A2A message schemas (mirror poker):

```
aie-matrix.rdc.duel.invite.v1     orchestrator → agent: "X has called you out"
aie-matrix.rdc.duel.turn.v1       orchestrator → agent: "your move; here's the state"
aie-matrix.rdc.duel.outcome.v1    orchestrator → agent: "duel resolved"
```

A new "**duel brain**" — a small LLM or deterministic adapter — chooses the next shot. Same brain-switching pattern as poker: agent goes from social mode to duel mode at duel.invite acceptance, returns at outcome.

### Orchestrator side (extends `rdc-orchestrator`)

- New endpoint `POST /duels/start { challengerId, targetId, stake }` — the orchestrator escrows the stake from each agent, dispatches duel.invite to the target.
- Refusal returns Aura. Acceptance starts the duel runner (analogous to `runOneHand`).
- On resolution: winner takes the stake (via `Ledger.transfer`), loser's bounty (if any) becomes claimable by the winner.
- Live state streams via the existing SSE channel; the overlay grows a duel-rendering panel.

### Memory persistence

`DuelMemory` node per ghost, linked to a shared `Duel` node. Properties: opponent, won/lost, stake, rounds, final composure, brief subjective notes.

## Open questions

1. **Lethality** — does losing a duel cost the ghost? Permanent removal would feel real but is harsh; loss of all Aura + a respawn timer might be more demo-friendly.
2. **Initiating brain** — duel acceptance is binary like poker invite (deterministic from sliders), or LLM-driven for richer reasoning?
3. **Spectator UX** — is duel rendering in the existing intermedium spectator client, or a separate panel in the RDC overlay?
4. **Integration with bounties** — automatic? An open bounty on a target makes the winner of a duel against that target the bounty claimer, by default?

## Impact

- New package: `ghosts/rdc-duels/` (engine).
- Extension of `ghosts/rdc-agent/` (executor routes duel.* schemas).
- Extension of `ghosts/rdc-orchestrator/` (duel runner + endpoints).
- Optional: `clients/rdc-overlay/` evolves to show duel state.

No server-side world-api changes required for v1 of duels — they're agent-to-agent the same way poker is.
