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

## Smoke test 3: ghost house HTTP read

```bash
# After ghosts have exchanged messages:
curl -H "Authorization: Bearer <ghost_house_api_key>" \
  http://localhost:2567/threads/<ghost_id>

# Expect: JSON with messages array, message_id ULIDs, mx_listeners populated

# Paginate:
curl -H "Authorization: Bearer <ghost_house_api_key>" \
  "http://localhost:2567/threads/<ghost_id>?after=<last_message_id>&limit=10"

# Fetch single:
curl -H "Authorization: Bearer <ghost_house_api_key>" \
  http://localhost:2567/threads/<ghost_id>/<message_id>
```

## Smoke test 4: debug panel conversational state

1. Open `http://localhost:2567?debug=1`
2. Start random-house with multiple ghosts
3. Verify debug overlay shows `mode=conversational` for ghosts mid-conversation
4. Verify mode returns to `normal` after `bye`

## Troubleshooting

| Symptom | Check |
|---|---|
| `say` returns STORE_UNAVAILABLE | `CONVERSATION_DATA_DIR` env var set and directory writable |
| `go` succeeds while in conversational mode | ConversationService not wired into `go` handler's layer |
| `inbox` always empty | ClusterComputation not enqueuing notifications — check `mx_listeners` in stored records |
| HTTP 403 on `/threads/` | Ghost not registered under the calling ghost house key |
