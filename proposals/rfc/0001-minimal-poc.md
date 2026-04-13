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

The **`ghosts/README.md`** file summarizes this namespace for contributors (FR-019); it documents the convention rather than working around a deeper directory tree.

Packages are sized for parallel contribution — each has a single focused
capability. `server/colyseus/`, `server/world-api/`, `server/registry/`, and
`server/auth/` are siblings rather than nested because they have distinct owners
and change at different rates. `ghosts/` is top-level and language-agnostic: **all**
ghost-side deliverables (client SDKs, house runtimes, TCK) live as siblings in
one namespace, separate from the world backend so they can be contributed
independently.

For the PoC, all server packages run in a single process. The package boundaries exist to prevent coupling, not to mandate separate deployments from day one.

### server/world-api — MCP Server

`world-api/` is an MCP server. It exposes **five** short, adventure-flavored tools that together give a ghost everything it needs to navigate (names are stable API identifiers; natural-language flavor lives in MCP tool descriptions):

- **`whoami`** — who is this session’s ghost (identity and caretaker linkage for debugging and agent grounding).
- **`whereami`** — which tile id the ghost currently occupies.
- **`look`** — inspect **from here only**: class, occupants, and optional map metadata; argument **`at`** is `here` (default), `around`, or one compass face **`n`/`s`/`ne`/`nw`/`se`/`sw`** (see [research.md](../../specs/001-minimal-poc/research.md) ghost compass). **No arbitrary tile-id parameters.**
- **`exits`** — list traversable faces **from here only** (no arguments): each exit names a **`toward`** direction and the neighbor tile id reached that way.
- **`go`** — step one face from here; **required `toward`** in `n`/`s`/`ne`/`nw`/`se`/`sw`**. Success or structured rejection. **No destination tile-id parameter** — the server resolves the neighbor from the compass table.

Movement validation happens here. The **`go`** tool resolves the neighbor from **`toward`** (must exist on the map), then applies the **configured movement ruleset** that is **separate from the map**. **Capacity-based occupancy limits are deferred for the PoC** (no special treatment of `capacity` in validation). On acceptance it updates Colyseus state, which triggers the spectator broadcast.

Tool schemas are defined in `shared/types/` as the canonical source. Python and other language SDKs derive from these definitions.

### server/colyseus — Spectator Broadcast

Colyseus owns the in-memory tile graph and authoritative ghost positions. After each valid move it broadcasts a state patch to all connected Phaser spectators over WebSocket.

Ghost agents never connect to Colyseus directly. Phaser clients are read-only.

### Movement ruleset (separate from the map)

Movement policy lives in `server/world-api/` as a **ruleset** that is independent of any particular `.tmj` / `.tsx` file. The map supplies **geometry** and **per-tile metadata** the engine loads (for example Tiled tile `type` as class label). **`capacity` and other custom properties are ordinary optional data** for later rules; the PoC does not require validating moves against them.

Normative direction for richer rules: evaluate **edges** between neighboring cells using the classes of the **exit** and **entry** tiles, along the lines of `(from:Cyan4)-[:ALLOWED]->(to:Green1)`. Later versions may attach predicates to those edges (for example comparing `to.capacity` to a threshold, or consulting world flags). **Venue semantics** (rooms, doors, passages, elevators) are expressed by **which tiles appear on the map** plus **which rules apply** in that context — not by encoding all behavior into tile class names alone.

**PoC default:** ship a **permissive no-op ruleset** that allows every class transition the adjacency graph already permits, so ghosts can wander the sandbox while the stack is still wiring up. Stricter venue rules and predicates land in the same ruleset layer later without changing the map contract.

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

`ts-client/` wraps Streamable HTTP MCP behind **`GhostMcpClient`** (`connect`, `callTool`, …). Ghost implementations call world tools such as **`whoami`**, **`whereami`**, **`exits`**, and **`go`** without Colyseus knowledge. Provider registration and adoption happen **before** the ghost session uses MCP (typically via REST in the house process).

