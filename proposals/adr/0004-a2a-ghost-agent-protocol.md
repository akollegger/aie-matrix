# ADR-0004: A2A as the Ghost Agent Protocol

**Status:** proposed  
**Date:** 2026-04-23  
**Authors:** @akollegger  
**Related:** [ADR-0001](0001-mcp-ghost-wire-protocol.md) · [RFC-0005](../rfc/0005-ghost-conversation-model.md)

## Context

Ghosts must run autonomously — continuously making decisions about movement,
conversation, and goal pursuit — without requiring human input. The project
needs a protocol for how ghost agents are spawned, supervised, and fed world
events, and how they emit actions back into the world.

Two audiences shape this requirement simultaneously:

**The core team** needs a stable interface to build against: one canonical ghost
house that manages agent lifecycle, bridges Colyseus world events to agents, and
enforces behavioral contracts.

**Third-party contributors** (vendors, speakers, individuals) want to contribute
ghost agents without needing to understand Colyseus internals, the world server,
or the ghost house implementation. They want to ship a self-contained agent and
have it run in the world.

A further constraint emerged from the conversation model (RFC-0005): user
messages to a ghost travel through the same notification channel as ghost-to-ghost
messages — flagged by `role: "partner"` and `priority: PARTNER`. There is no
separate human-facing API. The ghost house does not sit in the user↔ghost path.

The existing ghost wire protocol (ADR-0001) already defines MCP as the interface
between a ghost and the world server — covering position queries, movement, and
world state inspection. The question this ADR resolves is what sits *above* that:
the interface between the ghost house and the agents it runs.

**Current limitations of the MCP-only architecture.** MCP is purpose-built for
synchronous agent→tool interaction. It has no native concept of agent lifecycle
(spawn, supervise, restart), no push channel for world events that arrive without
the agent asking (`message.new`, quest triggers, session notifications), and no
agent registry through which third parties can advertise and discover agents.
These gaps motivate introducing A2A *alongside* — not replacing — MCP. A2A is
designed for exactly these concerns: the A2A and MCP authors explicitly position
the two protocols as complementary ("MCP for tools, A2A for agents").

## Decision

Adopt **A2A (Agent-to-Agent protocol)** as the coordination and communication
interface between the ghost house and ghost agents, alongside the existing **MCP**
world interface defined in ADR-0001. The two protocols serve distinct, complementary
roles:

**MCP** is the ghost's world interface — how the ghost exists in and acts upon
the physical simulation:
- Position queries: `whoami`, `whereami`, `look`, `exits`
- Movement: `go`
- Physical world interactions: inventory, quest tokens

**A2A** is the ghost's social and coordination interface — how the ghost
communicates with others and how the house manages the agent:
- Lifecycle: spawn, supervise, shutdown, health
- Inbound events: `message.new`, quest triggers, session notifications
- Speech: `say` — outbound communication to other ghosts and partners

The boundary is: **MCP for being in the world, A2A for acting in the community.**

A conformant ghost agent may implement MCP only, A2A only, or both, depending
on the behavioral tier it targets:

| Tier | Protocols | Behavior |
|---|---|---|
| **Wanderer** | MCP only | Moves autonomously; deaf and mute socially |
| **Listener** | MCP + A2A receive | Moves and reacts to messages; does not speak |
| **Social** | MCP + A2A full | Moves, speaks, listens, and coordinates |

The Listener tier exists as a distinct level because observation-only agents
have legitimate uses: research probes that record conversations without
participating, dashboard feeds that visualize ambient social activity, and NPC
witnesses whose function is to react internally (e.g., update memory, trigger
quest state) without producing speech. Forcing these agents to implement `say`
would require them to either emit no-ops or stay silent under conditions the TCK
cannot verify. Making Listener a named tier makes non-speaking behavior testable
as a positive conformance property rather than an implementation omission.

The ghost house is the **sole A2A host**. It is not a protocol for others to
implement — it is canonical infrastructure maintained by the core team. There is
no multi-house federation.

Ghost agents are **A2A agents**. Third parties contribute by implementing an
agent at their chosen tier, publishing an agent card to the ghost house catalog,
and providing a reachable endpoint. The ghost house spawns and supervises their
agent for any ghost configured to use it.

The Colyseus bridge is an **internal implementation detail** of the ghost house.
Third-party agents never interact with Colyseus directly. MCP tools are proxied
through the house; A2A events are translated from Colyseus notifications by the
house.

`random-agent` (`ghosts/random-agent/`) is the **reference implementation** — a
Wanderer-tier agent implementing MCP only: random movement, no memory, no speech.
It is the simplest valid ghost agent. It ships with the core project, passes the
full TCK at Wanderer tier, and establishes the behavioral baseline against which
contributed agents are measured.

**Protocol version.** This ADR adopts **A2A protocol version 0.3.0**, matching
the current release of the official TypeScript SDK (`@a2a-js/sdk`). A2A v1.0.0
is in release-candidate stage under Linux Foundation governance; the ghost house
should track v1.0 adoption in the SDK and plan a version upgrade when stable.
Protocol version is negotiated via the `A2A-Version` header and declared in agent
cards' `protocolVersion` field.

