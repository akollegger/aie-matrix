# Quickstart: Ghost House A2A Coordination

**Branch**: `009-ghost-house-a2a`  
**Prerequisite**: World server running — `pnpm dev` from repo root (starts Colyseus + world-api + registry)

This guide walks through Phase 1 verification: start the ghost house, register the `random-agent` reference implementation, spawn it for a ghost, and run the Wanderer TCK.

---

## 1. Configure environment

Both `ghost-house` and `random-agent` call `loadRootEnv()` from `@aie-matrix/root-env`, which loads the **monorepo root** `.env` and `.env.local` (not the file under `ghosts/ghost-house/` or `ghosts/random-agent/`). Copy the examples below into the **repository root** `.env`, or `export` the same variables in your shell before starting the processes.

```bash
# Reference copies (optional — for documentation only; not loaded by default):
cp ghosts/ghost-house/.env.example ghosts/ghost-house/.env
cp ghosts/random-agent/.env.example ghosts/random-agent/.env
```

**Root `.env` (or shell exports)** — required keys:

| Variable | Example | Used by |
|----------|---------|--------|
| `GHOST_HOUSE_DEV_TOKEN` | `dev-secret-change-me` | house, random-agent (A2A auth) |
| `AIE_MATRIX_HTTP_BASE_URL` | `http://127.0.0.1:8787` | house Colyseus bridge (optional; default shown) |
| `GHOST_HOUSE_PORT` | `4000` | house (optional) |
| `CATALOG_FILE_PATH` | `./catalog.json` | house, relative to package cwd (optional) |
| `GHOST_HOUSE_URL` | `http://127.0.0.1:4000` | random-agent |
| `AGENT_PORT` | `4001` | random-agent (optional) |

---

## 2. Install workspace dependencies

```bash
pnpm install
```

---

## 3. Start the ghost house

```bash
pnpm --filter @aie-matrix/ghost-house dev
# Ghost house listening at http://localhost:4000
```

Verify it's up (catalog routes require the dev bearer — see IC-005):

```bash
curl -H "Authorization: Bearer dev-secret-change-me" http://localhost:4000/v1/catalog
# → { "agents": [] }   (empty catalog on first run)
```

---

## 4. Start the random-agent

```bash
pnpm --filter @aie-matrix/random-agent dev
# random-agent listening at http://localhost:4001
```

Verify its agent card:

```bash
curl http://localhost:4001/.well-known/agent-card.json
# → { "name": "random-agent", "matrix": { "tier": "wanderer", ... } }
```

---

## 5. Register random-agent with the house

```bash
curl -X POST http://localhost:4000/v1/catalog/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-secret-change-me" \
  -d '{ "agentId": "random-agent", "baseUrl": "http://localhost:4001" }'
# → { "ok": true, "agentId": "random-agent" }
```

Confirm it appears in the catalog:

```bash
curl -H "Authorization: Bearer dev-secret-change-me" http://localhost:4000/v1/catalog
# → { "agents": [{ "agentId": "random-agent", "tier": "wanderer", ... }] }
```

---

## 6. Adopt a ghost via the world registry

```bash
# Create a caretaker
CARETAKER_ID=$(curl -sX POST http://localhost:8787/registry/caretakers \
  -H "Content-Type: application/json" \
  -d '{ "label": "quickstart" }' | jq -r .caretakerId)

# Register ghost house
GHOST_HOUSE_ID=$(curl -sX POST http://localhost:8787/registry/houses \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "quickstart-house" }' | jq -r .ghostHouseId)

# Adopt a ghost (save full body for spawn credential)
ADOPT=$(curl -sX POST http://localhost:8787/registry/adopt \
  -H "Content-Type: application/json" \
  -d "{\"caretakerId\": \"$CARETAKER_ID\", \"ghostHouseId\": \"$GHOST_HOUSE_ID\"}")
GHOST_ID=$(echo $ADOPT | jq -r .ghostId)

echo "Ghost ID: $GHOST_ID"
```

---

## 7. Spawn random-agent for the ghost

Re-use the registry credential from adopt so the house MCP proxy can call the world server on the ghost’s behalf.

```bash
SESSION=$(curl -sX POST "http://localhost:4000/v1/sessions/spawn/random-agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-secret-change-me" \
  -d "{
    \"ghostId\": \"$GHOST_ID\",
    \"credential\": {
      \"token\": \"$(echo $ADOPT | jq -r .credential.token)\",
      \"worldApiBaseUrl\": \"$(echo $ADOPT | jq -r .credential.worldApiBaseUrl)\"
    }
  }")
SESSION_ID=$(echo $SESSION | jq -r .sessionId)

echo "Session ID: $SESSION_ID"
# The ghost is now moving randomly in the world.
```

