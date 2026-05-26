# RFC-0016: The Barnacle Protocol — mini-game plugin contract

| Status | Draft — decision needed |
|--------|-------------------------|
| Date   | 2026-05-24 |
| Author | @henrardo (drafted with Claude during 2026-05-24 architecture session) |
| Related | [RFC-0006](0006-world-objects.md) (world items — platforms are items), [RFC-0007](0007-ghost-house-architecture.md) (ghost-house as supervisor), [RFC-0013](0013-rdc-bounty-hunting.md) (bounty claims will live inside poker), [RFC-0014](0014-rdc-server-capability-gating.md) (capability gating — related but orthogonal), [RFC-0015](0015-rdc-skill-tiers-and-math-schools.md) (skill tiers + math schools — poker-internal in the new model) |

## Summary

Define a wire-and-process contract by which third-party mini-games attach to the matrix world as **barnacles** — separate processes, possibly in different languages, that handle a ghost's in-game experience while the world supervises them. A ghost has two simultaneous identities sharing one `ghostId`: a **persistent** social/world self (peppers-agent) and an **ephemeral** in-game self (a mini-game process per session). When a ghost enters a mini-game, the world hands off context to the mini-game; when it exits or crashes, the world respawns the ghost at their spawn cell and resumes peppers. **The world is never destabilised by anything a contributor made.**

## Motivation

The current RDC implementation collapses both identities into a single `rdc-agent` Node process with a `gameMode: "social" | "in-platform"` flag and a shared `GhostState` memory. It works, but it makes three things impossible:

1. **Failure isolation.** A crash in the poker engine takes peppers down with it. Worse: a future arcade game written by a contributor could take peppers down. Worst: it could take down the world (since the orchestrator is in-process with everything).
2. **Polyglot contributions.** A contributor who wants to write a mini-game in Python, Rust, or Go cannot — they'd have to write a JS rdc-agent-style module that lives inside the host's runtime.
3. **Clean contract for "what a mini-game is."** Today, "mini-game" is whatever the rdc-agent's executor handlers happen to do. Documenting that for a new contributor is hard because there's no boundary. A protocol gives the contract a name and a shape.

The "barnacle" framing makes the priority explicit: **the host is never at risk from the barnacle.** A barnacle can fail however it wants; the host detects, evicts, and respawns the ghost. Plugins are first-class but untrusted.

The cost: every mini-game becomes a separate process with its own deploy story. We pay this cost once (to define the protocol) and it then constrains every mini-game forever. The benefit grows linearly with the number of mini-games we add — duels, arcade, music battles, anything ghost-mediated.

## Design

### Two ghosts, one identity

```
Persistent (per ghostId)
  ├─ World (Colyseus, spatial state)
  └─ peppers-agent process
       ├─ owns: social cascade, OCEAN sliders (live-drifted), opponent reads,
       │        Neo4j ghost-memory, world-MCP connection
       └─ A2A surface: spawn-context, encounter, pause, resume

Ephemeral (per ghostId × per encounter, runs for one session)
  └─ mini-game-process (e.g. rdc-poker-agent, future rdc-duel-agent, ...)
       ├─ owns: in-game persona, in-game memory, math school, skill tier,
       │        animal type, game-class-specific state
       └─ A2A surface: accept-handoff, heartbeat, complete, crash (implicit)

Supervisor (singleton — ghost-house)
  ├─ catalog: which mini-game serves which Platform class
  ├─ launches mini-game process on encounter-accept
  ├─ watches heartbeat + hard-timeout
  ├─ on crash or timeout: respawn ghost, resume peppers, evict mini-game
  └─ on graceful complete: same, but with optional narrative bundle
```

The two processes never communicate directly. They share state only through:
- The shared `ghostId` (identity)
- The ledger (Aura balance; possibly skill tier if game-persistent)
- Neo4j (only if both choose to read/write the same paths — discouraged unless the boundary is explicit)

### Encounter flow

