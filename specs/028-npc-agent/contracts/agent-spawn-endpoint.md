# Contract IC-006: Agent-Callable Roster Spawn Endpoint

**Owner**: `server/agent-host` · **New** (no equivalent exists today).

## Why new

`POST /v1/sessions/spawn/:agentId` ([app.ts:434](../../../server/agent-host/src/app.ts)) requires the host **dev token** and spawns one already-adopted ghost per call — it is for external orchestrators, not agents. This contract adds an agent-authenticated, roster-aware spawn path.

## Endpoint

```
POST /v1/sessions/spawn-roster/:agentId
Authorization: Bearer <agent session credential>   # scoped — NOT the host dev token, NOT a bare shared secret
Content-Type: application/json
```

### Request

```json
{
  "sessionId": "<live session id from world.session.start>",
  "characters": [
    { "characterId": "info-attendant", "displayName": "Ada the Info Attendant",
      "background": "Stationed at the info booth." }
  ]
}
```

### Response `200`

```json
{
  "spawned": [
    { "characterId": "info-attendant", "ghostId": "<deterministic>", "sessionId": "<session>", "ok": true }
  ],
  "failed": [
    { "characterId": "x", "reason": "duplicate-ghost-id" }
  ]
}
```

## Behavior

1. **Authenticate** the caller via its own scoped session credential (validated against host session/token maps registered at `SupervisorService.ts:426`). Reject otherwise `401`.
2. For each character: derive a deterministic `ghostId` from `(sessionId, characterId)` (restart-idempotent — R3), adopt the ghost (with `displayName` + `background`, IC-008), then invoke the existing `AgentSupervisor.spawn` engine (`SupervisorService.ts:331`).
3. A per-character failure (e.g. duplicate `ghostId` for an already-active session) is reported in `failed[]` and **does not abort** the rest (spec edge case). Returns the spawn result lists.

## Auth open item

If the agent's existing session token cannot authorize a host-control fan-out (it may be scoped to that ghost's world calls only), introduce a dedicated roster-spawn capability grant — **which requires a companion ADR** (RFC-0026 OQ#1). Confirm during implementation; do not add a parallel bare-secret path (Constitution Principle V).

## Downstream consumers

- `ghosts/npc-agent/src/roster/spawn-roster.ts` (caller).
- Spawn contexts delivered to the npc-agent gain `characterId` + `background` (IC-002/IC-008) so the executor maps each spawned ghost to its catalog character.
