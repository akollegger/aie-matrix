# RFC-0007: Ghost House Architecture

**Status:** draft  
**Date:** 2026-04-23  
**Authors:** @akollegger  
**Related:** [ADR-0004](../adr/0004-a2a-ghost-agent-protocol.md) · [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md) · [RFC-0005](0005-ghost-conversation-model.md)

## Summary

Define the architecture of the canonical ghost house: the A2A host, MCP proxy,
Colyseus bridge, agent supervisor, and catalog service that together run ghost
agents in the Matrix world. Ghost agents — spawned, supervised, and fed events
by the house — are the unit of third-party contribution, per ADR-0004.

## Motivation

ADR-0004 adopts A2A as the ghost agent protocol and establishes behavioral tiers
(Wanderer, Listener, Social). The ADR decides *that* A2A is used; this RFC
decides *how* the ghost house is built to host agents at each tier and to
translate between their A2A interface and the Colyseus world.

Three audiences need this architecture to be legible:

**The core team** — to implement the house against a coherent design rather
than ad-hoc.

**Third-party contributors** — to understand what the house provides, what it
expects, and how to ship an agent that runs inside it.

**Reviewers** — to evaluate whether the scope is feasible for AIEWF 2026 and
where the implementation risks concentrate.

## Design

### Component Breakdown

The ghost house is a single service composed of five internal components:

**A2A Host**
The public-facing A2A server. Accepts agent card publications, exposes the
agent catalog, and delivers tasks/events to spawned agents. Implemented against
`@a2a-js/sdk` at A2A protocol v0.3.0. Handles streaming (SSE) for long-running
autonomous agent behavior and push notifications for event delivery.

**MCP Proxy**
Re-exposes the existing world-server MCP tools (`whereami`, `look`, `exits`,
`go`, inventory) to spawned agents. The proxy authenticates the agent against
the house, then forwards the call to the world server using the ghost's
credentials. Third-party agents never see the world server directly; they only
see the house's MCP endpoint.

**Colyseus Bridge**
The internal translation layer between world events and A2A events. Subscribes
to Colyseus rooms as the ghost house, receives proximity changes, message
fanouts, quest triggers, and session notifications, and translates each into
an A2A event pushed to the relevant agent. Outbound: receives `say` actions
from agents via A2A and emits them into Colyseus as conversation records.

**Agent Supervisor**
Manages agent lifecycle: spawn on ghost adoption, health checks, restart on
crash, graceful shutdown on ghost release. Enforces rate limits and resource
bounds. Routes events from the Colyseus Bridge to the correct agent instance.

**Catalog Service**
Stores and serves agent cards. Publishes the set of available agents so that a
ghost's partner (or class default) can select which agent implementation runs
the ghost. Supports built-in agents (shipped with the house, e.g.,
`random-agent`) and contributed agents (external endpoints registered by third
parties).

### Component Interaction

```
                   ┌───────────────────┐
                   │   World Server    │
                   │    (Colyseus)     │
                   └─────────┬─────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
         ┌────────▼────────┐   ┌────────▼────────┐
         │  Colyseus       │   │  MCP Proxy      │
         │  Bridge         │   │  (forwards to   │
         │  (events in,    │   │   world server) │
         │   say out)      │   │                 │
         └────────┬────────┘   └────────┬────────┘
                  │                     │
                  │   ┌─────────────────┤
                  ▼   ▼                 │
         ┌─────────────────┐   ┌────────┴────────┐
         │  Agent          │   │  A2A Host       │
         │  Supervisor     ├──►│  (serves agents,│
         │  (lifecycle,    │   │   catalog, SSE) │
         │   routing)      │   └────────┬────────┘
         └────────┬────────┘            │
                  │                     │
                  ▼                     ▼
         ┌────────────────────────────────────┐
         │         Spawned Ghost Agents       │
         │   (Wanderer / Listener / Social)   │
         └────────────────────────────────────┘
```

### Agent Card Schema

