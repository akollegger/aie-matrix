# Contract: GET /v1/roster

**Owner**: Each ghost agent that sets `matrix.rosterAgent: true`  
**Consumers**: `server/agent-host` — `SupervisorService.spawnRosterForAgent`  
**Existing conformer**: `ghosts/npc-agent` (reference implementation)  
**New conformer**: `ghosts/random-agent` (this feature)

## Request

```
GET /v1/roster
```

No authentication required (public endpoint on the agent process).

## Response

```
HTTP 200 OK
Content-Type: application/json

Array<RosterEntry>
```

```ts
type RosterEntry = {
  characterId: string;   // stable, unique within this agent's roster
  displayName: string;   // human-readable label shown in the world
  background?: string;   // optional flavor text passed into the spawn context
}
```

Empty array `[]` is valid (means "nothing to spawn").

## random-agent behavior

- Returns `N` entries where `N = parseInt(process.env.RANDOM_AGENT_COUNT, 10) || 10`
- `characterId`: `"wanderer-1"` … `"wanderer-N"`
- `displayName`: `"Wanderer 1"` … `"Wanderer N"`
- No `background` field

## Idempotency note

`spawnRosterForAgent` calls `POST /registry/ghosts` to provision a fresh ghostId per entry on each invocation. The `characterId` field is carried into the spawn context's `ghostCard` but is not used as a deduplication key by the registry. Repeated calls with the same `characterId` will provision distinct ghosts — this is intentional for wanderers (fungible) and acceptable for NPCs (supervisor's `ghostId already has an active session` guard prevents double-spawning the same ghost).
