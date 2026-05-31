# IC-003: MCP `inventory` Tool

**Owner**: `server/world-api/src/mcp-server.ts`  
**Consumers**: Ghost agents (autonomous clients via MCP)

## Tool Definition

```ts
{
  name: "inventory",
  description: "Return the current resource holdings for the calling actor (or another actor subject to read policy).",
  inputSchema: {
    type: "object",
    properties: {
      actorId: {
        type: "string",
        description: "Optional. The actor whose inventory to inspect. Defaults to the calling ghost's actor ID. Subject to read policy."
      }
    },
    required: []
  }
}
```

## Response

### Success
```json
{
  "ok": true,
  "actorId": "ghost-abc123",
  "holdings": [
    { "resource": "gold",  "qty": 15, "label": "Gold" },
    { "resource": "xp",    "qty": 240, "label": "Experience" }
  ]
}
```

### Error — Unknown Actor
```json
{ "ok": false, "error": "UNKNOWN_ACTOR", "actorId": "ghost-xyz" }
```

### Error — Read Policy Denied
```json
{ "ok": false, "error": "READ_POLICY_DENIED", "resource": "exam-token" }
```

## Read Policy

| Policy | Visible to |
|---|---|
| `public` | Any actor |
| `self` | Only the owning actor |
| `group` | Deferred — requires Group Formation RFC |

Resource types declare their read policy in the map grammar. Default is `public` for MVP.