**Authentication model deferred.** The credential flow between ghost house and
third-party agent endpoints — who authenticates to whom, what credential types
are supported (API key, OAuth 2.0, OpenID Connect per A2A's OpenAPI-aligned
security schemes), and whether the house offers sandboxed hosting for agents
without their own infrastructure — is deferred to a follow-up ADR. **This ADR is
not complete until that follow-up is accepted; the ghost house RFC (RFC-0007)
must not enter implementation before the auth ADR lands.**

## Rationale

**A2A fits the coordination problem natively.** A2A defines an agent host that
manages agent cards and exposes a task/message interface. The ghost house is
exactly an agent host. Ghost agents are exactly A2A agents. The ghost house
catalog is exactly an A2A agent registry. The mapping is 1:1 rather than an
adaptation.

**MCP and A2A are complementary, not overlapping.** MCP is purpose-built for
synchronous tool calls against a server — exactly what `look`, `exits`, and `go`
are. A2A is purpose-built for agent lifecycle, push notifications, and
coordination — exactly what `message.new`, `say`, and spawn/supervision are.
Using each for what it was designed for is preferable to forcing one protocol to
cover both concerns.

**`say` belongs in A2A, not MCP.** Incoming messages arrive via A2A push
(`message.new`). Outgoing speech departs via A2A action (`say`). The entire
conversation loop — receive, decide, respond — lives in one protocol. An agent
implementing conversational behavior never touches MCP. The boundary follows
semantic meaning: MCP for physical world acts, A2A for social acts.

**Behavioral tiers make the contribution surface legible.** A third party can
ship a Wanderer-tier agent (MCP only) with minimal implementation effort and
have a valid, running ghost. They can upgrade to Social tier when ready. The TCK
enforces each tier independently. This lowers the entry bar without lowering the
ceiling.

**`random-agent` as Wanderer baseline is honest and useful.** An MCP-only agent
that moves randomly makes no claims. Any Social-tier contributed agent can point
to specific behaviors — conversation, memory, goal pursuit — that differentiate
it. The baseline is testable and the comparison is fair.

**The Colyseus bridge stays internal.** Exposing it as a contribution surface
would couple third-party agents to Colyseus schema evolution. Hiding it behind
MCP and A2A means the world server can change its internals without breaking
contributed agents.

## Alternatives Considered

**MCP-only agent interface** — extending MCP to cover agent lifecycle, push
notifications, and speech was considered. MCP does not have native concepts of
agent cards, capability catalogs, push events, or agent hosting. It is well-suited
to synchronous tool calls but not to the reactive, event-driven coordination that
`message.new` and `say` require. A2A was designed for exactly these concerns.
Keeping MCP for world queries and movement — where it fits naturally — while
adding A2A for coordination gives each protocol its proper domain.

**A2A for everything including world queries** — moving `look`, `exits`, `go`
into A2A as tasks was considered. The cost: A2A adds latency and statefulness
overhead for what are synchronous reads and simple mutations. MCP is purpose-built
for this interaction pattern. The benefit (one protocol for agent implementors)
does not outweigh the fit penalty.

**Multiple ghost house implementations** — allowing third parties to run their
own houses would maximize flexibility. The coordination overhead — federation
protocol, shared ghost identity, cross-house presence — was judged not worth it
for a conference-scoped deployment. If the project continues beyond AIEWF 2026,
revisiting a federation model becomes reasonable.

**Custom agent protocol** — a bespoke event-in/action-out protocol specific to
the ghost world would be simpler to specify but would require third parties to
learn a proprietary interface with no transferable value. A2A is an open protocol
with growing tooling and ecosystem support.

## Consequences

**Easier:**
- Third-party contribution path is tiered and legible: Wanderer (MCP only) →
  Social (MCP + A2A), each independently testable via TCK
- Ghost house catalog has a standard schema (A2A agent cards + nested `matrix` extension object)
- Agent portability: a contributed agent could run in any A2A host, not just
  this one
- `random-agent` is a genuine minimal implementation — MCP only, no A2A
  dependency — useful as both a baseline and an onboarding example
- The conversation loop (receive `message.new`, respond via `say`) is entirely
  within A2A; conversational agents never need to touch MCP

**Harder:**
- The ghost house must implement and maintain two protocol bridges: MCP proxy
  (world queries and movement) and A2A host (lifecycle, events, speech)
- Social-tier agents emit state-mutating actions through two channels: `go` via
  MCP, `say` via A2A. Agent implementations need a routing layer that selects
  the correct protocol per action type; this is a real implementation cost the
  boundary imposes
- A2A is a relatively new protocol; tooling and library support varies by language
- The ghost house becomes a single point of failure; no redundancy through
  competing implementations

**Open questions deferred to implementation:**
- Whether the A2A task model (discrete tasks) or streaming model (continuous
  long-running task) better fits autonomous ghost behavior — or whether both are
  used for different interaction modes (autonomous movement loop vs. partner
  message interrupt)
- The `matrix` agent card extension object (tier, ghost classes, tools, profile,
  authors, etc.) — defined in the ghost house RFC
- Capability manifest format: what the house advertises as available to agents it
  spawns (memory backends, available MCP tools, notification types)