Ghost agents extend the standard A2A agent card with a single top-level object
`matrix` holding all Matrix-specific catalog metadata. Standard A2A fields
unchanged; `matrix` is optional for generic A2A tooling and **required** by the
ghost house catalog for contributed agents. Field names inside `matrix` use
camelCase (no `mx_` prefix).

```json
{
  "name": "random-agent",
  "description": "Reference Wanderer agent: random movement, no memory, no speech.",
  "protocolVersion": "0.3.0",
  "version": "0.1.0",
  "url": "http://ghost-house.matrix.local/agents/random-agent",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    { "id": "wander", "name": "Wander", "description": "Move to random adjacent cell" }
  ],
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],

  "matrix": {
    "schemaVersion": 1,
    "tier": "wanderer",
    "ghostClasses": ["any"],
    "requiredTools": ["whereami", "exits", "go"],
    "capabilitiesRequired": [],
    "memoryKind": "none",
    "llmProvider": "none",
    "profile": {
      "about": "The simplest possible ghost. Moves at random, never speaks, never listens. Useful as a reference implementation and for users who want a purely ambient presence."
    },
    "authors": ["@akollegger"]
  }
}
```

Key `matrix` fields (all under the `matrix` object):

| Path | Type | Description |
|---|---|---|
| `matrix.schemaVersion` | number | **1** for this RFC revision; bump when breaking `matrix` shape |
| `matrix.tier` | `"wanderer" \| "listener" \| "social"` | Declared conformance tier |
| `matrix.ghostClasses` | string[] | Ghost classes this agent supports (`["scavenger", "scholar"]` or `["any"]`) |
| `matrix.requiredTools` | string[] | MCP tools the agent calls; house validates these are available via the MCP proxy |
| `matrix.capabilitiesRequired` | string[] | House-provided capabilities the agent depends on (see Capability Manifest) |
| `matrix.memoryKind` | string | Descriptive: `"none" \| "keyvalue" \| "vector" \| "graph" \| ...`. Catalog metadata only; the agent provisions its own memory |
| `matrix.llmProvider` | string | Descriptive: `"none" \| "openai" \| "anthropic" \| "local" \| ...`. Catalog metadata only; the agent brings its own credentials |
| `matrix.profile` | object | Matchmaking-facing description. Contains at minimum `about` (freeform text). Reserved for future expansion (topics, personality, activities, tunable parameters) when the adoption experience is designed |
| `matrix.authors` | string[] | Contributor attribution for catalog display |

### Capability Manifest

The capability manifest advertises **shared infrastructure the house provides**
— things that must cross agent boundaries and therefore cannot be agent-owned.
Agents declare required capabilities via `matrix.capabilitiesRequired`; the house
validates these at spawn time and refuses to spawn an agent whose requirements
are not satisfied.

Initial capabilities:

- `telemetry.otlp` — OpenTelemetry collector endpoint for shared tracing and
  metrics across world server, ghost house, and spawned agents. Required for
  cross-boundary trace correlation.

**What the manifest intentionally does not include:**

- **Memory** — agents provision their own memory (vector store, key-value,
  knowledge graph, or none). Agent cards may declare `matrix.memoryKind` as
  catalog metadata for user-facing transparency, but the house provisions
  nothing.
- **LLM access** — agents bring their own credentials and choose their own
  provider. `matrix.llmProvider` is descriptive metadata only.
- **Quest access** — quest mechanics are MCP tools on the world server (e.g.,
  `quest.list`, `quest.progress`, `quest.claim`). Agents declare them via
  `matrix.requiredTools`; the MCP proxy validates availability. Quest access is
  not a new capability category.

This narrow definition of the manifest reinforces the protocol boundary from
ADR-0004: world interactions flow through MCP, coordination and events flow
through A2A, and agent-internal concerns (memory, model choice, prompting)
are the agent's own business. The house provides only what is genuinely
shared.

The manifest itself is surfaced as an A2A extension; its schema is deferred
to implementation.

### Spawn and Supervision Contract

**Spawn sequence** when a ghost is adopted and assigned an agent:

