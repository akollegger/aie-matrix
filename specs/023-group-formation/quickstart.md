# Quickstart: Group Formation and Group Chat

## Prerequisites

- Server running: `pnpm dev` from repo root
- Two registered ghosts on the map (`ghost_A`, `ghost_B`)
- Both ghosts in proximity (same H3 tile) — required by the formation offer proximity check
- No Neo4j required for the smoke tests — the server uses an in-memory GroupService by default

The default map (`redbluegreen`) seeds one resource: `gold`. Use `gold` in all examples below unless you are running a map that defines a different resource.

---

## Smoke Test: Form a Group

### 1. Ghost A offers group formation

```bash
# Call via ghost-ts-client, ghost-cli, or the MCP inspector
group.offer({ to: "<ghost_B_id>", resource: "gold", amount: 1, expires_in: 120 })
# Returns: { ok: true, proposalId: "01J...", expiresAt: "...", type: "formation" }
```

The `group.offer` for formation goes through the existing offer/agree handshake. `proposalId` is the value ghost_B needs to accept.

### 2. Ghost B accepts

```bash
agree({ proposalId: "<proposalId>" })
# Returns: { ok: true, proposalId: "...", status: "agreed" }
# Side effect: a Group actor is created, both ghosts have MEMBER_OF edges,
#              a {group_id}.jsonl thread is initialized in CONVERSATION_DATA_DIR
```

### 3. Verify membership

```bash
group.list({})
# Returns: { ok: true, groups: [{ groupId: "01J...", name: "Amber Foxes", memberCount: 2, myContribution: { resource: "gold", amount: 1 } }], message: "You are a member of 1 group(s): ..." }
# Run for both ghost_A and ghost_B — both should see the same group
```

### 4. Send group chat messages

```bash
group.say({ group_id: "<group_id>", content: "Hello from A" })
# Returns: { ok: true, messageId: "01J...", deliveredTo: 1 }

inbox({})
# Run as ghost_B — expect a notification with thread_id = group_id
# Returns: { notifications: [{ thread_id: "<group_id>", message_id: "..." }] }
```

---

## Smoke Test: Join an Existing Group

### 1. Ghost C proposes to join

Ghost C must exist and be registered. No proximity requirement for join offers.

```bash
# As ghost_C:
group.offer({ to: "<group_id>", resource: "gold", amount: 1, expires_in: 120 })
# Returns: { ok: true, offerId: "01J...", expiresAt: "...", type: "join" }
# Side effect: system message posted to group chat — ghost_A and ghost_B receive inbox notification
```

### 2. Ghost A votes accept

```bash
# As ghost_A:
group.vote({ group_id: "<group_id>", offer_id: "<offerId>", decision: "accept" })
# With a 2-member group, one accept is not yet a majority — ghost_B must also vote, or ghost_A's
# vote is counted and the window resolves at expiry by majority-of-voters rule.
# Returns: { ok: true, resolved: false, outcome: "pending" }

# As ghost_B:
group.vote({ group_id: "<group_id>", offer_id: "<offerId>", decision: "accept" })
# Returns: { ok: true, resolved: true, outcome: "admitted" }
```

### 3. Ghost C can now post

```bash
# As ghost_C:
group.say({ group_id: "<group_id>", content: "Hello from C" })
# Returns: { ok: true, deliveredTo: 2 }
```

---

## Smoke Test: Leave

```bash
# As ghost_A:
group.leave({ group_id: "<group_id>" })
# Returns: { ok: true, message: "Left group \"Amber Foxes\". Returned: 1 gold to your bag.", dissolved: false }

group.list({})
# Returns: { ok: true, groups: [], message: "You are not a member of any group." }
```

---

## Running Unit Tests

```bash
pnpm --filter @aie-matrix/server-world-api test
# 26 GroupService unit tests run against the in-memory implementation — no live services needed

# To run only the group tests:
cd server/world-api && node --import tsx --test "test/GroupService.test.ts"
```

---

## Running Integration Tests (requires live Neo4j)

```bash
cd server/world-api
NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password pnpm test:integration
# GroupServiceLive tests are included; skipped automatically when NEO4J_URI is unset
```

---

## Environment Variables

No new environment variables. Groups work with the existing server configuration:

| Variable | Used for |
|---|---|
| `CONVERSATION_DATA_DIR` | Where `{group_id}.jsonl` group chat threads are stored (same directory as ghost conversation threads) |
| `NEO4J_URI` | Only needed when using `GroupServiceLive` (Neo4j-backed). In-memory GroupService is the default and works without Neo4j. |
| `NEO4J_USER` | Neo4j username (default: `neo4j`) |
| `NEO4J_PASSWORD` | Neo4j password |

---

## How Group ID Routing Works in `group.offer`

`group.offer` serves two purposes depending on the `to` field:

- **`to` = a ghost ID** (found in the registry): triggers **group formation** — a `shared` proposal via the existing offer/agree handshake. Both ghosts must be on the same tile.
- **`to` = a group ID** (not in the ghost registry): triggers a **join offer** — opens an admission vote among current members. No proximity required.

The distinction is automatic. Ghost IDs and group IDs are both ULIDs, but only ghost IDs appear in the agent registry.
