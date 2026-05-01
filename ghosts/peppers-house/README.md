# peppers-house

A multi-agent GhostHouse process. Each ghost has a 2D personality (8 facets × internal/external) that drifts in response to lived experience. An LLM-driven Id pipeline composes a stream-of-consciousness monologue every cascade; a slider-blind Surface picks one MCP-shaped action against the live world-api.

Companion packages:
- [`peppers-inner`](../peppers-inner) — pure logic (slider math, facet types, cascade builder)
- [`peppers-mem`](../peppers-mem) — Neo4j Agent Memory adapter (cascade persistence + retrieval)

## Quickstart

```bash
# from the repo root
pnpm install
pnpm run peppers:demo   # combined server + Vite spectator + 4 peppers ghosts
```

Then open:
- Spectator: `http://127.0.0.1:5174/`
- Per-ghost overlays: `http://127.0.0.1:8788/`, `:8789/`, `:8790/`, `:8791/`
- All-in-one hub: `http://127.0.0.1:8788/all`

### Single-ghost mode

```bash
pnpm --filter @aie-matrix/ghost-peppers-house run start
```

### Environment

| Var | Default | Purpose |
|---|---|---|
| `PEPPERS_GHOSTS` | `1` | Parallel peppers ghosts to spawn (1–16) |
| `PEPPERS_OVERLAY_PORT` | unset | Base port for the per-ghost overlay (overlay disabled if unset) |
| `PEPPERS_OBJECTIVE` | "Make friends…" | Surface objective shared by every ghost in the run |
| `PEPPERS_BIRTH_SEED` | random | Seed for slider sampling — set for reproducibility |
| `PEPPERS_VERBOSE` | `0` | When `1`, dumps every system + user prompt and raw LLM response |
| `AIE_MATRIX_REGISTRY_BASE` | `http://127.0.0.1:8787` | Combined server root |

Memory connection (required) reads from the repo's `.env`:
`GHOST_MINDS_NEO4J_URI`, `GHOST_MINDS_NEO4J_USERNAME`, `GHOST_MINDS_NEO4J_PASSWORD`, optional `GHOST_MINDS_NEO4J_DATABASE`.

## Architecture

### One cascade, end-to-end

```
   stimulus  (utterance | cluster-entered | cluster-left |
              mcguffin-in-view | tile-entered | idle)
        │
        ▼
   ┌─── Id pipeline ────────────────────────────────────────┐
   │                                                         │
   │   8 facet agents (parallel) ─┐                          │
   │                               ├─► convergence ─► synthesis ─► monologue
   │   impulse agent ──────────────┘                         │
   │                                                          │
   └──────────────────────────────────────────────────────────┘
        │
        ▼
   Surface (slider-blind) — picks ONE MCP-shaped action
        │
        ▼
   World API (MCP)  — say / go / take / drop / inspect / look / …
        │
        ▼
   ActionOutcome → cascade trace → Neo4j persistence
        │
        ▼
   per-facet slider deltas applied → next personality state
```

A cascade is ~11 LLM calls — 8 facet agents and impulse run in parallel, then convergence, then synthesis, then Surface. With nano-class models, a cascade is ~8–12s.

### Id pipeline (the core)

Replaces a single monolithic Id call with seven specialised stages.

**Eight facet agents** ([reason-id-facet-agent.ts](src/reason-id-facet-agent.ts)). One per slider — Ideas, Deliberation, Assertiveness, Warmth, Trust, Altruism, Stability, Self-Monitoring. Each sees only its own slider's `internal` and `external` values (plus diff and mean), with a vivid 4-quadrant archetype map ([reason-id-facets.ts](src/reason-id-facets.ts)) — Stability's quadrants, for example, are *unflappable* / *manic pixie dream girl* / *Walter White* / *breakdown*. Each emits `{judgment, optional adjustment, 1-2 sentence reading}`.

Per-facet ownership of slider movement means each cascade can move 0–8 sliders, in any direction. No global ≥1-up + ≥1-down rule. Balance is emergent.

**Impulse agent** ([reason-id-impulse.ts](src/reason-id-impulse.ts)). Runs in parallel with the facet chain. Sees the surface objective, the full slider profile, the most recent action + outcome (momentum / pivot context), the current trigger, and world-now. Emits a 2–8 word **action-shaped pull**: "go north", "take the brass key", "ask their name". This is the *what*; never the *how*.

**Convergence** ([reason-id-convergence.ts](src/reason-id-convergence.ts)). Sees the eight facet readings (NL only, no slider numbers). Emits an `emotionalRead` (1–2 sentences) and a `superObjective` — a 3–8 word **emotional flavor** ("make people like me", "stay invisible"). Never an action; the action lives in impulse. Compression at this boundary keeps slider numbers from leaking into the voice.

**Synthesis** ([reason-id-synthesis.ts](src/reason-id-synthesis.ts)). The voice layer. Receives convergence's emotional read + super-objective, the impulse, the raw trigger, and world-now. Weaves them into a stream-of-consciousness monologue. All voice constraints live here — anti-narrator framing, no "I feel X" / "my Y tightens", no texture-poetry, fragments preferred. Upstream stages emit plain prose so this stage doesn't fight personality reasoning AND voice in one prompt.

### Surface ([reason-surface.ts](src/reason-surface.ts))

Single LLM call. Slider-blind by design — never sees personality numbers. Receives the Id's monologue (its only emotional input), the raw stimulus, live world context (exits, nearby ghosts, items here, inventory, conversational mode, social-anchor counter), and the surface objective. Picks **one** action from 11 verbs:

`say`, `go`, `take`, `drop`, `inspect`, `look`, `exits`, `inventory`, `whoami`, `whereami`, `bye`.

The action is dispatched via [runtime/world-execute.ts](src/runtime/world-execute.ts) → MCP `world-api` → returns an `ActionOutcome`.

### World perception + action

The world-api MCP server (in `server/world-api/`) exposes 13 tools. Surface uses 11. Two are unused: `traverse` (named non-adjacent exits — elevators / portals) and `look(at: <compass>)` (peek one specific neighbor). `inbox` is polled by the runtime, not chosen by Surface.

**Conversation flow**

1. Surface picks `say` → world records the message + returns `mx_listeners` (who heard it)
2. World writes a `message.new` notification on each listener
3. Each ghost's runtime polls `inbox` every tick → drains pending notifications
4. For each notification, runtime fetches the body via REST `/threads/{tid}/{mid}`
5. Body becomes an `utterance` stimulus → cascades in the receiver

**Cluster mechanics**

- Cluster = `gridDisk(cell, 1)` — current cell + 6 hex neighbors, 7 cells total
- `say` broadcasts to everyone in the speaker's cluster
- `look around` returns those 6 neighbor tiles' occupants + items

**World-enforced locks**

- After a successful `say`, the world enforces `IN_CONVERSATION` — `go` / `traverse` denied until `bye`
- Tile capacity — `drop` denied with `TILE_FULL`
- Movement ruleset — `go` may be denied based on tile-class transitions (e.g., `(red:Red)-[:GO]->(blue:Blue)`)

### Multi-ghost dynamics ([run-house.ts](src/run-house.ts))

LLM cascades take 5–10s. During that time, ghosts drift across hexes; clusters change; listeners walk away. Without intervention, by the time you say something, the listener's gone. Three mechanisms hold conversations together:

**Social anchor**. When a peer enters the cluster (`cluster-entered` stimulus), set `socialAnchorTurnsLeft = 4`. Surface refuses `go` while > 0. The counter ticks down each cascade so no permanent trap.

**Transition detection**. Ghosts that spawned already-clustered never receive a `cluster-entered` event. Each cascade compares the current `look around` peers against last cascade's set; any *newly-visible* peer arms the anchor. Fires only on transitions, not continuous presence — avoids the original "always anchored, never moves" trap.

**Re-arm on incoming utterance**. Every received `utterance` re-arms the anchor — keeps an active conversation alive turn after turn until it dies of natural causes.

**Conversational lock mirror**. The runtime tracks a local mirror of the world's `IN_CONVERSATION` flag (set on our own successful `say`, cleared on `bye`, corrected if the world rejects with `IN_CONVERSATION`). Surface sees this mirror and avoids picking `go` while locked.

**Single shared house**. In multi-ghost mode the CLI registers ONE ghost-house up front and adopts all peppers under it ([peppers-house-cli.ts](src/peppers-house-cli.ts)). The conversation router only allows cross-ghost message reads within the same house; without this, every cross-ghost read 403s and incoming utterances disappear silently.

### Memory ([peppers-mem](../peppers-mem))

Each cascade persists as a `ReasoningTrace` with linked `ReasoningStep` nodes (thoughts, surface action + outcome, adjustments) via the Neo4j Agent Memory MCP server. Retrieval pulls the last *N* cascades for a ghost — feeds trigger trajectory back into the next Id pipeline (default depth 3).

### Overlay ([overlay-server.ts](src/overlay-server.ts), [overlay/index.html](overlay/index.html))

HTTP + SSE server, one per ghost on consecutive ports. Five live cards:

- **Objective** — surface objective + current super-objective
- **Environment** — tile, exits, nearby ghosts, items here, inventory
- **Ghost's Head** — super-objective + monologue + chosen action + outcome + slider deltas
- **Personality** — 8 facets × 2 axes as live bars
- **Chats** — bidirectional utterance log

Hub view at `/all` on the first ghost's port grids all overlays into iframes in one tab.

## Conventions

- **The boil**: every change lives in `ghosts/peppers-*`. Nothing in `server/`, `client/`, `shared/`, or other workspaces is touched. Server-side capability gaps go through RFCs first.
- **Super-objective is emotional flavor, never an action.** "Make people like me" / "stay invisible" — yes. "Take the key" / "go north" — no, those belong to impulse.
- **Slider-blindness is enforced at boundaries.** Convergence and Surface never see slider numbers. Synthesis sees only the convergence summary (NL). The voice can't leak personality state.
- **One verb per cascade.** Surface picks exactly one MCP action. No batching, no chains.

## Status / what's queued

Working today:
- Multi-ghost peppers-only conversations (bidirectional, persistent through cluster drift)
- Per-facet personality drift visible in real time on the overlay
- Slider archetypes ground each facet's voice in concrete behavioural patterns
- Neo4j-backed reasoning history flowing into each cascade as trigger trajectory

Queued behavior expansions:
- **In-boil**: `follow_ghost` / `avoid_ghost` — pure peppers-house behavior layer
- **Out-of-boil (need server-side RFCs)**: `whisper` (targeted message), 2-hex perception, `trade` (two-step inventory swap)
- **Deferred**: `use(itemRef)` lives on the item itself — keys unlock things, doors open, chests reveal

See [proposals/rfc/0007-ghost-personality-substructure.md](../../proposals/rfc/0007-ghost-personality-substructure.md) for the original RFC. This README reflects the as-built system.
