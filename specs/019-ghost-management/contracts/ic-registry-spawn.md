# Interface Contract: Registry Spawn Orchestration

**Contract ID**: IC-REGISTRY-SPAWN  
**Feature**: 019-ghost-management  
**File**: `tools/map-editor/src/services/registryClient.ts`  
**Implemented by**: World API server at `VITE_API_BASE_URL` (registry endpoints are on the same server as the world API)

---

## Overview

The `registryClient.ts` module orchestrates the four-step "one-click spawn" flow. It:
1. Creates a house record in the registry
2. Creates a caretaker with an auto-generated name
3. Adopts (pairs) the caretaker to the house to get a `ghostId` + `token`
4. POSTs the spawn request to the agent-host

All registry endpoints are open (no authentication required). The agent-host spawn call uses `VITE_AGENT_HOST_BEARER`.

---

## Registry Endpoints (all unauthenticated)

Base URL: same as `VITE_API_BASE_URL` — e.g., `https://matrix.relateby.dev` or `http://localhost:8787`

### Step 1: `POST /registry/houses`

Register a ghost house (a slot for a ghost identity).

**Request body**:
```json
{ "displayName": "random-agent-abc12" }
```
(`displayName` is set to the `agentId` being spawned into)

**Response** (201):
```json
{ "agentHostId": "house_abc123" }
```

---

### Step 2: `POST /registry/caretakers`

Register a caretaker (the ghost's "owner" identity).

**Request body**:
```json
{ "label": "fluffy-teal-mongoose" }
```
(`label` is auto-generated via `unique-names-generator`; must be unique per spawn — never reuse across calls)

**Response** (201):
```json
{ "caretakerId": "caretaker_xyz789" }
```

**Constraint**: One ghost per caretaker (`CARETAKER_ALREADY_HAS_GHOST`). Each spawn MUST generate a new caretaker with a new name.

---

### Step 3: `POST /registry/adopt`

Pair a caretaker with a house to create a ghost identity and issue a world API token.

**Request body**:
```json
{ "caretakerId": "caretaker_xyz789", "agentHostId": "house_abc123" }
```

**Response** (201):
```json
{
  "ghostId": "ghost-xyz",
  "credential": {
    "token": "tok_abc123",
    "worldApiBaseUrl": "https://matrix.relateby.dev/mcp"
  }
}
```

Note: `worldApiBaseUrl` in the adopt response points to the world MCP endpoint. This is used as `credential.worldApiBaseUrl` in the agent-host spawn call.

---

### Step 4: `POST /v1/sessions/spawn/:agentId` (agent-host)

Covered in `ic-agenthost-api.md`. Receives the `ghostId` and `credential` from Step 3 plus requires the `Authorization: Bearer <VITE_AGENT_HOST_BEARER>` header.

---

## Orchestration Function

```ts
// tools/map-editor/src/services/registryClient.ts

import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
import { spawnGhost } from "./agentHostClient"

export async function oneClickSpawn(agentId: string): Promise<{ sessionId: string; ghostId: string }> {
  const registryBase = worldApiUrl  // same as VITE_API_BASE_URL

  // Step 1: house
  const { agentHostId } = await postJson<{ agentHostId: string }>(
    `${registryBase}/registry/houses`,
    { displayName: agentId }
  )

  // Step 2: caretaker with unique name
  const caretakerName = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: "-",
    length: 3,
  })
  const { caretakerId } = await postJson<{ caretakerId: string }>(
    `${registryBase}/registry/caretakers`,
    { label: caretakerName }
  )

  // Step 3: adopt
  const { ghostId, credential } = await postJson<{
    ghostId: string
    credential: { token: string; worldApiBaseUrl: string }
  }>(`${registryBase}/registry/adopt`, { caretakerId, agentHostId })

  // Step 4: spawn via agent-host
  const { sessionId } = await spawnGhost(agentId, ghostId, credential)

  return { sessionId, ghostId }
}
```

---

## Error Handling

| Error Condition                  | Behavior                                                             |
|----------------------------------|----------------------------------------------------------------------|
| Step 1–3 network failure         | Throw; display inline error on Spawn button area (FR-005/FR-015)    |
| `CARETAKER_ALREADY_HAS_GHOST`    | Should not occur (each spawn generates a new caretaker name), but if it does, retry with a new name (max 3 attempts) |
| Step 4 agent-host 401            | Display "Agent host is not reachable — check VITE_AGENT_HOST_URL"  |
| Step 4 agent-host 404            | Display inline error: "Agent not found in catalog"                  |
| Any partial failure              | No cleanup of partial registry state (houses/caretakers are cheap) |

---

## Name Generation

The `unique-names-generator` package is used with built-in dictionaries:
- **Dictionaries**: `adjectives`, `colors`, `animals` (all built into the package)
- **Separator**: `"-"` (hyphen)
- **Length**: 3 words
- **Example output**: `"fluffy-teal-mongoose"`, `"ancient-silver-falcon"`
- **Install**: `pnpm add unique-names-generator` in `tools/map-editor/`

The generated name is only used as the caretaker label — it is not shown in the UI.

---

## Environment Variable Contract

| Variable             | Required | Default (dev)           | Purpose                                      |
|----------------------|----------|-------------------------|----------------------------------------------|
| `VITE_API_BASE_URL`  | Yes      | `http://localhost:8787` | World API + registry base (already present)  |
| `VITE_AGENT_HOST_URL`| Yes      | `http://localhost:4000` | Agent-host base URL (new)                    |
| `VITE_AGENT_HOST_BEARER` | Yes  | *(empty)*               | Bearer token for agent-host auth (new)       |

The new variables must be added to `tools/map-editor/.env.example` and the CI/CD workflow.
