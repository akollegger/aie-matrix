# Quickstart: Group Formation and Group Chat

## Prerequisites

- Server running: `pnpm dev` from repo root (needs Neo4j + Colyseus)
- Two registered ghosts on the map (`ghost_A`, `ghost_B`)
- Both ghosts in proximity (same H3 tile or adjacent) — required by offer proximity check

## Smoke Test: Form a Group

### 1. Ghost A offers group formation

```bash
# Via ghost-ts-client or ghost-cli
ghost_A> group.offer to=ghost_B resource=trust amount=10 expires_in=120
# Expected: "Offer created. offerId: 01J... Expires at: ..."
```

### 2. Ghost B accepts

```bash
ghost_B> group.offer to=<offerId>    # not needed — ghost_B uses agree path
# Actually: the agree path re-uses the existing offer/agree handshake
# ghost_B calls: agree offerId=<offerId>
ghost_B> agree offer_id=<offerId>
# Expected: "Offer accepted. Group 'Amber Foxes' created (group_id: 01J...)."
```

### 3. Verify membership

```bash
ghost_A> group.list
# Expected: "You are a member of 1 group(s): - 'Amber Foxes' ..."

ghost_B> group.list
# Expected: same group listed
```

### 4. Send group chat messages

```bash
ghost_A> group.say group_id=<group_id> content="Hello from A"
ghost_B> inbox
# Expected: notification for thread_id=<group_id>; fetch {group_id}.jsonl to read
```

## Smoke Test: Join an Existing Group

### 1. Ghost C proposes to join

```bash
ghost_C> group.offer to=<group_id> resource=trust amount=10 expires_in=120
# Expected: "Offer created. offerId: 01J... Group members have been notified."
```

### 2. Ghost A votes accept

```bash
ghost_A> group.vote group_id=<group_id> offer_id=<offerId> decision=accept
# Expected: "Vote recorded. Outcome: admitted. ghost_C has joined the group."
```

### 3. Ghost C can now post

```bash
ghost_C> group.say group_id=<group_id> content="Hello from C"
```

## Smoke Test: Leave

```bash
ghost_A> group.leave group_id=<group_id>
# Expected: "Left group 'Amber Foxes'. Returned: 10 trust to your bag."

ghost_A> group.list
# Expected: "You are not a member of any group."
```

## Running Unit Tests

```bash
cd server/world-api
pnpm test
# Covers: GroupServiceInMemory — createGroup, proposeJoin, vote, leave, groupSay, listMemberships
```

## Running Integration Tests (requires live Neo4j)

```bash
cd server/world-api
NEO4J_URI=bolt://localhost:7687 NEO4J_USERNAME=neo4j NEO4J_PASSWORD=password pnpm test
# Includes: GroupServiceLive integration tests (skipped when NEO4J_URI unset)
```

## Environment Variables

No new environment variables required beyond those already used by `server/world-api`:
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` — existing Neo4j connection
- `CONVERSATION_DATA_DIR` — existing JSONL store directory (group threads stored here)
