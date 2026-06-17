# npc-agent

Rule-based NPC character roster for the aie-matrix. Reads characters from `.character.gram` catalog files, spawns one ghost per enabled character when a session starts, and drives each ghost through a priority-ordered behavior rule table and a scripted dialog tree — with zero LLM dependency.

**Built-in characters**: `collector` (item hunter), `hermit` (wanderer), `info-attendant` (greeter), `broker` (brokers deals — offers credits for answering questions, stateful contract-negotiation loop), `quizmaster` (conducts structured exams — loads `.exam.gram` at startup, manages commit-reveal hash protocol, proportional credit payout), `contestant` (auto-accepts exam offers and answers questions).

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

Each character is defined in a `.character.gram` file in `NPC_CATALOG_DIR`. The file name is arbitrary; the `id` field on the `Character` node is the stable identifier.

The format is gram — the same syntax used for `.map.gram` and `.calendar.gram` files across the project. Files can be concatenated into a single world gram without ambiguity.

### Minimal example

```gram
{ kind: "matrix-character" }

(charGuide:Character { id: "guide", name: "Conference Guide",
  background: "A friendly guide stationed near the main entrance.",
  enabled: true, defaultAction: "idle" })

(idle:DialogNode     { responses: ["How can I help? Ask about the schedule or directions."] })
(schedule:DialogNode { responses: ["Keynotes at 9am in Hall A. Workshops all day in Hall B."] })
(farewell:DialogNode { responses: ["Enjoy the Fair!", "See you around!"] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["schedule","session","talk","when"] }]->(schedule),
  (idle)-[:DialogTrigger { triggers: ["thanks","bye","goodbye"] }]->(farewell),
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (schedule)-[:DialogTrigger { triggers: [] }]->(idle),
  (farewell)-[:DialogTrigger { triggers: [] }]->(idle)
]

(charGuide)-[:HAS_DIALOG]->(dialog_1)
```

### Character node fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable character identifier. Duplicate ids across files → second file skipped. |
| `name` | string | Display name used as the ghost's `displayName` in the registry. |
| `background` | string | One-line character background, surfaced in `whereami` (IC-008). |
| `enabled` | boolean | `false` → character is never spawned. |
| `defaultAction` | `idle` \| `go-random` | Action taken when no behavior rule matches. (Legacy aliases `stay`/`random-move` also accepted.) |
| *(label)* | `Character:Broker` `Character:Quizmaster` `Character:Contestant` | Behavior dispatch strategy. Absence of a behavior label defaults to rule-engine. Add `:Broker`, `:Quizmaster`, or `:Contestant` for the corresponding behavior. |
| `examPath` | string | Relative path (from `NPC_CATALOG_DIR`) to a `.exam.gram` file. Required for Quizmaster characters. |
| `stakeAmount` | number | Credits staked per exam/contract. Used by Broker and Quizmaster. Defaults to 1. |

### Dialog tree

The dialog system is a finite-state machine (FSM):

- **Nodes** are conversation states. `responses` are spoken when the NPC transitions INTO that node (chosen randomly from the array).
- **Edges** (`[:DialogTrigger]`) carry the player's keywords. Specific triggers (non-empty `triggers` array) are evaluated in declaration order; first match wins. Wildcard edges (`triggers: []`) match anything and are evaluated last.
- **Every node must have exactly one outgoing wildcard edge** — this is the "return path" when the player says something unexpected.
- **The idle/root node must have an explicit wildcard self-loop** (`(idle)-[:DialogTrigger { triggers: [] }]->(idle)`). This is how the parser identifies the root and is the "stay put" behavior for unrecognized input.

> **Author note on the self-loop:** The idle self-loop is deliberately explicit. It signals to readers that unrecognized input at idle is intentional, not an oversight. Don't omit it — the loader will reject the file.

NPC↔NPC messages are ignored (sibling-NPC sender rejection). A random response is chosen from the target node's `responses` on each reply.

### Behavior rules block (optional)

Rules are evaluated in **declaration order** — first match wins. Each rule's `do` field is the action type discriminant; parameters depend on the action. If a rule's MCP action fails, evaluation continues to the next rule (graceful degradation).

```gram
[behavior_1:Behaviors |
  (b1:Rule { when: "item_here",     do: "take"                        }),
  (b2:Rule { when: "item_adjacent", do: "go",   toward: "nearest_item" }),
  (b3:Rule { when: "crowded",       do: "go",   toward: "random"       }),
  (b4:Rule { when: "always",        do: "idle"                         })
]

(charGuide)-[:EXHIBITS_BEHAVIOR]->(behavior_1)
```

**Supported conditions:** `inventory_empty`, `item_here` (item on current tile), `item_adjacent` (item on adjacent tile), `item_nearby` (either), `crowded` (≥2 other ghosts), `alone` (0 other ghosts), `always`

**Supported actions:**

| `do` | Params | Effect |
|---|---|---|
| `go` | `toward: "random" \| "nearest_item" \| n\|s\|ne\|nw\|se\|sw` | Move toward exit |
| `take` | _(none)_ | Take nearest item on current tile |
| `traverse` | `via: "<portal-id>"` | Use a named portal |
| `idle` | _(none)_ | No-op |

See `schema/character.gram.md` for the full format specification.

## How to add a character

1. Create `<name>.character.gram` in `NPC_CATALOG_DIR` (default `./catalog`).
2. Define a `Character` node with `enabled: true`.
3. Define at least one `DialogNode` and a `DialogTree` block with an idle state self-loop.
4. Wire with `(char)-[:HAS_DIALOG]->(dialog_id)`.
5. Restart the npc-agent (catalog is loaded once at startup).

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

## Authoring exams (`.exam.gram`)

Exams are authored in gram format. Each question is a `Problem` node with inline properties:

```gram
{ kind: "matrix-exam", schema_version: "1" }

(q1:Problem { type: "multiple_choice", weight: 2, correct: "a",
  prompt: "Which consensus algorithm does Bitcoin use?",
  options: { a: "Proof of Work", b: "Proof of Stake", c: "DPoS", d: "PBFT" } })

(q2:Problem { type: "short_answer", weight: 1, correct: "Satoshi Nakamoto",
  prompt: "Name the pseudonymous creator of Bitcoin." })

(q3:Problem { type: "numerical", weight: 1, correct: 21000000, tolerance: 0,
  prompt: "What is the maximum supply of Bitcoin in whole units?" })

[exam:Exam | q1, q2, q3]
```

Supported question types: `multiple_choice` (case-insensitive exact match on option key), `short_answer` (case-insensitive exact match), `numerical` (within `tolerance` of `correct`).

The quizmaster loads the exam at spawn time, computes two SHA-256 hashes committed to the EvalContract:
- `artifactRef` — hash of prompt-only snippets (no answer key)
- `disclosureRef` — hash of full snippets (with answer key)

After the exam completes the quizmaster reveals the full artifact in a `say()` message so anyone with access to the conversation thread can verify `sha256(bytes) === disclosureRef`.

See `catalog/bitcoin-basics.exam.gram` as a working example.
