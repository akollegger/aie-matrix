# RFC-0001: Minimal Proof-of-Concept

**Status:** draft  
**Date:** 2026-04-12  
**Authors:** @akollegger  
**Related:** [Architecture](../../docs/architecture.md), [Project Overview](../../docs/project-overview.md), [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md)

## Summary

Establish a minimal, runnable proof-of-concept that connects the world backends,
an MCP ghost API, a GhostHouse provider process, a Phaser spectator client, and
a rule-based ghost navigating a Tiled hex map on behalf of an IRL caretaker. The
primary goal is to validate the source layout and core architectural boundaries
— not to build production-ready features. A contributor should be able to clone
the repo, run the PoC locally, and watch an adopted ghost walk around a map in a
browser.

## Motivation

Before anyone builds game mechanics, memory modules, or vendor integrations, the project needs a working skeleton with a shared source layout. Without it, parallel contributions will make incompatible structural assumptions that are expensive to reconcile later.

The PoC validates three things:

1. **The source layout works for parallel contribution.** Packages are small and focused enough that contributors can work independently without constant merge conflicts.
2. **The architectural boundaries hold.** GhostHouse provisions ghosts, world backends run the world, and Phaser observes. Nothing crosses that boundary accidentally.
3. **The MCP ghost interface is implementable.** An adopted ghost can connect and navigate using only the MCP tools — no Colyseus knowledge required.

## User Stories

These are the acceptance criteria. The PoC is done when all four are true.

**Ghost agent implementer**
> As a ghost provider implementer, I can register a GhostHouse, adopt a ghost for a caretaker, and have that ghost navigate the hex map using the MCP tools — without reading Colyseus source code or understanding its internals.

**Spectator**
> As a spectator, I can open a browser, see the hex map, and watch one or more ghosts moving across it in real time.

**Contributor**
> As a new contributor, I can clone the repo, follow the setup instructions in the root README, and have the full PoC running locally within 15 minutes, including the developer-facing adoption flow.

**Ghost implementer in any language**
> As a ghost implementer working in any language, I can run the TCK against my implementation and get a clear pass or fail with actionable output.

## Design

### Source Layout

```
aie-matrix/
├── server/
│   ├── colyseus/       # Authoritative world state; WebSocket broadcast to spectators
│   ├── world-api/      # MCP server: tile queries and ghost movement tools
│   ├── registry/       # REST API: GhostHouse registration and ghost adoption
│   └── auth/           # JWT middleware: token issuance and validation
├── client/
│   └── phaser/         # Spectator client: renders world state from Colyseus broadcasts
├── shared/
│   └── types/          # Types and MCP tool schemas shared across TS packages
├── ghosts/             # Flat namespace: all ghost-side code (see naming convention below)
│   ├── ts-client/      # TypeScript MCP client SDK
│   ├── python-client/  # Python MCP client SDK (stub for PoC)
│   ├── random-house/   # PoC GhostHouse provider: registry, adoption, embedded random walker
│   └── tck/            # Technology Compatibility Kit
└── maps/               # Tiled map files (.tmj / .tsx / .png assets)
```

**Monorepo tooling** — TypeScript packages are wired as a **pnpm** workspace (`pnpm-workspace.yaml` at the repo root, single `pnpm-lock.yaml`). Run `pnpm install` from the repository root before package-local commands. The **`ghosts/python-client/`** stub ships as **Python** (`pyproject.toml`) only and is intentionally **not** a pnpm workspace member.

**`ghosts/` naming convention** — packages under `ghosts/` are a **flat list**;
there is no nested subtype hierarchy (for example, no `ghosts/providers/…`).

- **`ghosts/<house-name>-house/`** — runnable packages that implement the
  GhostHouse provider role: register with the registry, provision adopted ghosts,
  and run them on behalf of caretakers.
- **`ghosts/<client-name>-client/`** — MCP client SDKs for ghost authors.
- **`ghosts/tck/`** — compatibility validation against a live local stack.

The PoC reference provider is **`ghosts/random-house/`**: one process that
performs GhostHouse duties and embeds the rule-based random walker (built on
`ts-client/`). Splitting walker logic into a separate package under `ghosts/` is
out of scope for the PoC unless reuse pressure appears.

An optional **`ghosts/README.md`** may summarize this namespace; it documents
the convention rather than working around a deeper directory tree.

Packages are sized for parallel contribution — each has a single focused
capability. `server/colyseus/`, `server/world-api/`, `server/registry/`, and
`server/auth/` are siblings rather than nested because they have distinct owners
and change at different rates. `ghosts/` is top-level and language-agnostic: **all**
ghost-side deliverables (client SDKs, house runtimes, TCK) live as siblings in
one namespace, separate from the world backend so they can be contributed
independently.