LLM-backed ghosts built on agentic frameworks (LangChain, LangGraph, Claude tool use, etc.) can instead point their framework's MCP client directly at `world-api/` and use tool calling natively — `ts-client/` is primarily for rule-based and custom agent implementations.

### ghosts/python-client — Python MCP Client SDK

`python-client/` provides the same surface in Python. For the PoC a working stub
covering adoption-time credential use, `exits`, and `go` is
sufficient. Its presence in the layout signals from the start that non-TypeScript
ghosts are first-class contributors.

### ghosts/random-house — PoC GhostHouse Provider

`random-house/` is a standalone process, separate from the world backends, that
registers as a GhostHouse with the registry, provisions adopted ghost instances,
and runs them on behalf of caretakers. For the PoC it can expose a
developer-facing startup or script flow rather than an attendee-facing UI.

The embedded **random walker** (not a separate top-level package) is built on
`ts-client/`. After adoption, it loops: call **`exits`**, pick one **`toward`**
direction at random from the listed exits, call **`go`** with that direction,
retry on rejection, wait a configurable tick interval. It has
no goal model, no memory, and no LLM — just enough behavior to make the spectator
view interesting and validate the full stack end-to-end.

### client/phaser — Spectator Client

Phaser connects to Colyseus via WebSocket and re-renders ghost positions on each broadcast. It has no write path. The `client/phaser/` nesting leaves room for future clients (`client/mobile/`, `client/ambient/`) without restructuring.

### Tile Map

A small abstract hex map authored in Tiled is sufficient for the PoC — it does not need to resemble Moscone West yet. Map files live in `maps/` at the repo root, accessible to both the server (loads the tile graph at startup) and Phaser (loads the same file for rendering). Each tile definition may carry arbitrary metadata the world loads (for example Tiled **`type`** as class string, optional custom properties such as **`capacity`** for future rules). That metadata **feeds** the movement ruleset over time but **is not** the ruleset: policy stays in `world-api/` configuration/code.

### ghosts/tck — Technology Compatibility Kit

The TCK validates **published registry + MCP** behavior against a **live** combined server. It does not introduce a separate provider tier beyond those interfaces.

**PoC as-shipped (normative):** the minimal step subset lives in [`specs/001-minimal-poc/contracts/tck-scenarios.md`](../specs/001-minimal-poc/contracts/tck-scenarios.md) — **reachability** (`GET /spectator/room`) → **registry adopt** → **MCP `whereami`**. Run: `pnpm run test:tck` from the repo root (**server must already be running**).

**Longer-term target** (non-blocking for PoC closure): extend toward `exits`, valid/invalid `go`, shutdown, and second-language drivers; capture in a follow-up RFC when user-journey and multi-house surfaces stabilize.

### Demo Scenario

Happy path aligned with the **root** `README.md` and [`specs/001-minimal-poc/quickstart.md`](../specs/001-minimal-poc/quickstart.md):

1. `git clone` → **`pnpm install`** at the repo root (`corepack enable` once if you rely on the pinned pnpm).
2. **`pnpm run demo`** — one terminal starts the combined server, Phaser (Vite), and `random-house` (see `scripts/demo.mjs`). Alternatively use **`pnpm run poc:server`**, **`pnpm run poc:client`**, and **`pnpm run poc:ghost`** in separate shells for debugging.
3. Open the **Vite “Local”** URL (default **http://127.0.0.1:5174/** or `http://localhost:5174/`). Map renders; ghost markers appear once the house has adopted.
4. Optional smoke: with the server still up, **`pnpm run test:tck`** exercises the minimal registry + **`whereami`** gate.

**Two ghosts:** `pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2` (one house, two caretakers) or two separate `pnpm run poc:ghost` processes (two houses).

### Data Flow

```
ghosts/random-house
  │  register provider (REST)
  │  adopt ghost for caretaker (REST) → credentials; provision & run walker (in-process)
  │
  │  MCP tool calls: whereami, exits, go
  ▼
server/world-api (MCP server)
  │  validates adjacency and movement ruleset
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