1. Mini-game declares its presence as a `Platform:*` world item ([RFC-0006](0006-world-objects.md)). E.g. the saloon is a `PokerTable` item placed on a map tile.
2. Adopter's ghost (peppers) wanders. On arrival at a tile **adjacent** to a `Platform:*` item tile, world fires `platform.encounter.v1` to peppers (existing schema).
3. Peppers' encounter brain decides accept / decline. Decline includes a polite "table full, find another, or come back later" path when seats are taken.
4. On decline: ghost continues wandering. No handoff.
5. On accept: supervisor triggers handoff (next section).

The mini-game itself never sees the encounter. The encounter is a peppers-side decision about whether peppers consents to be temporarily replaced. The mini-game starts existing only after accept.

### Handoff: world → mini-game

Supervisor opens the mini-game session by:

1. Calling `removeGhostCell(ghostId)` on the world (new bridge method — see §"Required world support") so the ghost vanishes from the spectator/Colyseus state.
2. Sending `pause.v1` A2A to peppers — peppers aborts its social-cascade AbortController and goes dormant.
3. Sending `barnacle.handoff.v1` A2A to the mini-game process with this payload:

```ts
interface BarnacleHandoff {
  readonly schema: "aie-matrix.barnacle.handoff.v1";
  readonly sessionId: string;            // unique per encounter
  readonly ghostId: string;              // shared identity
  readonly displayName: string;
  readonly role?: string;                // "outlaw" | "marshall" | ... game-agnostic
  readonly personality: PersonalityState; // snapshot — mini-game derives its own persona, etc.
  readonly worldCredential: {
    readonly token: string;              // for ledger/memory writes
    readonly worldApiBaseUrl: string;
  };
  readonly spawnCell: string;            // h3 index for return teleport
  readonly platformId: string;           // which platform-instance triggered this
  readonly platformType: string;         // "PokerTable" — for mini-games that handle multiple classes
  readonly hostEndpoints: {
    readonly supervisorA2A: string;      // mini-game posts heartbeat + complete here
  };
}
```

Mini-game responds with:
```ts
interface BarnacleHandoffAck {
  readonly schema: "aie-matrix.barnacle.handoff.v1";
  readonly sessionId: string;
  readonly accepted: boolean;            // false → supervisor immediately reverts
  readonly heartbeatIntervalMs?: number; // mini-game's preferred ping cadence; supervisor honours within sane bounds
  readonly hardTimeoutMs?: number;       // self-declared max session length; supervisor caps at 2h regardless
}
```

If `accepted: false` or no reply within `15s`: supervisor immediately reverts the entire handoff (re-`setGhostCell`, `resume.v1` to peppers, no narrative). Mini-game is treated as broken.

What the handoff bundle deliberately **does not include**:
- Peppers' `opponentReads` from world conversations
- Peppers' slider-drift history
- Conversation transcripts
- Any game-class-specific state — that's the mini-game's responsibility to load (from ledger, its own persistence, or fresh per session)

### Heartbeat

Supervisor posts `heartbeat.v1` to the mini-game's A2A endpoint at the agreed interval. Mini-game responds OK. Three consecutive misses within a 90s window → supervisor treats as crash.

```ts
interface BarnacleHeartbeat {
  readonly schema: "aie-matrix.barnacle.heartbeat.v1";
  readonly sessionId: string;
}

interface BarnacleHeartbeatAck {
  readonly schema: "aie-matrix.barnacle.heartbeat.v1";
  readonly sessionId: string;
  readonly status: "alive";
}
```

### Termination (mini-game → world)

Mini-game signals graceful completion by posting to the supervisor's A2A:

```ts
interface BarnacleComplete {
  readonly schema: "aie-matrix.barnacle.complete.v1";
  readonly sessionId: string;
  readonly ghostId: string;
  readonly narrative?: string;           // one-line summary for peppers ("won big", "busted out")
  readonly lastEventIso: string;
}
```

Crashes are implicit — the mini-game process either dies or stops heartbeating. Either is treated the same way by the supervisor:

1. Call registry `/respawn` → teleport ghost to spawn cell
2. Send `resume.v1` to peppers with `{ narrative?: string }` (omitted on crash)
3. Mark the session terminated; evict the mini-game process or instance

### Pause / resume on peppers

Two new A2A schemas on peppers-agent:

