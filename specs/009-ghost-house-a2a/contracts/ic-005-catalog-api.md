# IC-005: Catalog HTTP API

**Status**: Accepted  
**Consumers**: Third-party contributors (register/deregister agents), ghost assignment tooling (list agents), ghost adoption flow (trigger spawn), ghost house supervisor (shutdown sessions)  
**Source of truth**: RFC-0007 §Open Questions — "Catalog HTTP paths" (resolved by research.md §1)

## Purpose

Define the canonical HTTP API paths for the ghost house catalog service. These paths supersede the non-normative spike-008 placeholders.

## Endpoints

### External (contributor-facing)

#### `POST /v1/catalog/register`

Register a contributed agent.

**Request**:
```json
{
  "agentId": "my-agent",
  "baseUrl": "http://localhost:4002"
}
```

**Process**:
1. Validate `agentId` is non-empty, URL-safe, and not already registered
2. Fetch agent card from `{baseUrl}/.well-known/agent-card.json` (15s timeout)
3. Validate agent card per IC-001 (schema, tier, required tools)
4. Store as `CatalogEntry` (file-backed)

**Response (201 Created)**:
```json
{
  "ok": true,
  "agentId": "my-agent"
}
```

**Error responses**:
- `400` — invalid `agentId` or agent card validation failure; body includes field-level errors
- `409` — `agentId` already registered
- `502` — agent card fetch failed (unreachable or non-JSON)

---

#### `GET /v1/catalog`

List all registered agents.

**Response (200 OK)**:
```json
{
  "agents": [
    {
      "agentId": "random-agent",
      "baseUrl": "http://localhost:4001",
      "tier": "wanderer",
      "builtIn": true,
      "about": "Reference Wanderer agent: random movement, no memory, no speech."
    }
  ]
}
```

Response items include `agentId`, `baseUrl`, `tier`, `builtIn`, and `about` from `matrix.profile.about`.

---

#### `GET /v1/catalog/:agentId`

Retrieve the full agent card for a registered agent.

**Response (200 OK)**: Full IC-001 agent card JSON.

**Error**: `404` if `agentId` is not registered.

---

#### `DELETE /v1/catalog/:agentId`

Deregister an agent. Requires `Authorization: Bearer <token>`.

**Process**:
1. Validate auth token
2. Check no active sessions exist for this agent; if sessions are active, return `409` with session count
3. Remove from catalog file

**Response (200 OK)**:
```json
{ "ok": true, "agentId": "my-agent" }
```

**Error**: `404` if not found; `409` if active sessions prevent deregistration.

---

### Internal (house-to-house, adoption flow)

#### `POST /v1/sessions/spawn/:agentId`

Spawn a registered agent for an adopted ghost. Called by the ghost adoption flow (not directly by contributors).

**Request**:
```json
{
  "ghostId": "01JXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Process**:
1. Resolve agent card by `agentId`
2. Validate `matrix.capabilitiesRequired` against house manifest
3. Mint ephemeral ghost-scoped token
4. Create `AgentSession` (status: `spawning`)
5. Send IC-006 spawn context to agent as first A2A task
6. On spawn-ack: transition session to `running`

**Response (201 Created)**:
```json
{
  "sessionId": "01JXXXXXXXXXXXXXXXXXXXXXXX",
  "agentId": "random-agent",
  "ghostId": "01JXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Error**: `404` agent not found; `503` agent unreachable; `422` capability requirements not met.

---

#### `DELETE /v1/sessions/:sessionId`

Gracefully shut down an active agent session. Called when a ghost is released.

**Process**:
1. Send graceful cancellation to agent (A2A cancel task)
2. Wait up to 10 seconds for agent acknowledgment
3. Hard-kill the session fiber if timeout exceeded
4. Remove `AgentSession` from supervisor

**Response (200 OK)**:
```json
{ "ok": true, "sessionId": "01JXXXXXXXXXXXXXXXXXXXXXXX" }
```

---

### Standard A2A Discovery

#### `GET /.well-known/agent-card.json`

The ghost house's own A2A agent card. Allows the house to participate in standard A2A agent discovery. Returns the house's capabilities, not the catalog of agents it hosts.

---

## Authentication (Phase 1)

All external endpoints require `Authorization: Bearer $GHOST_HOUSE_DEV_TOKEN`. The internal endpoints additionally require the caller to be a known internal process (validated by the same static token in Phase 1).

Production authentication is deferred to the auth ADR.

## Error Response Format

All error responses use:
```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

Known error codes: `INVALID_AGENT_ID`, `ALREADY_REGISTERED`, `AGENT_CARD_FETCH_FAILED`, `VALIDATION_FAILED`, `NOT_FOUND`, `ACTIVE_SESSIONS`, `CAPABILITY_UNMET`, `AGENT_UNREACHABLE`.
