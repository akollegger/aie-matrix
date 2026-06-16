# Research: Ghost Agent Autospawning

## How spawnRosterForAgent is triggered today

**Decision**: `spawnRosterForAgent` is called in exactly two places in the current codebase:
1. `POST /v1/sessions/spawn-trusted/:agentId` — operator-initiated manual call (used by `demo.mjs`)
2. `SupervisorService.deliverWorldEvent` when `event.kind === "world.session.start"` — fires once when a session is first created

**Rationale**: The `world.session.start` event is emitted by the Colyseus bridge when it detects a new session room. It fires at session creation, not on agent-host restart. Pod restarts into an already-running session receive no event.

**Alternatives considered**: A subscription/watch mechanism on the Colyseus room — rejected because the world bridge already handles connection state; adding a reconciliation step at startup is simpler and does not require changes to the event model.

---

## Where to wire startup reconciliation in agent-host

**Decision**: `main.ts` listen callback, as a third async bootstrap alongside the existing Colyseus bridge and Barnacle encounter trigger bootstraps.

**Rationale**: Both existing bootstraps follow the same pattern — `void (async () => { try { ... } catch (e) { console.error(...) } })()`  inside the listen callback. The reconciliation fits this pattern exactly and does not require any new Layer or Effect service. It can call `runtime.runPromise(pipe(AgentSupervisor, Effect.map(s => s.spawnRosterForAgent(...))))` directly.

**Sequence**: reconciliation runs after the Colyseus bridge is started, so if `world.session.start` also fires during startup (race condition on fresh session), `spawnRosterForAgent`'s existing idempotency guard handles duplicates.

---

## How catalog entries signal rosterAgent

**Decision**: `agentCard.matrix.rosterAgent === true` is the existing flag. It is checked in both `spawn-trusted` and `deliverWorldEvent`. No new field or schema change is required.

**Rationale**: The flag is already in use for npc-agent. Adding it to random-agent's `buildWandererAgentCard` return value and the local `catalog.json` entry is the minimal change.

**Note**: The production catalog is rebuilt from the live agent card fetched when random-agent self-registers. So the flag must live in `buildWandererAgentCard` (the source of truth), not only in `catalog.json`.

---

## random-agent /v1/roster design

**Decision**: Return `N` synthetic entries where `N = parseInt(RANDOM_AGENT_COUNT, 10) || 10`. Each entry: `{ characterId: "wanderer-${i}", displayName: "Wanderer ${i}" }`.

**Rationale**: Matches the npc-agent `/v1/roster` schema (`Array<{ characterId, displayName, background? }>`). `spawnRosterForAgent` iterates this array without modification. No background field needed — wanderers have no identity.

**Alternatives considered**: A `.wanderer.gram` config file per wanderer — rejected as unnecessary complexity; count-only config is sufficient for fungible agents.

---

## Idempotency guarantee

**Decision**: No new idempotency logic needed. `supervisor.spawn` already rejects with `"ghostId already has an active session"` and `spawnRosterForAgent` already swallows that error as success.

**Rationale**: Each reconciliation call provisions a new `ghostId` via `POST /registry/ghosts`. Two rapid reconciliation runs would provision two different ghostIds for the same `wanderer-1` displayName — acceptable since ghostId (not displayName) is the unique key.

---

## Constitution gate: Proposal-First

**Decision**: Proceed without a new RFC. Justified as a small, well-understood operational fix that does not alter architecture, shared contracts, or repo structure.

**Rationale**: 
- The `/v1/roster` contract is additive and consistent with the existing npc-agent contract (no breaking change to consumers).
- The reconciliation loop adds behavior to `main.ts` startup, not a new service or architectural boundary.
- Spec 032 and this plan serve as the written proposal record per constitution §I ("Small, well-understood fixes MAY proceed with a PR description only when they do not alter architecture, public contracts, or repo structure").

**Risk**: If the team decides this warrants a formal RFC, the plan can be paused for one without any rework — the design is stable.