For the PoC, all server packages run in a single process. The package boundaries exist to prevent coupling, not to mandate separate deployments from day one.

### server/world-api — MCP Server

`world-api/` is an MCP server. It exposes four tools that together give a ghost everything it needs to navigate:

- **`get_tile`** — returns the class, current occupants, and capacity of a tile
- **`get_neighbors`** — returns the IDs of adjacent tiles reachable from a given tile
- **`get_ghost_position`** — returns the tile ID currently occupied by a ghost
- **`move_ghost`** — requests movement to an adjacent tile; returns success or a rejection reason

Movement validation happens here. The `move_ghost` tool checks the destination tile against the movement rule table before accepting the move. On acceptance it updates Colyseus state, which triggers the spectator broadcast.

Tool schemas are defined in `shared/types/` as the canonical source. Python and other language SDKs derive from these definitions.

### server/colyseus — Spectator Broadcast

Colyseus owns the in-memory tile graph and authoritative ghost positions. After each valid move it broadcasts a state patch to all connected Phaser spectators over WebSocket.

Ghost agents never connect to Colyseus directly. Phaser clients are read-only.

### Movement Rules

Movement rules live in `server/world-api/` — that is where validation happens. Rules are keyed by tile class and evaluated on each `move_ghost` call. For the PoC, three tile classes are sufficient: `hallway` (always passable), `session-room` (capacity-limited), and `vendor-booth` (always passable). Adding a new tile class means adding one rule entry — no changes to ghost or client code.

### server/registry — Provider Registration And Adoption Lifecycle

`registry/` handles GhostHouse provider registration and caretaker ghost adoption
via REST. Registration is an operational action rather than an agent reasoning
step, so REST is appropriate here. For the PoC, a GhostHouse registers once on
startup, and an adopted ghost is then provisioned for a caretaker through a
developer-facing flow. The PoC enforces a `1 caretaker ↔ 1 ghost` adoption rule
for the session and does not support reassignment.

### server/auth — JWT Middleware

`auth/` issues and validates JWTs. Both `world-api/` and `registry/` use it. For the PoC a hardcoded dev secret is acceptable. Production auth is explicitly deferred.

### ghosts/ts-client — TypeScript MCP Client SDK

`ts-client/` wraps the MCP client protocol behind a clean async interface:
`getPosition()`, `getNeighbors()`, `move()`. Ghost implementations built on
`ts-client` have no direct dependency on MCP protocol details or Colyseus. Any
provider registration or adoption step happens before the ghost begins using the
navigation tools.

LLM-backed ghosts built on agentic frameworks (LangChain, LangGraph, Claude tool use, etc.) can instead point their framework's MCP client directly at `world-api/` and use tool calling natively — `ts-client/` is primarily for rule-based and custom agent implementations.

### ghosts/python-client — Python MCP Client SDK

`python-client/` provides the same surface in Python. For the PoC a working stub
covering adoption-time credential use, `get_neighbors`, and `move` is
sufficient. Its presence in the layout signals from the start that non-TypeScript
ghosts are first-class contributors.

### ghosts/random-house — PoC GhostHouse Provider

`random-house/` is a standalone process, separate from the world backends, that
registers as a GhostHouse with the registry, provisions adopted ghost instances,
and runs them on behalf of caretakers. For the PoC it can expose a
developer-facing startup or script flow rather than an attendee-facing UI.

The embedded **random walker** (not a separate top-level package) is built on
`ts-client/`. After adoption, it loops: query neighbors, pick one at random,
attempt to move, retry on rejection, wait a configurable tick interval. It has
no goal model, no memory, and no LLM — just enough behavior to make the spectator
view interesting and validate the full stack end-to-end.

### client/phaser — Spectator Client

Phaser connects to Colyseus via WebSocket and re-renders ghost positions on each broadcast. It has no write path. The `client/phaser/` nesting leaves room for future clients (`client/mobile/`, `client/ambient/`) without restructuring.

### Tile Map

A small abstract hex map authored in Tiled is sufficient for the PoC — it does not need to resemble Moscone West yet. Map files live in `maps/` at the repo root, accessible to both the server (loads the tile graph at startup) and Phaser (loads the same file for rendering). Each tile carries a `tileClass` custom property that `world-api/` reads to populate the movement rule dispatch.

### ghosts/tck — Technology Compatibility Kit