(If you adopted in a prior step without `ADOPT` in the shell, run the adopt `curl` again and export `ADOPT` from its JSON, or pass `credential` from the adopt response you saved.)

### Multiple ghosts (same `random-agent` process)

You still register **one** `baseUrl` for `@aie-matrix/random-agent`. For each additional in-world ghost: run **adopt** again (new `ghostId`), then **spawn** with that `ghostId` and the new adopt `credential`. The reference agent keeps **one MCP movement loop per `ghostId`** in parallel inside the same process. The house enforces at most **one active session per `ghostId`**; use **different** `ghostId`s for concurrent ghosts.

For **strong isolation** (separate processes), run one `random-agent` per ghost on its own port and register each `baseUrl` separately — this is optional and not required for local development.

This behavior is a **reference implementation** convenience, not a platform-wide multi-session SLO.

---

## 8. Run the Wanderer TCK

```bash
# Optional: if not using defaults
export GHOST_HOUSE_URL=http://localhost:4000
export RANDOM_AGENT_BASE_URL=http://localhost:4001
pnpm --filter @aie-matrix/ghost-tck run tck:wanderer
# [tck] wanderer PASS
```

---

## 9. Shut down the session

```bash
curl -X DELETE "http://localhost:4000/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer dev-secret-change-me"
# → { "ok": true, "sessionId": "..." }
```

---

## Environment Variables Reference

| Variable | Package | Required | Default | Description |
|----------|---------|----------|---------|-------------|
| `GHOST_HOUSE_DEV_TOKEN` | ghost-house, random-agent | yes | — | Static bearer token for Phase 1 auth (localhost only) |
| `AIE_MATRIX_HTTP_BASE_URL` | ghost-house | no | `http://127.0.0.1:8787` | World HTTP origin for the Colyseus bridge (not the `/mcp` URL) |
| `GHOST_HOUSE_PORT` | ghost-house | no | `4000` | HTTP port |
| `CATALOG_FILE_PATH` | ghost-house | no | `./catalog.json` | Agent catalog persistence file |
| `AGENT_PORT` | random-agent | no | `4001` | HTTP port for agent A2A endpoint |
| `GHOST_HOUSE_URL` | random-agent | yes | — | Ghost house URL for registration and health checks |

**MCP to the world:** the house’s `/v1/mcp` proxy forwards to each session’s `credential.worldApiBaseUrl` from **registry /adopt** (same value as the combined server prints for MCP, e.g. `http://127.0.0.1:8787/mcp`). You do **not** set a separate `WORLD_API_BASE_URL` in `.env` for the house.

---

## Troubleshooting

**Ghost house fails to start**: Check `GHOST_HOUSE_DEV_TOKEN` is set. For the Colyseus bridge, ensure `AIE_MATRIX_HTTP_BASE_URL` (or default `127.0.0.1:8787`) matches the running combined server. For movement after spawn, the world MCP must be reachable at the **adopt** `credential.worldApiBaseUrl` (usually `http://127.0.0.1:8787/mcp` when the server is local).

**Registration returns 502**: The house cannot fetch the agent card from `baseUrl/.well-known/agent-card.json`. Confirm the agent is running and `AGENT_PORT` matches the URL used in registration.

**Spawn returns 503**: The agent is unreachable from the house. Confirm both are on localhost with correct ports.

**TCK fails at `wanderer` step**: Check that the session is active (`GET /v1/catalog` with `Authorization: Bearer …`) and the ghost has a valid starting position in the world. The world may occasionally return `MOVEMENT_BLOCKED` / `TILE_FULL` for a given step — re-run `tck:wanderer` once or twice if the stack is otherwise healthy. If **`RULESET_DENY`** / movement ruleset blocking appears, the active Gram ruleset rejected that edge; retry or temporarily clear **`AIE_MATRIX_RULES`** for a permissive map (see `docs/architecture.md` movement policy).

---

## Phase 7 verification (maintainers)

- Use **`@aie-matrix/ghost-house`** and **`@aie-matrix/random-agent`** (not the spike under `spikes/a2a-ghost-agent-protocol/`). Repo gate: **`pnpm typecheck`** at root.
- Run §1–8 in **separate shells** (or `pnpm run demo` with `GHOST_HOUSE_DEV_TOKEN` set — `scripts/demo.mjs` runs quickstart §5–7 after the house and agent are up; set `AIE_MATRIX_DEMO_SKIP_BOOTSTRAP=1` to skip that) on a host where default ports are free. Conflicting listeners cause `EADDRINUSE` on 8787 / 4000 / 4001.
- Last structure check: all quickstart HTTP steps and `tck:wanderer` exercised against the workspace packages; intermittent `MOVEMENT_BLOCKED` / `RULESET_DENY` is an environmental flake, not a spec deviation.
