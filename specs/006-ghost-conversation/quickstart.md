# Quickstart: Ghost Conversation

Verify the conversation feature end-to-end after implementation.

## Prerequisites

- Server running (`pnpm dev` from repo root)
- At least two ghost tokens (adopt two ghosts via `server/registry/`)
- `ghost-cli` built (`pnpm --filter @aie-matrix/ghost-cli build`)

## Smoke test 1: ghost-cli say/bye round-trip

```bash
# Terminal 1 — ghost A
ghost-cli --token <ghost_a_token> --interactive

# Inside REPL:
> whereami          # confirm position
> look around       # find nearby tiles
> go ne             # move near another ghost if needed
> look here         # confirm occupants
> say Hello from ghost A!
# → Status strip shows: [conversational]
# → Confirms: message_id + mx_listeners

> go ne             # expect: rejected — IN_CONVERSATION error
> bye
# → Status strip shows: [normal]
> go ne             # expect: movement succeeds
```

**Status (Phase 4 — US2)**: `say` enters conversational mode; `go`/`traverse` reject with `IN_CONVERSATION`; `bye` returns `{ previous_mode }` and restores movement. Full round-trip verified: `say` → `go` rejected (`IN_CONVERSATION`) → `bye` → `go` succeeds. Calling `bye` while already in `normal` mode is a no-op (returns `previous_mode: "normal"`). Message records remain JSONL at `CONVERSATION_DATA_DIR/{ghost_id}.jsonl`.

**Status (Phase 6 — US4)**: REPL shows `[conversational]` on the status strip after `say`, clears after `bye`, and logs `message.new` lines (cyan) from the 3s `inbox` poll. One-shot: `ghost-cli say hello` / `ghost-cli bye`. Automated verification: run REPL smoke above plus `pnpm --filter @aie-matrix/ghost-cli build` before manual checks.

## Smoke test 2: random-house conversation behavior

```bash
# Terminal 1 — start server
pnpm dev

# Terminal 2 — start random-house with 3 ghosts
pnpm --filter @aie-matrix/random-house start -- --ghosts=3

# Observe in debug panel (open browser → http://localhost:2567?debug=1):
# - ghostModes column shows "conversational" when ghosts engage
# - Ghosts freeze position while in conversational mode
# - Ghosts resume walking after bye
```

**Status (Phase 6 — US4)**: `random-house` uses `look` → 20% `say` when occupants present; while conversational it polls `inbox` every tick, always `say`s when notifications arrive, and 15% `bye` per tick when the inbox is empty; `go` is skipped until `bye`. Verified against `pnpm dev` + `pnpm --filter @aie-matrix/random-house start -- --ghosts=3` (build/typecheck gate).

## Smoke test 3: agent host HTTP read

Use the combined server HTTP port (default `8787`, or `AIE_MATRIX_HTTP_PORT`). The agent host credential is the `agentHostId` returned from `POST /registry/houses` (Bearer treats that UUID as the house API key for this PoC).

When calling `POST /mcp` from `curl`, send `Accept: application/json, text/event-stream` (Streamable HTTP transport).

```bash
BASE=http://127.0.0.1:8787
HOUSE_ID=$(curl -sS -X POST "$BASE/registry/houses" -H "Content-Type: application/json" \
  -d '{"displayName":"thread-read-test"}' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).agentHostId))")
# Adopt a ghost (caretaker + house from registry README); then send at least one MCP `say` so JSONL has rows.

curl -sS -H "Authorization: Bearer $HOUSE_ID" "$BASE/threads/<ghost_id>"
# Expect: JSON with thread_id, messages (chronological), message_id ULIDs, mx_listeners populated

curl -sS -H "Authorization: Bearer $HOUSE_ID" \
  "$BASE/threads/<ghost_id>?after=<last_message_id>&limit=10"

curl -sS -H "Authorization: Bearer $HOUSE_ID" \
  "$BASE/threads/<ghost_id>/<message_id>"
```

**Status (Phase 5 — US3)**: `GET /threads/:ghostId` and `GET /threads/:ghostId/:messageId` are mounted on the combined server. Bearer must be a registered `agentHostId`; the path `ghost_id` must belong to that house or the API returns 403. List supports `after` (ULID exclusive, lexicographic) and `limit` (default 50, max 200); `next_cursor` is the last returned `message_id` when another page exists. `JsonlStore.list` filters by `message_id > after` for stable pagination. Verified against local `pnpm dev` with adopt + `say` + curl list/single/paginate.