```ts
interface PeppersPause {
  readonly schema: "aie-matrix.peppers.pause.v1";
  readonly ghostId: string;
  readonly reason: "barnacle-handoff" | "shutdown" | ...;
}

interface PeppersResume {
  readonly schema: "aie-matrix.peppers.resume.v1";
  readonly ghostId: string;
  readonly narrative?: string;           // optional stimulus from the mini-game session
}
```

`pause` is idempotent — re-pausing an already-paused ghost is OK. `resume` is idempotent in the same way. Both operate on the existing `runHouse` AbortController + relaunch pattern that the current `respawnSocialLoop` already implements; we just expose them as named A2A endpoints rather than internal calls.

The optional `narrative` on resume gets prepended to the cascade's stimulus queue, so the LLM "remembers" what just happened in the in-game session as a fresh experience (not a memory write — peppers cascade memory is its own thing).

### Supervisor — implementation location

The supervisor role lives in **ghost-house** (existing `SupervisorService`). Ghost-house already handles catalog + agent spawning; the mini-game supervisor is a natural extension. No new process needed.

Specifically: ghost-house catalog gains a new entry kind — `mini-game` — alongside the existing `agent` kind. Mini-game catalog entries declare:

- `agentId` (e.g. `rdc-poker`)
- `baseUrl` (the mini-game's A2A endpoint)
- `platformClasses: string[]` (which world-item classes this mini-game claims)
- `hardTimeoutMs?` (override default 2h)

When ghost-house receives a peppers `encounter-accepted` notification, it:
1. Looks up which mini-game in the catalog claims the relevant `platformClass`
2. Triggers the handoff sequence (remove from world, pause peppers, hand off to mini-game)
3. Owns the session lifecycle from that point — heartbeat, timeout, completion / crash recovery

### Required world support

One new method on `MatrixRoom` (and `ColyseusWorldBridge`):

```ts
removeGhostCell(ghostId: string): void;  // deletes from state.ghostTiles + internal map
```

This is a small boil expansion (one method) and matches the existing `setGhostCell` pattern. Existing `setGhostCell` is unchanged — used for both initial placement and respawn.

### Registration / discovery

Mini-games register with ghost-house's catalog the same way agents do today — POST `/v1/catalog/register` with the new `kind: "mini-game"` flag. The catalog persists the registration to `catalog.json`.

Multiple mini-games claiming the same platform class is rejected at registration time in v1 (409 Conflict). Picking between multiple providers is an open question.

### Worked example: ghost plays poker, leaves cleanly

```
adopter spawn-context
  → peppers wanders
    → walks adjacent to PokerTable tile
      → world fires platform.encounter.v1 → peppers brain ACCEPTS
        → ghost-house receives encounter-accept
          → removeGhostCell(ghostId) → ghost vanishes from spectator
          → pause.v1 to peppers → social cascade halts
          → barnacle.handoff.v1 to rdc-poker → mini-game spawns session
            → ack OK, heartbeatIntervalMs: 30_000
          → ghost-house begins heartbeat polling
            ↓
       [mini-game runs the table for N hands, multiple turns each]
            ↓
        → reflect-brain decides LEAVE
        → poker mini-game posts barnacle.complete.v1 to supervisor
          { narrative: "Played 8 hands, won 220 Aura, last seat next to a Lion." }
        → supervisor: registry /respawn → ghost reappears at spawn cell
        → supervisor: resume.v1 → peppers (with narrative stimulus)
        → peppers's social cascade restarts, first stimulus is the narrative
```

Crash path is identical except no narrative is included in the resume.

### What dies in the current code

Mostly things split rather than die outright:

- `rdc-agent` splits in two:
  - The peppers-side handlers (`handleSpawn`, `handlePlatformEncounter`, `handlePlatformExit`) move into peppers-agent (or a thin "encounter responder" — to be decided in implementation).
  - The poker-side handlers (`handlePokerInvite`, `handlePokerTurn`, `handlePokerOutcome`, `handlePokerReflect`) move into a new `rdc-poker-agent` process. The `gameMode` flag goes away — the poker process *is* the in-game mode by existing.
- `rdc-orchestrator` becomes **internal** to the poker mini-game — the new `rdc-poker-agent` uses it (or absorbs it) to drive table state. It loses its current role as "supervisor of platform encounters" — that goes to ghost-house.
- The `Platform`/`tryAdd`/`waiting`-list code in `rdc-orchestrator` collapses (waiting list goes away per recent decision; platform identity is now tied to the world-item, not an orchestrator-private record).
- The encounter trigger location shifts from "ghost on platform tile" to "ghost adjacent to platform-item tile" (already discussed, lands in this RFC).

## Open Questions

1. **Where exactly does the encounter responder live?** Peppers-agent already runs the cascade; bolting an encounter handler onto it is small but pollutes the peppers boundary slightly. Alternatives: (a) inside peppers-agent (simplest); (b) a thin separate process per ghost that wraps peppers and exposes encounter A2A (more isolated, more processes); (c) ghost-house intercepts the encounter and decides on behalf of peppers (loses persona context). Lean (a).

2. **What does the supervisor do if peppers itself is down or doesn't ack `pause`?** Probably: refuse the handoff and the ghost wanders past the tile (encounter is silently dropped). Worth confirming.

3. **Heartbeat granularity.** 30s default feels right for a turn-based game; an arcade game might want sub-second. Should the contract impose an upper bound (no more than once/sec) to protect the supervisor from spammy mini-games?

4. **Where does mini-game-persistent state live?** `skillTier` and `mathSchool` are poker-domain concepts but persist per-ghost across sessions. Options: (a) in the rdc-poker mini-game's own persistence file (ledger-like); (b) in the shared `rdc-ledger`; (c) in Neo4j keyed by ghostId. Lean (a) — keep it inside the mini-game's domain so a contributor's game doesn't need to know about RDC's storage.

5. **What if a mini-game wants to manipulate the world during play?** E.g. drop items, modify tiles. v1 answer: no — the mini-game is a barnacle on a single tile. Future: a scoped permissions model where the catalog declares what world operations the mini-game may perform.

6. **Stateful resumption on crash.** Currently the proposal is "if the mini-game crashes mid-hand, the ghost just respawns and the in-progress hand is lost." Acceptable for poker (one hand wasted) but might not be for longer-form mini-games. v1 keeps the simple semantics; future RFC could add session-snapshot for crash recovery.

7. **Naming the rdc-orchestrator.** Once it becomes internal to the poker mini-game, "orchestrator" is a misleading name. Candidates: `rdc-poker-table-driver`, `rdc-poker-engine-host`. Bikeshed for a later PR.

## Alternatives

**1. Keep the current mode-flip model.** Smaller code, simpler debugging, no boil between peppers and poker. Lose: crash isolation (a poker bug kills peppers), language flexibility (mini-games must be JS in the same runtime), contributor-friendliness (no clear contract), independent scaling (mini-games can't move to their own infrastructure). Acceptable for one mini-game; degrades as we add more. The decision to refactor is the bet that we *will* add more.

**2. WebWorker / VM sandboxes.** Run mini-games as JS contexts inside the host process with structured isolation. Pros: lower process overhead, simpler IPC. Cons: still constrains contributors to JS, still shares heap with the host (memory leaks bleed across), no help against a runaway CPU loop unless we add quotas. Conflicts with the polyglot goal.

**3. World directly hosts mini-game state.** Easiest possible integration — every mini-game becomes a function the world calls. Worst possible isolation — the world becomes a god-process. Any mini-game crash is a world crash. The opposite of the barnacle principle. Rejected.

**4. Shared-memory IPC instead of A2A.** Use Unix domain sockets, shared-memory ringbuffers, or similar between peppers and the mini-game. Faster than HTTP/A2A, slightly more lock-in to a specific runtime. The current A2A protocol already works between processes and across languages; using it for the barnacle protocol means contributors only need to learn one protocol. The performance overhead of A2A for turn-based games is irrelevant.

**5. Phased adoption.** Land the protocol but keep the rdc-agent in-process model running side-by-side for one milestone, with mini-games able to opt in. Lets us evolve the contract against real conformers before forcing the cutover. Considered, rejected: maintaining two implementations of "what is poker" is worse than the cutover risk.
