# peppers-mem

Neo4j Agent Memory adapter for the Peppers Ghost architecture. Wraps the [`mcp-neo4j-agent-memory`](https://github.com/neo4j-contrib/mcp-neo4j) Python MCP server (launched as a `uvx` subprocess) and exposes a typed TypeScript surface for cascade persistence and retrieval.

## Exports

- **Connection**: `connectMemory({connection})` opens an MCP client over stdio to the agent-memory server. Returns a `MemoryClientHandle` with `.client` and `.close()`.
- **Persist**: `persistCascade(client, trace)` writes a `CascadeTrace` (built via `peppers-inner`'s `CascadeBuilder`) into the graph. Each cascade becomes a `ReasoningTrace` with linked `ReasoningStep` nodes for thoughts, surface actions, and slider adjustments. Spoken utterances are also written to the conversation tier as `Message` nodes.
- **Retrieve**: `fetchRecentCascades(client, ghostId, k)` pulls the most recent *k* cascades for a ghost, returned as `CascadeReplay` records (task / steps / outcome). `fetchCascadeById(client, traceId)` fetches one by id. `formatCascadeReplay(replay)` renders one as plain text for prompt inclusion.

## Connection env

Reads from the repo's `.env`:

- `GHOST_MINDS_NEO4J_URI`
- `GHOST_MINDS_NEO4J_USERNAME`
- `GHOST_MINDS_NEO4J_PASSWORD`
- `GHOST_MINDS_NEO4J_DATABASE` (optional — defaults to the server's default db)

## Smoke / inspection scripts

```bash
pnpm --filter @aie-matrix/ghost-peppers-mem run smoke           # tool wiring round-trip
pnpm --filter @aie-matrix/ghost-peppers-mem run smoke:cascade   # build → persist → retrieve a cascade
pnpm --filter @aie-matrix/ghost-peppers-mem run smoke:retrieve  # fetchRecentCascades against a real ghost
pnpm --filter @aie-matrix/ghost-peppers-mem run inspect:tools   # list MCP tools the server advertises
pnpm --filter @aie-matrix/ghost-peppers-mem run inspect:graph   # quick Cypher snapshot of recent ghost activity
pnpm --filter @aie-matrix/ghost-peppers-mem run inspect:cascade # pretty-print a single cascade by id
```

## Where this fits

See [`peppers-house/README.md`](../peppers-house/README.md) for the end-to-end architecture. The Id pipeline calls `fetchRecentCascades` to pull trigger trajectory into each cascade; `runOneStimulus` calls `persistCascade` after the surface action executes.