## Smoke test 4: debug panel conversational state

1. Open `http://localhost:2567?debug=1`
2. Start random-house with multiple ghosts
3. Verify debug overlay shows `mode=conversational` for ghosts mid-conversation
4. Verify mode returns to `normal` after `bye`

**Status (Phase 6 — US4)**: State tab / snapshot includes `mode=conversational|normal` per ghost; `spectatorDebugRoomEvents` logs `[ghost-mode]` lines on `ghostModes` map changes. Verified together with smoke test 2.

## Smoke test 5: cluster membership and `mx_listeners` (US5)

**What the engine does**: On each `say`, the server takes the speaker’s current H3 cell, computes `gridDisk(cell, 1)` (speaker cell plus face-adjacent neighbors at the map resolution), collects **occupants on each of those cells** from Colyseus, and excludes the speaker. That set is `mx_listeners`; those ghosts receive a drained `inbox` notification (`message.new`) for that message.

**Goal**: Show that listeners depend on **where ghosts stand at `say` time**, not on stale positions.

### Setup

- `pnpm dev` running; two adoption tokens: **ghost A** and **ghost B** (same or different houses is fine).
- Two terminals with `ghost-cli --token <token> --interactive` (or one-shot `whereami` / `look` / `go` to position).

### Procedure

1. **Place A and B** using `whereami`, `look around`, and `go <face>` so you understand the map. You need a layout where you can move **B out** of A’s 7-cell cluster, then **back in**, using only valid exits (same as smoke test 1).

2. **Move B outside A’s cluster** — far enough that B is not on A’s cell and not on any of A’s six face neighbors (the “ring” used by `gridDisk(..., 1)`). Use `look here` on both REPLs to confirm B is not listed on A’s tile and A is not on B’s tile as needed.

3. **Terminal A — first `say`**: run `say outside test` (or any text).  
   - **Expect**: The command log line includes `say ok` with `listeners: …` — **B’s ghost id must not appear** in that listener list (or list is empty if no other ghosts in the cluster).

4. **Terminal B — optional check**: on the REPL, wait for the 3s inbox poll lines; **no new `message.new`** for A’s first message (inbox stays empty for that turn).

5. **Move B into A’s cluster** — step B onto A’s cell or onto any face-adjacent neighbor of A’s cell so B is inside the `gridDisk` union. Confirm with `look here` from A that B appears in occupants when appropriate.

6. **Terminal A — second `say`**: run `say inside test` **without** moving A first (A may still show `[conversational]` from the first `say`; that is fine).  
   - **Expect**: `say ok` **includes B in `listeners`** (or the listener set matches ghosts actually in the cluster).

7. **Terminal B**: within one inbox poll cycle, **expect** a cyan `[message.new]` line (REPL) referencing A’s `thread_id` (A’s ghost id) and the **second** message’s id — not the first.

### Optional: listener leaves cluster

8. **Terminal A**: `bye` so A can move again. Move **B** back **out** of the cluster. **Terminal A**: `say` again. **Expect**: B is **not** in `mx_listeners` and B’s inbox does **not** gain a new notification for that third message (after draining earlier notifications with `inbox` / poll).

**Status (Phase 7 — US5)**: Manual procedure above documents the independent test: listener outside cluster → first `say` does not notify B; listener inside cluster → second `say` notifies B. Confirms `mx_listeners` and inbox behavior match spatial membership at each `say`.

## Troubleshooting

| Symptom | Check |
|---|---|
| `say` returns STORE_UNAVAILABLE | `CONVERSATION_DATA_DIR` env var set and directory writable |
| `go` succeeds while in conversational mode | ConversationService not wired into `go` handler's layer |
| `inbox` always empty | ClusterComputation not enqueuing notifications — check `mx_listeners` in stored records |
| B never gets `message.new` when expect yes | B not in `gridDisk(A,1)` at **say** time — re-check `whereami` / `look here` on both ghosts (smoke test 5) |
| B gets notifications when expect no | B still inside cluster ring — move B farther or wait for a `say` after B left the cluster |
| HTTP 403 on `/threads/` | Ghost not registered under the calling agent host key |