1. Catalog lookup: resolve agent card by `agentId`
2. Capability validation: check `matrix.capabilitiesRequired` against manifest
3. Credential provisioning: mint an ephemeral token scoped to this ghost
4. Agent initialization: POST to agent endpoint with spawn context (ghost id,
   ghost card, world entry point)
5. Subscription: Colyseus Bridge begins routing events to agent's A2A stream

**Supervision policy:**

- Health check: periodic A2A ping; timeout = 30s
- Restart on failure: exponential backoff, max 5 retries per hour
- Shutdown: graceful cancellation on ghost release; hard kill after 10s timeout
- Rate limiting: per-agent bounds on action emission (to be tuned empirically)

### Phased Delivery

**Phase 1 — Wanderer only (weeks 1-2)**
- A2A Host with catalog (Wanderer tier only)
- MCP Proxy forwarding to world server
- Agent Supervisor with spawn/shutdown
- `random-agent` passes TCK at Wanderer tier
- No Colyseus Bridge event routing yet (Wanderer doesn't need it)

**Phase 2 — Listener tier (weeks 3-4)**
- Colyseus Bridge: inbound event translation (`message.new`, proximity, quest)
- A2A push/streaming to agents
- TCK conformance tests for Listener tier
- Example Listener agent (e.g., `observer-agent`)

**Phase 3 — Social tier (weeks 5-6)**
- Outbound `say` routing from A2A to Colyseus
- Capability manifest surface exposed to agents
- TCK conformance tests for Social tier
- First contributed agent integrated (partner vendor)

Each phase produces a working system. Scope can be cut at any phase boundary
if the timeline tightens.

## Open Questions

**Authentication model** — gating question for implementation, per ADR-0004.
Credential flow, supported schemes, and whether the house offers sandboxed
hosting for agents without public endpoints. Needs a follow-up ADR before
Phase 1 implementation.

**Task model vs. streaming model** — for autonomous ghost behavior, is the
agent a single long-running A2A streaming task, or a series of discrete tasks
dispatched by the house? Partner message interrupts likely want discrete-task
semantics; autonomous movement likely wants streaming. The hybrid may be
natural but needs validation against the A2A SDK.

**Agent sandbox** — if third parties cannot host A2A endpoints themselves,
does the ghost house offer a container-based sandbox (Docker, WASM, V8
isolate) where they can upload code? This significantly expands scope and may
be out of scope for AIEWF 2026. Worth an explicit decision.

**Catalog persistence** — where does agent card state live? Options: in-memory
(restart loses contributed agents), file-backed (simple, good for weekend
event), database (over-engineered for this scope). Lean toward file-backed.

**Observability** — tracing agent behavior across house→MCP proxy→world
server→Colyseus bridge→agent is a non-trivial trace. Adopting A2A's OTLP
observability posture is probably the right answer, but requires a telemetry
stack decision that is currently open in `docs/architecture.md`.

## Alternatives

**Embed MCP inside A2A** — expose MCP tools as A2A tasks. Considered and
rejected in ADR-0004 alternatives. Covered there; not reopened here.

**Monolithic house (no internal component boundaries)** — skip the five-way
decomposition and build one module. Tempting at this scope but loses the
testability and phased-delivery benefits. The components above map cleanly to
Phase 1/2/3 scope.

**Agent hosting outside the ghost house** — defer the sandbox question by
requiring all third parties to host their own endpoints. This is simpler but
may limit contribution. Flagged as open question above.

## References

- [A2A Protocol Specification v0.3.0](https://a2a-protocol.org/latest/specification/)
- [@a2a-js/sdk (npm)](https://www.npmjs.com/package/@a2a-js/sdk)
- [ADR-0001: MCP Ghost Wire Protocol](../adr/0001-mcp-ghost-wire-protocol.md)
- [ADR-0004: A2A as the Ghost Agent Protocol](../adr/0004-a2a-ghost-agent-protocol.md)
- [RFC-0005: Ghost Conversation Model](0005-ghost-conversation-model.md)
