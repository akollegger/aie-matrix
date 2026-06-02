# IC-003: MCP Group Tools

**Package**: `server/world-api/src/mcp-server.ts`  
**Consumers**: Ghost agents (via `@aie-matrix/ghost-ts-client`), ghost TCK (`@aie-matrix/ghost-tck`)

All tools follow the existing JSON input / `CallToolResult` text output pattern used by `go`, `say`, `inventory`, `offer`, `agree`.

---

## `group.offer`

Initiate a shared exchange offer for group formation (ghost → ghost) or group join (ghost → existing group).

**Input schema**:
```json
{
  "to": "string",          // ghost_id OR group_id
  "resource": "string",    // resource type id, e.g. "trust"
  "amount": "integer",     // >= 0; 0 is a valid communication-only bond
  "expires_in": "integer"  // seconds until offer expires; default 300
}
```

**Success output** (text):
```
Offer created. offerId: 01J... Expires at: 2026-06-02T18:05:00Z.
```

**Error cases**:
- `to` is neither a known ghost nor a known group → `"Unknown counterparty"`
- `amount < 0` → `"Amount must be non-negative"`
- Ghost has insufficient resources (non-zero amount) → `"Insufficient {resource}"`
- Target ghost is the same as the calling ghost → `"Cannot offer to yourself"`

---

## `group.vote`

Cast an accept or reject vote on a pending group admission offer.

**Input schema**:
```json
{
  "group_id": "string",
  "offer_id": "string",
  "decision": "accept" | "reject"
}
```

**Success output** (text):
```
Vote recorded. Outcome: pending.
```
or (if vote tips the majority):
```
Vote recorded. Outcome: admitted. ghost_C has joined the group.
```
or:
```
Vote recorded. Outcome: rejected.
```

**Error cases**:
- Caller is not a member of the group → `"Not a member of group {group_id}"`
- `offer_id` not found → `"Offer not found or already resolved"`
- Offer has expired → `"Offer has expired"`

---

## `group.leave`

Voluntarily leave a group and recover contributed resources.

**Input schema**:
```json
{
  "group_id": "string"
}
```

**Success output** (text):
```
Left group {name}. Returned: 10 trust to your bag.
```
or (if last member):
```
Left group {name}. Returned: 10 trust to your bag. Group dissolved.
```

**Error cases**:
- Group not found → `"Group not found"`
- Caller is not a member → `"Not a member of group {group_id}"`

---

## `group.say`

Post a message to a group chat thread.

**Input schema**:
```json
{
  "group_id": "string",
  "content": "string"
}
```

**Success output** (text):
```
Message sent to group {name}. Delivered to 3 members/participants.
```

**Error cases**:
- Group not found or dissolved → `"Group not found or dissolved"`
- Caller is neither member nor participant → `"Not a member or participant of group {group_id}"`

---

## `group.list`

List groups the calling ghost currently belongs to.

**Input schema**: `{}` (no parameters)

**Success output** (text):
```
You are a member of 2 group(s):
- "Amber Foxes" (group_id: 01J...) — 3 members, contributed: 10 trust
- "Blue Raccoons" (group_id: 01J...) — 2 members, contributed: 10 trust
```
or if no memberships:
```
You are not a member of any group.
```

**Error cases**: None (always succeeds; may return empty list).

---

## TCK Contract Expectations

The ghost TCK (`ghosts/tck/`) must be extended with tests covering:
1. `group.offer` between two ghosts produces a group with both as members.
2. `group.vote` admit path produces a member edge and allows `group.say`.
3. `group.leave` returns resources and removes the membership.
4. `group.say` delivers to all members via inbox notification.
5. `group.list` reflects current membership state.
