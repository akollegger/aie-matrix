# ADR-0012: Ghost Self-Spawn Lifecycle

**Status:** proposed  
**Date:** 2026-06-10  
**Authors:** @akollegger  
**Related:** [ADR-0004](0004-a2a-ghost-agent-protocol.md) (A2A ghost protocol — host-orchestrated spawn) · [ADR-0009](0009-first-party-ghost-deployment.md) (first-party, intra-cluster auth) · [ADR-0011](0011-unified-jwt-auth.md) (scoped JWT credentials) · [RFC-0007](../rfc/0007-ghost-house-architecture.md) (Agent Host Architecture) · [RFC-0026](../rfc/0026-npc-agent.md) (NPC Agent — first consumer)

## Context

Ghosts began as partners or digital twins of IRL attendees — passive avatars driven by a human or a simple behavioral tier. The agent-host model reflects that origin: the host (or an external orchestrator holding a privileged dev token) decides *which* ghost to embody and *when*, then **pushes** a `SpawnContext` to an agent for a single ghost. The agent is a recipient, not an initiator. Concretely today:

- `POST /v1/sessions/spawn/:agentId` requires the host dev token (`GHOST_HOUSE_DEV_TOKEN`) and is called only by external orchestrators (`scripts/demo.mjs`, the TCK, the map editor). It spawns one already-adopted ghost per call.
- `world.session.start` is defined in `WorldEventKind` and bridge-mapped, but is **never emitted** — agents have no signal that a session has begun.

(Per-ghost identity richness — e.g. a `background` field — is a separate concern handled in RFC-0026/IC-008, not decided here.)

Ghosts are now becoming **independent actors** with their own lifecycles. The proposed NPC agent (RFC-0026) is the first agent that must, on its own initiative, populate a session with a *roster* of ghosts — and different agent implementations will spawn different numbers and kinds of ghosts according to their own logic. The host cannot dictate that roster; the agent owns it.

This requires a decision about **how a ghost agent enters a session**: how it discovers (or awaits) an active session at startup, and how it is permitted to spawn itself — and potentially many ghosts — into that session. For the MVP there is exactly **one** active session at a time, which bounds the discovery problem.

## Decision

**Ghost agents own their spawn lifecycle. The agent-host shifts from orchestrator-driven push to supporting agent-driven self-spawn**, via one reused capability (session discovery) and two new additions (agent-callable self-spawn and session-start emission). The new self-spawn capability is authenticated through the unified scoped-credential system (ADR-0011) — never the dev token or a bare secret (Constitution §V):

