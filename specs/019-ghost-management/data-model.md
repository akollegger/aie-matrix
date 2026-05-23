# Data Model: Admin Ghost Management Panel

**Feature**: 019-ghost-management  
**Source**: `specs/019-ghost-management/spec.md`, confirmed against `server/agent-host/src/types.ts` and `server/agent-host/src/app.ts`

---

## Entities

### WorldSession

A live Colyseus room instance. Consumed from the world API; displayed in the left sidebar under the session that owns it.

| Field        | Type     | Source                              | Notes                                              |
|--------------|----------|-------------------------------------|----------------------------------------------------|
| `id`         | `string` | `ServerSessionRecord.id`            | Colyseus room ID                                   |
| `name`       | `string` | `ServerSessionRecord.name`          | Human-readable session label                       |
| `status`     | `"active" \| "ended"` | `ServerSessionRecord.status` | Only `"active"` sessions are fetched (`GET /live?status=active`) |
| `startedAt`  | `string` | `ServerSessionRecord.startedAt`     | ISO 8601 timestamp                                 |
| `maps`       | `Array<{ mapId: string; role: string; gcsPath: string }>` | `ServerSessionRecord.maps` | Primary map is the one with `role === "primary"` |

`ServerSessionRecord` is already defined in `tools/map-editor/src/services/mapServer.ts` — no new type needed.

**Derived**: `worldApiBaseUrl` is not a per-session field; it equals `VITE_API_BASE_URL` (global build-time config).

---

### AgentCatalogEntry

A registered ghost agent known to the agent-host. Returned by `GET /v1/catalog`.

| Field         | Type                          | Source                                       | Notes                                               |
|---------------|-------------------------------|----------------------------------------------|-----------------------------------------------------|
| `agentId`     | `string`                      | `CatalogEntry.agentId`                       | URL-safe, unique identifier                         |
| `baseUrl`     | `string`                      | `CatalogEntry.baseUrl`                       | Agent's HTTP base URL                               |
| `builtIn`     | `boolean`                     | `CatalogEntry.builtIn`                       | True for first-party agents (ADR-0009)              |
| `registeredAt`| `string`                      | `CatalogEntry.registeredAt`                  | ISO 8601 timestamp                                  |
| `tier`        | `"wanderer" \| "listener" \| "social"` | `CatalogEntry.agentCard.matrix.tier` | Extracted from the agent card's `matrix` extension  |
| `about`       | `string`                      | `CatalogEntry.agentCard.matrix.profile.about`| One-line agent description                          |
| `agentCard`   | `AgentCard`                   | `CatalogEntry.agentCard`                     | Full A2A agent card — shown on row expand           |

**Type to create**: `AgentCatalogEntry` in `tools/map-editor/src/services/agentHostClient.ts`.

Response shape from `GET /v1/catalog`:
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
        "matrix": {
          "tier": "wanderer",
          "profile": { "about": "Wanders randomly across the hex grid." }
        }
      }
    }
  ]
}
```

---

### GhostSession

An active supervision session pairing a ghost identity with a running agent. Returned by `GET /v1/sessions`.

| Field       | Type                                                                    | Source              | Notes                                      |
|-------------|-------------------------------------------------------------------------|---------------------|--------------------------------------------|
| `sessionId` | `string`                                                                | `AgentSession.sessionId` | ULID                                  |
| `agentId`   | `string`                                                                | `AgentSession.agentId` | References an `AgentCatalogEntry`        |
| `ghostId`   | `string`                                                                | `AgentSession.ghostId` | Registry ghost identity                  |
| `status`    | `"spawning" \| "running" \| "unhealthy" \| "restarting" \| "failed" \| "shutdown"` | `AgentSession.status` | Display raw value for unknown states |

**Excluded from UI**: `mcpToken` — MUST NOT render anywhere (FR-012).

Response shape from `GET /v1/sessions`:
```json
{
  "sessions": [
    {
      "sessionId": "01J...",
      "agentId": "random-agent-abc12",
      "ghostId": "ghost-xyz",
      "status": "running"
    }
  ]
}
```

---

### GhostCredential

The set of inputs needed to spawn a ghost. Acquired automatically via the registry API chain; never entered manually by the operator.

| Field            | Type     | Source                       | Notes                                                   |
|------------------|----------|------------------------------|---------------------------------------------------------|
| `ghostId`        | `string` | Registry `/registry/adopt` response | Persistent ghost identity                          |
| `token`          | `string` | Registry `/registry/adopt` response | Bearer token for world API                         |
| `worldApiBaseUrl`| `string` | `VITE_API_BASE_URL`          | MCP endpoint for the world API                         |

Used as the body for `POST /v1/sessions/spawn/:agentId`:
```json
{
  "ghostId": "ghost-xyz",
  "credential": {
    "token": "tok_abc123",
    "worldApiBaseUrl": "https://matrix.relateby.dev/mcp"
  }
}
```

---

### AdminSelection (UI State)

Tracks which item is selected in the Miller columns drill-down. Lives in the `useAdminSelection` hook; not persisted across page loads.

| Field                 | Type            | Notes                                                  |
|-----------------------|-----------------|--------------------------------------------------------|
| `selectedSessionId`   | `string \| null`| Colyseus session ID; opening opens `CatalogPanel`      |
| `selectedAgentId`     | `string \| null`| Agent ID; opening opens `GhostListPanel`               |
| `selectedGhostSessionId` | `string \| null` | Ghost session ID; opens detail in `DetailPanel`   |

State transitions:
- Clicking a session: `selectedSessionId = id`, `selectedAgentId = null`, `selectedGhostSessionId = null`
- Clicking an agent in `CatalogPanel`: `selectedAgentId = id`, `selectedGhostSessionId = null`
- Clicking a ghost session in `GhostListPanel`: `selectedGhostSessionId = id`
- Pressing Esc or clicking ✕ on `GhostListPanel`: `selectedAgentId = null`
- Pressing Esc or clicking ✕ on `CatalogPanel`: `selectedSessionId = null`

---

### SpawnRequest (UI State)

Transient form state used during ghost spawning. Lives in `CatalogPanel`; not persisted.

| Field          | Type     | Notes                                                              |
|----------------|----------|--------------------------------------------------------------------|
| `agentId`      | `string` | The agent being spawned into; fixed when form opens                |
| `caretakerName`| `string` | Auto-generated three-word name (e.g., "fluffy-teal-mongoose")      |
| `status`       | `"idle" \| "spawning" \| "success" \| "error"` | Controls button state and result display |
| `spawnedSessionId` | `string \| null` | Populated on success; displayed inline          |
| `errorMessage` | `string \| null` | Populated on failure                                  |

---

## Relationships

```
Map (AdminPanel left sidebar)
 └─ WorldSession (click opens CatalogPanel)
     └─ AgentCatalogEntry (click opens GhostListPanel; "Spawn" creates GhostSession via registry chain)
         └─ GhostSession (click shows detail in DetailPanel; "Shutdown" deletes)
```

---

## New Types Location

| Type                  | File                                                  |
|-----------------------|-------------------------------------------------------|
| `AgentCatalogEntry`   | `tools/map-editor/src/services/agentHostClient.ts`    |
| `GhostSessionRecord`  | `tools/map-editor/src/services/agentHostClient.ts`    |
| `AdminSelection`      | `tools/map-editor/src/hooks/useAdminSelection.ts`     |
| `SpawnRequest`        | `tools/map-editor/src/panels/admin/CatalogPanel.tsx`  |
