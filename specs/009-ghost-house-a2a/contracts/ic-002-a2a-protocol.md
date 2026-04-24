# IC-002: A2A Protocol Version Contract

**Status**: Accepted  
**Consumers**: Ghost house A2A host, all ghost agents, TCK  
**Source of truth**: [ADR-0004 §Decision](../../../proposals/adr/0004-a2a-ghost-agent-protocol.md)

## Purpose

Pin the A2A protocol version used between the ghost house and ghost agents, define SDK version constraints, and document the interaction patterns validated in spike-008 that agents must follow.

## Protocol Version

**A2A protocol version**: `0.3.0`

- Declared in agent cards' `protocolVersion` field: `"0.3.0"`
- Negotiated via `A2A-Version: 0.3.0` HTTP header on all house↔agent requests
- The ghost house serves as the A2A host; agents are A2A clients

**SDK reference**: `@a2a-js/sdk` ≥ 0.3.13 (version exercised in spike-008 without patches)

**Protocol upgrade path**: A2A v1.0.0 is in RC under Linux Foundation governance. Track SDK v1.0 adoption and plan upgrade when stable. The ghost house must bump `protocolVersion` in agent cards and update this contract when upgrading.

## Interaction Patterns

Three A2A interaction patterns are in use:

### 1. Streaming (long-running autonomous loop)

Used for: Wanderer movement loop and Listener/Social event reception.

- House opens a streaming task to the agent after spawn
- Agent processes the stream and may emit tool calls (MCP) or `say` actions (A2A)
- Stream stays open for the duration of the ghost session
- SDK: use SSE streaming

### 2. Discrete task (spawn + partner message interrupts)

Used for: spawn context delivery (IC-006) and partner message interrupts.

- House sends a task, agent processes it, task completes
- Task lifecycle: `submitted` → `working` → `completed` (or `failed`)
- SDK: non-blocking `sendMessage` + `setTaskPushNotificationConfig` before terminal state

### 3. Push notifications (Listener / Social tier)

Used for: world event delivery (IC-004) to Listener and Social agents.

**Critical invariant** (validated in spike-008): The house MUST call `setTaskPushNotificationConfig` on a task *before* the task reaches terminal state. Agents MUST NOT use blocking `sendMessage` when expecting push delivery. Violating this drops events silently.

## Authentication (Phase 1)

Phase 1 uses a static shared bearer token in both directions:

- Agent → house: `Authorization: Bearer $GHOST_HOUSE_DEV_TOKEN`
- House → agent: `Authorization: Bearer $GHOST_HOUSE_DEV_TOKEN`

The A2A SDK's `getToken` callback is wired to `() => process.env.GHOST_HOUSE_DEV_TOKEN` on both sides.

**This mechanism MUST NOT be used outside localhost deployments.** The auth ADR gates any non-local use.

## Interaction Anti-patterns (from spike-008)

- Do not use blocking `sendMessage` when expecting push delivery (drops events)
- Do not wire `getToken` to a static string in non-localhost contexts
- Occasional SDK console noise (`Task … not found`) on simple round-trips is a known UX issue, not a functional error

## TCK Validation

The TCK validates:
1. Agent card declares `protocolVersion: "0.3.0"`
2. Agent responds to `A2A-Version: 0.3.0` header without rejection
3. Agent handles streaming task for duration of ghost session
4. Listener/Social agents: house can deliver push events after non-blocking setup
