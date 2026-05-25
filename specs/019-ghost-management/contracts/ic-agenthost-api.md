# Interface Contract: Agent-Host API Client

**Contract ID**: IC-AGENTHOST  
**Feature**: 019-ghost-management  
**File**: `tools/map-editor/src/services/agentHostClient.ts`  
**Implemented by**: Agent-host HTTP server at `VITE_AGENT_HOST_URL`

---

## Overview

The `agentHostClient.ts` service module wraps all agent-host REST calls used by the admin ghost management panel. All requests include `Authorization: Bearer <VITE_AGENT_HOST_BEARER>`.

Base URL: `import.meta.env.VITE_AGENT_HOST_URL` (e.g., `http://localhost:4000`)  
Auth header: `Authorization: Bearer <import.meta.env.VITE_AGENT_HOST_BEARER>`

---

## Catalog Endpoints

### `GET /v1/catalog`

List all registered agents.

**Request**: `GET {agentHostUrl}/v1/catalog`  
**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "agents": [
    {
      "agentId": "random-agent-abc12",
      "baseUrl": "http://random-agent:3000",
      "builtIn": true,
      "registeredAt": "2026-05-23T10:00:00Z",
      "agentCard": {
        "name": "Random Agent",
        "description": "Wanders randomly",
        "matrix": {
          "tier": "wanderer",
          "profile": { "about": "Wanders randomly across the hex grid." }
        }
      }
    }
  ]
}
```

**Errors**:
- `401` → `{ error: string, code: "UNAUTHORIZED" }` — bearer token invalid; surface banner "Agent host is not reachable — check VITE_AGENT_HOST_URL" (FR-013)
- Network failure → same banner

**Client function signature**:
```ts
async function listAgents(): Promise<AgentCatalogEntry[]>
```

---

### `GET /v1/catalog/:agentId`

Fetch the full A2A agent card for a single agent.

**Request**: `GET {agentHostUrl}/v1/catalog/{agentId}`  
**Headers**: `Authorization: Bearer <token>`

**Response** (200): Raw JSON of the full `AgentCard` object.

**Errors**:
- `404` → `{ error: string, code: "AGENT_NOT_FOUND" }`
- `401` → UNAUTHORIZED

**Client function signature**:
```ts
async function getAgentCard(agentId: string): Promise<unknown>
```

---

### `DELETE /v1/catalog/:agentId`

Deregister an agent. Fails if the agent has active sessions.

**Request**: `DELETE {agentHostUrl}/v1/catalog/{agentId}`  
**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{ "ok": true, "agentId": "random-agent-abc12" }
```

**Errors**:
- `409` → `{ error: "ActiveSessionsPreventDeregister", code: "ACTIVE_SESSIONS_PREVENT_DEREGISTER", count: N }` — surface inline: "Cannot deregister: N active sessions" (FR-005)
- `401` → UNAUTHORIZED

**Client function signature**:
```ts
async function deregisterAgent(agentId: string): Promise<void>
```

---

## Session Endpoints

### `GET /v1/sessions`

List all active ghost supervision sessions.

**Request**: `GET {agentHostUrl}/v1/sessions`  
**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "sessions": [
    {
      "sessionId": "01J...",
      "agentId": "random-agent-abc12",
      "ghostId": "ghost-xyz",
      "status": "running",
      "mcpToken": "REDACTED"
    }
  ]
}
```

**Important**: The `mcpToken` field is present in the raw response. The client MUST strip it before returning data to any UI component (FR-012).

**Client function signature**:
```ts
async function listGhostSessions(): Promise<GhostSessionRecord[]>
// GhostSessionRecord = { sessionId: string; agentId: string; ghostId: string; status: string }
```

---

### `POST /v1/sessions/spawn/:agentId`

Spawn a ghost into a running world session via an agent.

**Request**: `POST {agentHostUrl}/v1/sessions/spawn/{agentId}`  
**Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body**:
```json
{
  "ghostId": "ghost-xyz",
  "credential": {
    "token": "tok_abc123",
    "worldApiBaseUrl": "https://matrix.relateby.dev/mcp"
  }
}
```

**Response** (201):
```json
{
  "sessionId": "01J...",
  "agentId": "random-agent-abc12",
  "ghostId": "ghost-xyz",
  "mcpToken": "REDACTED"
}
```

**Important**: The `mcpToken` field in the response MUST NOT be stored or rendered in the UI.

**Errors**:
- `400` → `{ error: string, code: "VALIDATION_FAILED" }` — missing required fields
- `401` → UNAUTHORIZED
- `404` → `{ error: string, code: "AGENT_NOT_FOUND" }` — agentId not in catalog

**Client function signature**:
```ts
async function spawnGhost(agentId: string, ghostId: string, credential: {
  token: string;
  worldApiBaseUrl: string;
}): Promise<{ sessionId: string }>
```

---

### `DELETE /v1/sessions/:sessionId`

Shut down an active ghost session.

**Request**: `DELETE {agentHostUrl}/v1/sessions/{sessionId}`  
**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{ "ok": true, "sessionId": "01J..." }
```

**Errors**:
- `404` → `{ error: string, code: "SESSION_NOT_FOUND" }` — surface inline error on row (FR-009)
- `401` → UNAUTHORIZED

**Client function signature**:
```ts
async function shutdownGhostSession(sessionId: string): Promise<void>
```

---

## TypeScript Types

```ts
// tools/map-editor/src/services/agentHostClient.ts

const agentHostUrl = (import.meta.env.VITE_AGENT_HOST_URL ?? "http://localhost:4000").replace(/\/$/, "")
const agentHostBearer = import.meta.env.VITE_AGENT_HOST_BEARER ?? ""

export interface AgentCatalogEntry {
  agentId: string
  baseUrl: string
  builtIn: boolean
  registeredAt: string
  tier: "wanderer" | "listener" | "social"
  about: string
  agentCard: unknown  // full AgentCard JSON
}

export interface GhostSessionRecord {
  sessionId: string
  agentId: string
  ghostId: string
  status: string  // raw value; display unknown states as-is
}
```

---

## Error Handling Policy

- All functions throw a typed `AgentHostError` with `status: number` and `message: string`.
- Callers in UI components catch these and set component-level error state — no page reload.
- Network failures (DNS, CORS, offline) are caught and surfaced as the banner message per FR-013.
- The bearer token value is never included in error messages surfaced to the UI.
