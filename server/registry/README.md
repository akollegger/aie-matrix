# Registry (`@aie-matrix/server-registry`)

In-memory REST registry for **GhostHouse** registration and **caretaker → ghost** adoption (IC-001 / IC-002). Mounted on the combined PoC HTTP server under **`/registry/*`** (default base **`http://127.0.0.1:8787`**).

For day-to-day demos, prefer **`pnpm run demo`** (server + Vite + `random-house` in one terminal) or **`pnpm run poc:ghost`** from the repository root, which performs the registry + MCP steps below via `ghosts/random-house`.

## Script-first flow (pnpm + optional curl)

1. **Start the combined server** (from repo root):

   ```bash
   pnpm run poc:server
   ```

2. **Automatic path** — second terminal:

   ```bash
   pnpm run poc:ghost
   ```

   This runs `pnpm --filter @aie-matrix/ghost-random-house build && … start`, which calls:

   - `POST /registry/houses` — register a house  
   - For each ghost: `POST /registry/caretakers` then `POST /registry/adopt` with the returned ids  

3. **Manual `curl` path** (IC-007 / debugging) — replace `BASE` if you changed `AIE_MATRIX_HTTP_PORT`:

   ```bash
   BASE=http://127.0.0.1:8787

   curl -sS -X POST "$BASE/registry/caretakers" \
     -H 'Content-Type: application/json' \
     -d '{"label":"curl-caretaker"}'
   # → {"caretakerId":"..."}  — save as CARETAKER_ID

   curl -sS -X POST "$BASE/registry/houses" \
     -H 'Content-Type: application/json' \
     -d '{"displayName":"curl-house"}'
   # → {"ghostHouseId":"...","registeredAt":"..."}  — save as HOUSE_ID

   curl -sS -X POST "$BASE/registry/adopt" \
     -H 'Content-Type: application/json' \
     -d "{\"caretakerId\":\"$CARETAKER_ID\",\"ghostHouseId\":\"$HOUSE_ID\"}"
   # → 201 + ghostId, caretakerId, credential { token, worldApiBaseUrl, transport }
   ```

Use **`credential.worldApiBaseUrl`** and **`credential.token`** with an MCP client (`ghosts/ts-client`) the same way `random-house` does.

## Rules (PoC)

- One **active** ghost per **caretaker**; a second `POST /registry/adopt` for the same caretaker returns **409** `CARETAKER_ALREADY_HAS_GHOST`.
- A **GhostHouse** may serve multiple adoptions as long as each uses a **different** caretaker (see `ghosts/random-house` `--ghosts`).

## Normative doc

Aligned with [specs/001-minimal-poc/contracts/local-setup.md](../../specs/001-minimal-poc/contracts/local-setup.md) and [registry-rest.md](../../specs/001-minimal-poc/contracts/registry-rest.md).
