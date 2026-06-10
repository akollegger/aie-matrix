# npc-agent

Rule-based NPC character roster for the aie-matrix. Reads characters from `.character.gram` catalog files, spawns one ghost per enabled character when a session starts, and drives each ghost through a priority-ordered behavior rule table and a scripted dialog tree — with zero LLM dependency.

## Quick start

```bash
# from repo root
pnpm install
cd ghosts/npc-agent
pnpm dev
```

Requires `AGENT_HOST_URL` and `AGENT_HOST_TOKEN` to be set (see env vars below). The agent self-registers with the agent-host on startup.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NPC_CATALOG_DIR` | `./catalog` | Directory containing `.character.gram` catalog files. Mounted as a volume in Docker deployments. |
| `AGENT_HOST_URL` | *(required)* | Base URL of the agent-host service, e.g. `http://localhost:4000`. |
| `AGENT_HOST_TOKEN` | *(required)* | Shared secret for agent-host authentication. |
| `NPC_AGENT_PUBLIC_BASE_URL` | `http://127.0.0.1:4004` | Public URL this agent advertises in its A2A card and catalog registration. |
| `AGENT_PORT` | `4004` | HTTP port to listen on. |
| `AGENT_REGISTER_TIMEOUT` | `120000` | Milliseconds to keep retrying agent-host registration before giving up. |

## Catalog format

Each character is defined in a `.character.gram` file in `NPC_CATALOG_DIR`. The file name is arbitrary; the `id` field in the header is the stable identifier.

### Minimal example

```gram
{ kind: "matrix-character", id: "guide", name: "Conference Guide",
  background: "A friendly guide stationed near the main entrance.",
  enabled: true, defaultAction: "idle" }

(greet:DialogNode { trigger: ["hello","hi","hey"],
  responses: ["Welcome to the AI Engineer World's Fair! What brings you here?"],
  transition: "schedule" })

(schedule:DialogNode { trigger: ["schedule","session","talk","when"],
  responses: ["Keynotes at 9am in Hall A. Workshops all day in Hall B."],
  transition: "farewell" })

(farewell:DialogNode { trigger: ["thanks","bye","goodbye"],
  responses: ["Enjoy the Fair!", "See you around!"] })

(fallback:DialogNode { responses: ["I'm just a guide — try asking about the schedule!"],
  fallback: true })

[dialog:DialogTree |
  (greet)-[:ON]->(schedule),
  (schedule)-[:ON]->(farewell)
]
```

### Header fields

| Field | Type | Description |
|---|---|---|
| `kind` | `"matrix-character"` | Required. Must be exactly this value. |
| `id` | string | Stable character identifier. Duplicate ids across files → second file skipped. |
| `name` | string | Display name used as the ghost's `displayName` in the registry. |
| `background` | string | One-line character background, surfaced in `whereami` (IC-008). |
| `enabled` | boolean | `false` → character is never spawned. |
| `defaultAction` | `idle` \| `random-move` \| `stay` | Action taken when no behavior rule matches. |

### Behavior rules block

```gram
[behaviors:Behaviors |
  (b1:Rule { when: "inventory_empty", do: "seek-item",   priority: 1 }),
  (b2:Rule { when: "crowded",         do: "avoid-crowd", priority: 2 }),
  (b3:Rule { when: "alone",           do: "wander",      priority: 3 }),
  (b4:Rule { when: "always",          do: "idle",        priority: 4 })
]
```

Rules are evaluated in ascending `priority` order. First match wins. If a rule's MCP action fails, evaluation continues to the next rule (graceful degradation).

**Supported conditions:** `inventory_empty`, `crowded` (≥2 other ghosts on tile), `item_nearby`, `alone` (0 other ghosts), `always`

**Supported actions:** `seek-item` (take here or move toward adjacent item), `avoid-crowd` (random exit), `wander` (random exit), `idle` (no-op)

### Dialog tree block

```gram
(nodeId:DialogNode { trigger: ["keyword1","keyword2"],
  responses: ["Reply text A", "Reply text B"],
  transition: "nextNodeId" })

(fallback:DialogNode { responses: ["I'm not sure about that."], fallback: true })

[dialog:DialogTree |
  (start)-[:ON]->(nextNodeId)
]
```

- One node must have `fallback: true` (catch-all for unmatched messages).
- `trigger` matching is case-insensitive substring scan over the inbound message.
- A random response is chosen from `responses` on each reply.
- `transition` moves the per-partner dialog state to the target node after responding.
- NPC↔NPC messages are ignored (sibling-NPC sender rejection).

## How to add a character

1. Create `<name>.character.gram` in `NPC_CATALOG_DIR` (default `./catalog`).
2. Set `enabled: true` and provide at least one dialog node with `fallback: true`.
3. Restart the npc-agent (or start it fresh; catalog is loaded once at startup).

The agent will spawn one ghost for the new character on the next session start.

## Docker

```bash
# from repo root
docker build -f ghosts/npc-agent/Dockerfile -t npc-agent .
docker run --rm \
  -e AGENT_HOST_URL=http://host.docker.internal:4000 \
  -e AGENT_HOST_TOKEN=dev-secret-change-me \
  -e NPC_CATALOG_DIR=/catalog \
  -v $(pwd)/ghosts/npc-agent/catalog:/catalog:ro \
  -p 4004:4004 \
  npc-agent
```

In staging/production use the compose service in `deploy/staging/docker-compose.yml` which mounts a catalog volume at `/catalog`.

## TCK integration test

With the full stack running:

```bash
cd ghosts/tck
NPC_AGENT_BASE_URL=http://localhost:4004 \
AIE_MATRIX_INTERNAL_FANOUT_TOKEN=<token> \
pnpm tck:npc
```

Covers SC-007 (single multi-turn dialog) and SC-008 (two interleaved conversations with independent state).
