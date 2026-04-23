# Quickstart: World Items

**Feature**: 007-world-objects  
**Prerequisites**: Node.js 24, pnpm 10, a running dev server (`pnpm dev`)

---

## Smoke Test 1 — Object Discovery via `look`

**Covers**: User Story 1, FR-002/005, IC-011

**Setup**: Add object declarations to the sandbox map (see "Authoring Objects" below).  
No Neo4j required.

```bash
# Start the server
pnpm dev

# Adopt a ghost (substitute your caretaker token)
curl -s -X POST http://localhost:2567/registry/adopt \
  -H "Content-Type: application/json" \
  -d '{"ghostId": "smoke-1", "caretakerId": "dev"}' | jq .

# Export the token from the response
export GHOST_TOKEN=<token from above>

# Call look — should include objects array
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"look","arguments":{"at":"here"}}}' \
  | jq '.result.content[0].text | fromjson'
```

**Expected**: Response always includes an `"objects"` array (possibly empty). When at least one item is visible on the current tile or an adjacent tile, entries include `id`, `name`, and `at`. Move to a tile adjacent to a sign tile and re-call `look` — the sign should appear with a compass `at` value.

---

## Smoke Test 2 — Inspect, Take, Inventory, Drop Round-Trip

**Covers**: User Stories 2, 3, 4; FR-006/007/008/009, IC-011

**Precondition**: Ghost must be on a tile that has a carriable object (e.g. `key-brass`).

```bash
# Move ghost to the key tile (adjust compass direction as needed)
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"go","arguments":{"toward":"ne"}}}' \
  | jq '.result.content[0].text | fromjson'

# Inspect the key
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"inspect","arguments":{"itemRef":"key-brass"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": true, "name": "Brass Key", "description": "..." }

# Take the key
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"take","arguments":{"itemRef":"key-brass"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": true, "name": "Brass Key" }

# Check inventory
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"inventory","arguments":{}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": true, "objects": [{ "itemRef": "key-brass", "name": "Brass Key" }] }

# Move to a different tile
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"go","arguments":{"toward":"sw"}}}' \
  | jq '.result.content[0].text | fromjson'

# Drop the key
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"drop","arguments":{"itemRef":"key-brass"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": true }

# Look — key should appear on current tile
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"look","arguments":{"at":"here"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: objects array includes { "id": "key-brass", "name": "Brass Key", "at": "here" }
```

---

## Smoke Test 3 — Inspect Denial from Adjacent Tile

**Covers**: US-2 denial scenario, FR-006, IC-011 `NOT_HERE` code

```bash
# Move away from the sign tile
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"go","arguments":{"toward":"s"}}}' \
  | jq '.result.content[0].text | fromjson'

# Try to inspect from adjacent tile
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"inspect","arguments":{"itemRef":"sign-welcome"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": false, "code": "NOT_HERE", "reason": "..." }
```

---

## Smoke Test 4 — Capacity Blocking

**Covers**: US-5, FR-010, SC-003

**Precondition**: Map has a tile with `capacity: 1` and a `capacityCost: 1` object (e.g. `statue`). One ghost already on the tile.

With two ghost tokens (ghost-A on the statue tile, ghost-B trying to enter):

```bash
# ghost-B tries to enter the statue tile — should be blocked
curl -s -X POST http://localhost:2567/mcp \
  -H "Authorization: Bearer $GHOST_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"go","arguments":{"toward":"<face to statue tile>"}}}' \
  | jq '.result.content[0].text | fromjson'
# Expected: { "ok": false, "code": "TILE_FULL" } or equivalent movement blocked response
```

---

## Authoring Objects for the Sandbox Map

1. Create `maps/sandbox/freeplay.items.json`:

```json
{
  "sign-welcome": {
    "name": "Welcome Board",
    "itemClass": "Sign",
    "carriable": false,
    "capacityCost": 0,
    "description": "A large board listing the day's sessions and booth locations."
  },
  "key-brass": {
    "name": "Brass Key",
    "itemClass": "Key:Brass",
    "carriable": true,
    "capacityCost": 0,
    "description": "A small brass key stamped with the letter N."
  },
  "statue": {
    "name": "Marble Statue",
    "itemClass": "Obstacle",
    "carriable": false,
    "capacityCost": 1,
    "description": "A marble sculpture of a classical figure. It is not going anywhere."
  }
}
```

2. In Tiled, set the navigable hex layer’s **class** to **`layout`**, and each item layer’s **class** to **`item-placement`** (names are free-form). Use a dedicated item tileset (`item-set.tsx`): each item tile’s **type** must match an `itemRef` in the sidecar. See `maps/sandbox/README.md`.

3. Restart the server. Confirm startup log shows no object loading errors.

---

## Running Type Checks

```bash
pnpm typecheck
```

All new `WorldApiObjectError` variants must be covered by `Match.exhaustive` in `server/src/errors.ts` — a type error here means an error code is unhandled.
