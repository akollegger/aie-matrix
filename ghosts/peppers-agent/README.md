# peppers-agent

A ghost agent with a two-agent personality system. Each ghost has an 8-facet OCEAN personality (internal × external sliders) that drifts in response to lived experience. An LLM-driven Id pipeline composes a stream-of-consciousness monologue every cascade; a slider-blind Surface picks one MCP-shaped action against the live world-api.

Registers with `agent-host` via the A2A protocol. `agent-host` manages discovery, spawn, and MCP proxying.

Companion packages:
- [`peppers-inner`](../peppers-inner) — pure logic (slider math, facet types, cascade builder)
- [`peppers-mem`](../peppers-mem) — Neo4j Agent Memory adapter (cascade persistence + retrieval)

---

## Prerequisites

Add to your repo-root `.env` before starting anything:

```bash
# A2A shared token — must match what agent-host uses
AGENT_HOST_TOKEN=dev-secret

# OpenAI — drives Id (8 parallel facet agents) and Surface
OPENAI_API_KEY=sk-...

# Neo4j Aura (or local) for cascade persistence + retrieval
GHOST_MINDS_NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
GHOST_MINDS_NEO4J_USERNAME=neo4j
GHOST_MINDS_NEO4J_PASSWORD=...
# GHOST_MINDS_NEO4J_DATABASE=neo4j  # optional; defaults to server default
```

---

## Quickstart — two commands

### Terminal 1 — world server + agent-host + random-agent

```bash
pnpm run demo
# starts: server (8787) · spectator (5174) · agent-host (4000) · random-agent (4001)
# wait for: "all processes running"
```

### Terminal 2 — peppers-agent + ghost bootstrap

```bash
pnpm run peppers:demo              # 2 peppers ghosts (default)
pnpm run peppers:demo -- --ghosts 4  # or more
```

This starts the peppers-agent A2A server (port 4002), waits for agent-host to respond, registers peppers-agent with the catalog, then adopts and spawns N peppers ghosts. Each ghost receives a spawn context from agent-host and begins its personality loop.

Watch terminal 2 for cascade output. Spectator: `http://127.0.0.1:5174/`

---

## Development (single ghost, no demo script)

If you only want to iterate on the personality engine without the full stack:

```bash
# terminal 1 — world server only
pnpm run server

# terminal 2 — single peppers ghost, direct connection (no agent-host)
node --import tsx ghosts/peppers-agent/src/peppers-house-cli.ts
```

This bypasses agent-host entirely — useful for tuning Id prompts, slider math, and cascade timing without the A2A layer in the way.

---

## Environment reference

| Var | Default | Purpose |
|---|---|---|
| `PEPPERS_AGENT_PORT` | `4002` | Port the A2A agent server listens on |
| `PEPPERS_AGENT_PUBLIC_BASE_URL` | `http://127.0.0.1:4002` | Public base for agent card URL |
| `AGENT_HOST_TOKEN` | — | Shared bearer token for A2A auth |
| `OPENAI_API_KEY` | — | OpenAI key for Id + Surface LLM calls |
| `GHOST_MINDS_NEO4J_URI` | — | Neo4j URI for cascade persistence |
| `GHOST_MINDS_NEO4J_USERNAME` | — | Neo4j username |
| `GHOST_MINDS_NEO4J_PASSWORD` | — | Neo4j password |
| `GHOST_MINDS_NEO4J_DATABASE` | server default | Neo4j database name |
| `PEPPERS_OBJECTIVE` | (social) | Ghost's in-world goal — shapes monologue and action choice |
| `PEPPERS_VERBOSE` | `false` | Print full LLM prompts and raw responses each cascade |
| `PEPPERS_BIRTH_SEED` | random | Integer seed for personality sampling (reproducible runs) |
| `PEPPERS_GHOSTS` | `1` | Parallel ghost count (standalone CLI mode only; 1–16) |
| `PEPPERS_OVERLAY_PORT` | — | Base port for per-ghost overlay UI (standalone CLI mode only) |
| `AIE_MATRIX_REGISTRY_BASE` | `http://127.0.0.1:8787` | Registry base URL (standalone CLI mode only) |
