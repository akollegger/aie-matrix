# IC-005: MCP Tools — `offer` and `request`

**Server**: `server/world-api` MCP server  
**Reference**: `docs/mcp-tools.md` (update required)

## `offer` (field rename only)

```
Tool: offer
Input:
  to:        string   — target ghost ID or display name
  give_item: string   — itemRef to give  (was: give_resource)
  give_qty:  integer  — quantity to give
  for_item:  string   — itemRef to receive  (was: for_resource)
  for_qty:   integer  — quantity to receive (0 = gift, no return expected)

Behaviour: unchanged — creates a pending Proposal; counterparty calls agree/decline
```

## `request` (field rename only)

```
Tool: request
Input:
  from:           string  — ghost ID or display name to request from
  want_item:      string  — itemRef to receive  (was: want_resource)
  want_qty:       integer
  offering_item:  string  — itemRef to give in exchange  (was: offering_resource)
  offering_qty:   integer

Behaviour: unchanged — symmetric of offer; same ProposalService.propose() path
```

## Validation change

Previously validated via `ledger.resourceTypes()`. Now validated via `ItemService.getSidecar().has(itemRef)`. Behaviour is identical: unknown itemRef returns an error before the proposal is created.

## No changes to `agree`, `decline`

These tools operate on proposal IDs and call through to the ledger unchanged.
