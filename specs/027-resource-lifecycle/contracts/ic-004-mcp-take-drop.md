# IC-004: MCP Tools — `take` and `drop`

**Server**: `server/world-api` MCP server  
**Reference**: `docs/mcp-tools.md` (update required)

## `take`

```
Tool: take
Input:  { itemRef: string }
Output: { name: string; message: string }

Pre-conditions (checked before ledger commit):
  1. ItemType exists in sidecar (WorldApiItemNotFound)
  2. itemRef is present on ghost's current tile (WorldApiItemNotHere)
  3. ItemType.takeable === true (WorldApiItemNotCarriable)
  4. world@{h3Index} bag balance >= 1 (LedgerInsufficientFunds — race condition guard)

Ledger commit on success:
  Transfer { resource: itemRef, qty: 1, from: "world@{h3Index}", to: ghostId,
             location: { h3Index }, cause: "take" }

Post-commit (synchronous, same fiber):
  bridge.setTileItems(h3Index, updatedRefs)
  bridge.setGhostInventory(ghostId, updatedInv)
```

## `drop`

```
Tool: drop
Input:  { itemRef: string }
Output: { message: string }

Pre-conditions (checked before ledger commit — MCP layer):
  1. Ghost holds itemRef (WorldApiItemNotCarrying)
  2. Tile capacity not exceeded after drop (WorldApiTileFull)

Ledger commit on success:
  Transfer { resource: itemRef, qty: 1, from: ghostId, to: "world@{h3Index}",
             location: { h3Index }, cause: "drop" }

Post-commit (synchronous, same fiber):
  bridge.setGhostInventory(ghostId, updatedInv)
  bridge.setTileItems(h3Index, updatedRefs)
```

## Schema changes from prior version

- Tool names unchanged (`take`, `drop`)
- No new input parameters
- Error set adds `LedgerInsufficientFunds` to `take` (race condition guard)
