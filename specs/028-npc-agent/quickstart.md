# Quickstart: NPC Agent

How to run and verify the npc-agent locally.

## Prerequisites

- `pnpm install` at repo root
- A running world stack: `pnpm dev` (combined server) + agent-host (see `deploy/staging/docker-compose.yml` for env wiring)
- Neo4j + Redis via `docker-compose.dev.yml` (infra)

## Author a character

Create `ghosts/npc-agent/catalog/ada.character.gram` (see `contracts/character.gram.md` for the full shape):

```gram
{ kind: "matrix-character", id: "ada", name: "Ada", background: "Loves directions.",
  enabled: true, defaultAction: "idle" }

[behaviors:Behaviors | (b1:Rule { when: "item_nearby", do: "seek-item", priority: 1 }) ]

(greet:DialogNode { trigger: ["hello","hi"], responses: ["Welcome!"] })
(bye:DialogNode { trigger: ["bye"], responses: ["Safe travels!"] })
(default:DialogNode { responses: ["Hmm?"], fallback: true })

[dialog:DialogTree | (greet)-[:ON]->(bye) ]
```

## Run the agent

```sh
cd ghosts/npc-agent
cp .env.example .env          # set AGENT_HOST_URL, AGENT_HOST_TOKEN, AGENT_PORT=4004, NPC_CATALOG_DIR=./catalog
pnpm dev                      # node --import tsx src/agent.ts
```

The agent registers in the host catalog, then on `world.session.start` spawns one ghost per enabled character.

## Verify (smoke)

1. **Roster spawn** — start a session; confirm one ghost per enabled character appears with its name + background (US1). Disabled entries do not appear.
2. **Behavior** — place an item near a "seek-item" character; within a few ticks it moves toward and takes the item rather than wandering (US2).
3. **Dialog** — from another (non-NPC) ghost or human partner, `say "hello"` to a character → it replies with the greeting; `say "bye"` → farewell; unmatched text → fallback (US3). A sibling NPC's message is ignored (FR-009).

## Tests

```sh
pnpm --filter @aie-matrix/npc-agent test    # unit: rules, dialog traversal, per-partner isolation, catalog load
pnpm test:tck                               # integration (server running): ghosts/tck/src/npc.ts
```

- **Unit** mocks `GhostMcpClient` (pattern: `ghosts/random-agent/tests/executor-registry.test.ts`).
- **Integration** (`npc.ts`, mirrors `social.ts`): an external ghost drives a scripted dialog and asserts replies; a second test drives two external ghosts interleaved and asserts zero cross-contamination (SC-007/SC-008).

## Gate before PR

```sh
pnpm run build      # hard gate — composite project build, not just typecheck
pnpm test
/speckit-verify     # full GO/NO-GO gate
```
