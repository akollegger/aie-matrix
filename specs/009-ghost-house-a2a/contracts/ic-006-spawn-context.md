# IC-006: Spawn Context

**Status**: Accepted  
**Consumers**: Ghost house agent supervisor (produces), ghost agents all tiers (consume at spawn)  
**Source of truth**: RFC-0007 §Spawn and Supervision Contract (adapted — delivery via A2A task per research.md §3)

## Purpose

Define the payload sent by the ghost house to a ghost agent immediately after the agent session is created. The spawn context gives the agent everything it needs to begin operating: its ghost identity, starting position, house endpoints, and authentication token.

## Delivery Mechanism

The spawn context is delivered as the **first A2A task** sent to the agent after the session is established. The house sends a discrete A2A task whose `data` part contains the spawn context JSON. The agent MUST acknowledge by completing the task before the house transitions the session from `spawning` to `running`.

This replaces the raw POST described in RFC-0007 §Spawn step 4 with the A2A SDK task channel, which is more natural (reuses auth headers, error handling, and the SDK's message envelope) per research.md §3.

## Spawn Context JSON (in A2A task `data` part)

```json
{
  "schema": "aie-matrix.ghost-house.spawn-context.v1",
  "ghostId": "01JXXXXXXXXXXXXXXXXXXXXXXX",
  "ghostCard": {
    "class": "wanderer",
    "displayName": "Ghost-42",
    "partnerEmail": null
  },
  "worldEntryPoint": "8f2830828052d25",
  "houseEndpoints": {
    "mcp": "http://ghost-house.local/v1/mcp",
    "a2a": "http://ghost-house.local/"
  },
  "token": "eyJ...",
  "expiresAt": "2026-04-25T12:00:00.000Z"
}
```

## Field Rules

| Field | Type | Rule |
|-------|------|------|
| `schema` | string | Must be `"aie-matrix.ghost-house.spawn-context.v1"` |
| `ghostId` | ULID string | The ghost this session serves; unique per ghost |
| `ghostCard.class` | string | Ghost class (e.g., `"wanderer"`, `"scavenger"`, `"scholar"`) |
| `ghostCard.displayName` | string | Human-readable ghost name for display purposes |
| `ghostCard.partnerEmail` | string \| null | IRL attendee email if the ghost has been adopted; `null` for unpartnered ghost |
| `worldEntryPoint` | H3 res-15 index | Ghost's starting cell; must be a valid navigable cell |
| `houseEndpoints.mcp` | string | URL of the house MCP proxy endpoint; agent connects here for `whereami`, `go`, etc. |
| `houseEndpoints.a2a` | string | URL of the house A2A host; agent registers here for events |
| `token` | string | Ephemeral bearer token scoped to this ghost session; use in `Authorization: Bearer <token>` for all house connections |
| `expiresAt` | ISO-8601 UTC string | Token expiry; agent SHOULD refresh or re-spawn before expiry |

## Agent Acknowledgment

The agent MUST complete the spawn task (return a successful task result) within 30 seconds. The spawn task result body is not inspected by the house beyond the task status — an empty `{}` is acceptable.

If the agent fails the spawn task or does not respond within 30 seconds, the session is marked `failed` and the supervisor applies the restart policy.

## Token Scope

The `token` field is scoped to exactly one ghost and one session. It authorizes:
- MCP proxy calls at `houseEndpoints.mcp` (authenticated as this ghost)
- A2A host interactions at `houseEndpoints.a2a` (session auth)

In Phase 1, `token` is always `GHOST_HOUSE_DEV_TOKEN`. In production (post-auth ADR), the house mints a short-lived JWT or similar credential.

## Versioning

The `schema` field is the version discriminant. Agents MUST reject spawn contexts with unknown `schema` values and fail the spawn task with an error message indicating the unsupported schema version. The house interprets task failure as a spawn error and applies the retry policy.

## TCK Validation

The Wanderer TCK validates:
1. Agent receives a spawn task within 5 seconds of registration
2. Spawn task `data` part parses as valid IC-006 JSON
3. Agent completes the spawn task within 30 seconds
4. After spawn ack, agent begins calling MCP tools at `houseEndpoints.mcp`
5. MCP calls from the agent use the `token` from the spawn context