1. **Session discovery.** Agents discover the active session through the **existing world-api endpoint `GET /live?status=active`** ([LiveSessionRoutes.ts:228](../../server/world-api/src/live/LiveSessionRoutes.ts)) — the same public list the Intermedium client uses. It returns `SessionRecord[]` (`id`, `name`, `status`, `startedAt`, `world`, `maps`); MVP has at most one active record. On startup an agent queries it; if the list is empty, the agent **awaits** the newly-emitted `world.session.start` event (see #3) rather than polling indefinitely. No new discovery endpoint is introduced.

2. **Agent-callable self-spawn.** The agent-host exposes a spawn capability an agent invokes **with its own scoped JWT** (an `agent-host`/`spawn`-scoped token per ADR-0011, issued to first-party agents per ADR-0009). The agent submits the roster *it* decides to create — N ghosts of whatever kinds its logic dictates — and the host adopts and spawns each via the existing `AgentSupervisor.spawn` engine, returning the spawn contexts. The host validates and supervises; it does not choose the roster.

3. **Session-start signal.** The world server emits the existing-but-unused `world.session.start` world event when a session becomes active, giving agents a push trigger to self-spawn against (complementing the startup query in #1).

The agent-host catalog/registration contract (ADR-0009 self-registration) is unchanged. Behavioral tiers (ADR-0004) are unchanged. This decision changes *who initiates spawn* (agent, not orchestrator) and *what a spawn request can contain* (an agent-defined roster, not a single host-chosen ghost).

## Rationale

**Independence is the point.** An agent that spawns "different numbers and kinds of ghosts according to its own logic" cannot be expressed in a host-chosen, one-ghost-per-call push model. Making the agent the initiator is the minimal model that matches the new requirement, and it generalizes beyond the NPC agent to any future agent with an independent lifecycle.

**Reuses the credential system we already chose.** ADR-0011 established one scoped-JWT path for all privileged operations precisely so new privileged actions cost "one scope string, not a new auth mechanism." Self-spawn is exactly such an action: it gets a scope, not a bespoke endpoint with a shared secret. This keeps the host's single validation path and avoids re-introducing the `tryAdminAuth()`-style fast path the constitution forbids.

**Discovery + await is robust to startup ordering.** Querying the active session at startup handles the "session already running" case; awaiting `world.session.start` handles the "agent started first" case. Together they remove the race without busy-polling, and the single-session MVP keeps discovery trivial (no selection policy needed yet).

**Preserves the orchestrator engine.** The host's existing `AgentSupervisor.spawn` (entry-point resolution, token minting, duplicate-`ghostId` rejection, A2A delivery) is reused unchanged behind the new agent-facing capability — the change is the *caller* and the *authn*, not the spawn mechanics.

## Alternatives Considered

**Keep orchestrator-driven spawn; ship only an external roster script.** An external process reads each agent's roster and calls the existing dev-token spawn endpoint per ghost. Rejected: it leaves ghosts passive, contradicts "agents spawn according to their own logic," and keeps roster knowledge outside the agent that owns it. (This is RFC-0026's rejected "external orchestrator only" alternative, at the architecture level.)

**Host spawns one agent instance per ghost.** The host fans out, spawning N copies of an agent, each embodying one ghost. Rejected: the host would have to know each agent's intended roster size and kinds — exactly the agent-owned logic this decision keeps in the agent — and it multiplies process/deployment overhead.

**Reuse the dev token for agent self-spawn.** Fastest, zero new auth. Rejected: `GHOST_HOUSE_DEV_TOKEN` is explicitly sub-production (ADR-0009) and a bare shared secret handed to agents is the parallel-auth-path the constitution prohibits; ADR-0011 already defines the correct scoped-JWT replacement.

**Poll for the active session.** An agent could poll the discovery endpoint on an interval instead of awaiting an event. Rejected as the primary mechanism: wasteful and laggy; the `world.session.start` event already exists to be emitted. Polling remains an acceptable fallback only if event delivery is unavailable.

**Put self-spawn on world-api (alongside discovery).** Since discovery is a world-api read and `world.session.start` is emitted by the world server, self-spawn could live there too. Rejected: the spawn engine (`AgentSupervisor.spawn`) and agent supervision (token minting, health, A2A delivery) live in the agent-host; relocating spawn to world-api would duplicate that lifecycle logic across two services. Discovery is a read and belongs on the session-owning service; spawn is agent supervision and belongs on the host.

**Embed spawn logic in the host (per-agent config).** The host reads each agent's roster from config and spawns on session start. Rejected: couples the host to specific agents' logic and re-centralizes the decision this ADR deliberately moves into the agent.

## Consequences

**Easier:**
- Any future agent with an independent lifecycle (not just the NPC agent) self-spawns through one supported, scope-authenticated capability.
- Roster composition lives with the agent that owns it; the host stays generic.
- `world.session.start` becomes a real signal other features can also consume.
- New privileged spawn access is "one scope," consistent with ADR-0011.

**Harder / costs:**
- The agent-host gains an agent-facing privileged surface that must be guarded by the ADR-0011 scope check; until ADR-0011's `POST /oauth/token` lands, an interim scoped path is needed (tracked as a follow-up, must not regress to the dev token in production).
- The world server must emit `world.session.start` reliably at session begin; consumers must tolerate missing it (await + idempotent re-attach on restart).
- Self-spawn must be **idempotent across agent restarts** — deterministic per-`(session, character/ghost)` ids plus the host's duplicate-`ghostId` rejection — to avoid duplicate ghosts.
- **Requires updating `docs/architecture.md`:** the agent-host ↔ first-party-ghost link (architecture.md:212) to mention the agent-callable self-spawn capability, and the world-event surface to note `world.session.start` is now emitted. The single-session discovery decision is consistent with the existing `LIVE_SESSION_ID` "auto-discover single active session" behavior (architecture.md:109).

**Reversibility:** Moderately costly. This changes the agent-host control-flow contract and the ghost lifecycle expectation that downstream agents are built against. Reverting to orchestrator-only push after agents depend on self-spawn would require rewriting those agents' startup paths.

**Scope boundaries:**
- **MVP single session.** Multi-session discovery (an agent choosing *which* of several active sessions to join, and selection policy) is **deferred**; `GET /live?status=active` returns the single active session today, and an agent takes the first record.
- **First-party only.** Per ADR-0009, self-spawn credentials are issued to first-party agents intra-cluster. Third-party agent self-spawn inherits ADR-0009's deferral and ADR-0011's future third-party issuance path.
- RFC-0026 is the first consumer and carries the concrete endpoint shapes (`contracts/agent-spawn-endpoint.md`, `contracts/world-session-start.md`).

## Maintainer-Confirmed Resolutions (2026-06-10)

- **Credential timing — confirmed.** Self-spawn auth uses an ADR-0011 scoped token; an interim scoped credential is acceptable before `POST /oauth/token` lands, provided it does not reintroduce the dev token in production. The exact interim shape is settled during RFC-0026 implementation.
- **Session-start ownership — confirmed.** The **world server** emits `world.session.start` when a session becomes active (not the agent-host).
- **Discovery endpoint — resolved (no new endpoint).** Agents reuse the existing world-api `GET /live?status=active` list (the Intermedium client's source of the active session), per the Decision above.
