# Quickstart: Session Leaderboards

**Feature**: 026-session-leaderboards

## Prerequisites

- Neo4j running locally (`NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` set in `.env`)
- `pnpm install` run from repo root
- A map loaded that includes a `[leaderboards:Leaderboards | ...]` block (see `maps/sandbox/canonical.map.gram`)

## Running the world-api

```bash
pnpm dev
# or specifically:
cd server/world-api && pnpm dev
```

## Smoke Test: End-to-End Leaderboard Demo (RFC-0025 §Demo Scenario)

This sequence verifies the full mechanic in ~15 minutes.

### Step 1 — Observe declared leaderboards (no entries yet)

```bash
# As spectator (no auth required)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "leaderboards", "arguments": {}}}'
# Expect: [{ id: "top-distributors", title: "Top Distributors", description: "..." }]
```

### Step 2 — Check live rankings after ghost activity

After two ghosts have received different amounts of gold via ledger transactions:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "leaderboard", "arguments": {"id": "top-distributors"}}}'
# Expect: entries array with higher-scoring ghost first, isFinal: false
```

### Step 3 — Finalize leaderboards (scheduler/admin role)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <scheduler-token>" \
  -d '{"method": "tools/call", "params": {"name": "finalize-leaderboards", "arguments": {}}}'

# Then query again:
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "leaderboard", "arguments": {"id": "top-distributors"}}}'
# Expect: same entries, isFinal: true
```

### Step 4 — Confirm unauthorized access is rejected

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ghost-token>" \
  -d '{"method": "tools/call", "params": {"name": "finalize-leaderboards", "arguments": {}}}'
# Expect: 403 / AuthorizationError
```

### Step 5 — No default leaderboards for a map without declarations

Load a map without a `[leaderboards:Leaderboards | ...]` block:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/call", "params": {"name": "leaderboards", "arguments": {}}}'
# Expect: []
```

## Running Unit Tests

```bash
cd server/world-api && pnpm test
# LeaderboardServiceInMemory tests cover all interface methods and error paths
```

## Running Integration Tests (requires live Neo4j)

```bash
cd server/world-api && NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password pnpm test:integration
# Tests are skipped automatically when NEO4J_URI is not set
```