The TCK is a test suite that runs against a live local server and validates **the
published registry and MCP contracts** for **a house-provisioned ghost** — that
is, a ghost that has been adopted and is exercised through the same registration,
adoption, and tool flows any GhostHouse-backed ghost must support. It does not
introduce a separate “provider tier” or alternate classification beyond those
published interfaces. For the reference PoC stack, the TCK may drive or assume
`ghosts/random-house/` as the house that provisions the ghost under test.

The minimal step sequence is:

1. Register a GhostHouse provider.
2. Adopt one ghost for one caretaker and receive the credentials needed to run it.
3. Query current position — receive a valid tile ID.
4. Query neighbors — receive a non-empty list.
5. Move to a valid neighbor — receive confirmation.
6. Attempt an invalid move — receive a rejection with a reason.
7. Stop cleanly.

Any implementation in any language passes if it can drive these steps correctly. The full TCK spec is left for a follow-up RFC; the PoC establishes its location and runs a minimal version.

### Demo Scenario

This is the happy path a contributor follows to verify the PoC is working:

1. `git clone` the repo and run the setup command from the root README (install dependencies, build packages).
2. Start the server: `pnpm run dev` from `server/` — starts Colyseus, world-api, and registry in a single process.
3. Open the spectator client: navigate to `http://localhost:3000` in a browser. The hex map renders; no ghosts yet.
4. Start **`ghosts/random-house/`** (documented command) and complete an adoption
   through the developer-facing flow. The process registers as a GhostHouse,
   provisions an adopted ghost for a caretaker, and runs the embedded random
   walker.
5. The browser updates in real time as the ghost steps across the map,
   respecting tile-class movement rules.
6. Run the TCK: `pnpm test` from `ghosts/tck/`. All steps pass.

A second terminal running a second instance of `ghosts/random-house/` should show
two ghosts navigating independently.

### Data Flow

```
ghosts/random-house
  │  register provider (REST)
  │  adopt ghost for caretaker (REST) → credentials; provision & run walker (in-process)
  │
  │  MCP tool calls: get_ghost_position, get_neighbors, move_ghost
  ▼
server/world-api (MCP server)
  │  validates movement rules
  │  updates Colyseus room state
  ▼
server/colyseus
  │  broadcasts state patch via WebSocket
  ▼
client/phaser (spectator)
  renders ghost positions
```

## Open Questions

1. **MCP transport** — MCP supports stdio (local subprocess) and SSE over HTTP (remote). SSE is closer to production topology and should be preferred even in local dev. Confirm before implementing `world-api/`.

2. **world-api ↔ Colyseus coupling** — For the PoC, `world-api/` calls Colyseus room methods in-process. This should be treated as a PoC convenience, not a permanent design. A follow-up ADR should address multi-process deployment.

3. **Hex orientation** — flat-top or pointy-top? Must be consistent across `world-api/` coordinate math and Phaser rendering. Decide before writing any hex math.

4. **Cross-language tool schemas** — TypeScript is the canonical definition. How do Python and future SDKs stay in sync? Options include JSON Schema generated from TS or treating the MCP `tools/list` response as the runtime source of truth. Decide before `python-client/` is fully implemented.

5. **Developer-facing adoption flow** — For the PoC, what is the simplest acceptable caretaker/adoption mechanism: seed data, CLI script, or minimal admin endpoint? Decide before writing setup docs.

6. **LLM-backed ghost in the PoC** — Should the PoC include a second ghost that uses an LLM framework pointed at `world-api/` natively (no `ts-client/`)? This would validate the "no custom glue" claim from ADR-0001. Deferred; could be a follow-up contribution.

## Alternatives

**WebSocket (Colyseus client) for ghosts** — Natural for realtime MMORPGs; wrong here. Ghost agents deliberate on seconds-to-minutes timescales. Persistent connections add complexity without benefit and force every ghost SDK to implement Colyseus framing. Spectators need realtime streaming; ghost agents do not.

**REST as the ghost wire protocol** — Simpler to implement than MCP; any HTTP client can consume it. Rejected because LLM agentic frameworks require custom glue to call REST endpoints, and that glue would be written repeatedly across contributors. See ADR-0001.

**Flat `packages/` layout** — Collapses all server packages under one entry. Easier to scaffold but hides distinct ownership and increases branch conflicts as contributors grow.

**Single-language SDKs (TypeScript only)** — Defers the cross-language contract question and signals non-JS ghosts are secondary. The cost of adding a Python stub now is near zero; the cost of adding it later after assumptions calcify is not.

**Generated map instead of Tiled** — Removes the Tiled dependency but skips validation of the asset pipeline (Tiled → server tile graph → Phaser rendering). That pipeline is worth proving early.
