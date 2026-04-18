# IC-007: Ghost MCP `traverse` Tool Schema

**Contract ID**: IC-007  
**Feature**: 005-h3-coordinate-system  
**Status**: Draft  
**Consumers**: Ghost agents, `ghosts/tck`

---

## Summary

New MCP tool `traverse` allows a ghost to step through a named non-adjacent exit (elevator, portal) from its current cell. The exit must be listed in the `exits` response for the ghost's current cell.

---

## Tool Registration

```typescript
server.registerTool(
  "traverse",
  {
    description: "Step through a named non-adjacent exit (elevator, portal) from your current cell. Use exits to discover available named exits first.",
    inputSchema: {
      via: z.string().describe("The name of the exit to traverse, as shown by exits (e.g. 'elevator-b', 'pentagon-1')."),
    },
  },
  async ({ via }, extra) => runTool("traverse", { via }, traverseEffect(via, extra)),
);
```

---

## Input Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `via` | string | Yes | Exit name as returned by `exits` (case-sensitive) |

---

## Success Response

```typescript
interface TraverseSuccess {
  ok: true;
  via: string;          // exit name used
  from: string;         // h3Index of departure cell
  to: string;           // h3Index of destination cell
  tileClass: string;    // tileClass of destination cell
}
```

Text rendering:
```
Traversed elevator-b to 8f283082a992d25 (Lobby).
```

---

## Failure Responses

```typescript
type TraverseFailure =
  | { ok: false; code: "NO_EXIT";      reason: string }  // named exit not found at current cell
  | { ok: false; code: "UNKNOWN_CELL"; reason: string }  // ghost not on a known cell
  | { ok: false; code: "RULESET_DENY"; reason: string }  // movement rule blocks traversal
```

| Code | Condition |
|---|---|
| `NO_EXIT` | The named exit does not exist as a non-adjacent relationship from the current cell |
| `UNKNOWN_CELL` | Ghost position cannot be resolved (should not happen in normal operation) |
| `RULESET_DENY` | A movement rule explicitly denies this traversal |

---

## TCK Expectations

1. A ghost at a cell with a named exit calls `traverse { via: "elevator-b" }` → success, ghost position changes to destination.
2. A ghost calls `traverse { via: "nonexistent" }` → failure with `code: "NO_EXIT"`, ghost position unchanged.
3. A ghost calls `traverse` without calling `exits` first → behavior identical to case 2 (tool is stateless; the exit must exist regardless).
