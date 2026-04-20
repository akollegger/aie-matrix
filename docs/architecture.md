# Architecture

This document describes the technical foundation of the Matrix, flags what is decided, and explicitly marks what is left open for contributors.

See the [Project Overview](./project-overview.md) for the product and game design context.

---

## Decided Stack

These components are chosen. Proposals to swap them out require an ADR with a strong justification.

| Component | Technology | Role |
|---|---|---|
| Game client | [Phaser](https://phaser.io/) | Hex-tile world rendering, spectator and attendee UI |
| Realtime server | [Colyseus](https://colyseus.io/) | Authoritative world state, WebSocket connections, room management |
| Server orchestration | [Effect-ts](https://effect.website/) | Dependency injection, typed error handling, structured concurrency, observability |
| Horizontal scaling | [Redis](https://redis.io/) (`RedisPresence` + `RedisDriver`) | Colyseus multi-process pub/sub and matchmaking |
| World model | [Neo4j](https://neo4j.com/) | Tile graph, ghost positions, social graph, goal state, quest progress |
| Blob storage | S3 (or compatible) | Session recordings, slide assets, post-processed artifacts |
| Deployment | Docker + Kubernetes | Containerized services, scalable cluster deployment |

**Note on Colyseus + Redis:** Redis is the official Colyseus horizontal scaling mechanism. `RedisPresence` handles pub/sub and shared state across processes; `RedisDriver` handles distributed matchmaking. Single-process development can use the default in-memory presence.

**Note on the ghost agent layer:** Ghosts do not require Phaser. The game client visualizes the world; agents move through it via Colyseus and Neo4j. These are separable concerns.

---

## Effect-ts Orchestration Layer

The server back-end uses Effect-ts as its orchestration framework (ADR-0002). This is a **binding contract** for all new server handlers and services.

### Service / Layer pattern

Every injectable dependency is a `Context.Tag` wrapping an interface. Implementations are provided as `Layer` values composed into a single `ManagedRuntime` at server startup. TypeScript enforces that every Effect's `R` channel (requirements) is satisfied before the code compiles.

```
Context.Tag  ←  the DI key / service identity
Layer        ←  provides an implementation of a Tag
ManagedRuntime  ←  composes all Layers; runs Effects at the HTTP boundary
```

New handlers must consume dependencies via `yield* SomeService` inside `Effect.gen`, never by direct import of a global or singleton.

### Typed error channels

Domain failures extend `Data.TaggedError`. The `E` channel of every Effect is explicit in the type signature. All error types that can reach an HTTP boundary must be covered in `errorToResponse()` (`server/src/errors.ts`) using `Match.exhaustive` — this is a compile-time guarantee.

### Structured concurrency

The transcript broadcast path uses `PubSub.dropping` backed by `Layer.scoped`, with one subscriber fiber forked per adopted ghost via `Effect.forkScoped`. The scope is tied to the ghost's session — when the session ends, the fiber is cleaned up automatically.

### Observability

Each request through `/mcp` and `/registry/adopt` carries a UUID trace ID propagated via two mechanisms:
- `AsyncLocalStorage` — covers `await` chains outside Effect fibers (MCP SDK callbacks)
- `FiberRef` — scoped to the Effect fiber tree

Structured log lines emit JSON objects with a `kind`, `op`, `traceId`, and relevant identifiers. See `docs/guides/effect-ts.md` for the logging convention.

**Guide:** `docs/guides/effect-ts.md` — patterns, examples, anti-patterns, and how to add new services and handlers.

### Movement policy vs map geometry (PoC)

Adjacent ghost `go` steps are evaluated in **`server/world-api`** (not inside Colyseus room code). The **map** supplies hex geometry and per-cell **tile classes** (Tiled types). An optional **Gram ruleset** under `server/world-api/src/rules/fixtures/` (loaded via env; see `server/world-api/README.md`) supplies allow-list **policy** as `GO` edges between class labels. Leaving **`AIE_MATRIX_RULES`** unset preserves the original permissive “any adjacent step on the map graph” baseline; setting **`AIE_MATRIX_RULES`** to a `.gram` file path enables authored policy.

Canonical cell identity for ghosts, Colyseus `ghostTiles`, and MCP tools is **H3 resolution 15** (see [RFC-0004](../proposals/rfc/0004-h3-geospatial-coordinate-system.md)). Tiled maps supply `h3_anchor` so every navigable cell gets a stable `h3Index`. In **Neo4j**, `(:Cell { h3Index })` is the node identity for the world graph (uniqueness constraint `cell_h3_unique`); non-adjacent exits use `ELEVATOR` and `PORTAL` relationship types with a `name` property matching MCP `exits` / `traverse`.

---

## Open Questions

These are explicitly unresolved. They are contribution surfaces, not gaps. Open an RFC or ADR to propose an answer.

### Agent Framework
What framework, if any, do ghost agents use for goal decomposition, planning, and execution? Options range from simple state machines to LangGraph, AutoGen, custom implementations, or something purpose-built. The interface matters more than the implementation — whatever is chosen must support the goal/plan/checkpoint model described in the overview.

### Ghost Memory Interface
What does a memory module expose? At minimum: write a fact, query by relevance or recency, handle conflicts. Beyond that — vector stores, knowledge graphs, episodic memory, continual learning — is open. **Vendor contributions are explicitly invited here.**

### LLM Providers
Which models power ghost reasoning, speaker agents, and vendor NPCs? Multiple providers should be supportable. The agent layer should be model-agnostic. Latency characteristics at conference-scale (3000+ concurrent ghosts) need to be validated.

### Observability and Telemetry
**Status: Implemented (ADR-0002, branch 002-effect-ts-transition).** The server uses request-scoped trace IDs propagated via `AsyncLocalStorage` and `FiberRef`, with structured JSON log lines tagged by `kind`, `op`, `traceId`, and entity IDs. Tool choice for downstream analytics, APM, and the eval layer remains open.

### Time-Series / Event Log Backend
The Matrix generates continuous streams: ghost movements, card exchanges, checkpoint events, quest completions, session attendance. These need to be captured for leaderboards, eval, and post-conference analysis. Options include ClickHouse, TimescaleDB, structured logs to S3 + query layer, or similar. Open.

### Authentication and Identity
How does an IRL conference badge become a ghost? Options range from simple email-based JWT to OAuth via a conference identity provider to full SSO. Okta/Auth0 (an AIEWF sponsor) is a natural candidate. Privacy and consent for ghost card sharing is a related concern.

### Voice Transcription for Speaker Agents
IRL talks could feed speaker agents via live transcription (Whisper or similar). This touches live A/V infrastructure at the venue, which is operationally complex. Whether this is in scope for v1, and what the fallback is (slides + abstract), needs a decision.

### CI/CD Pipeline
What runs on PRs, how are services built and deployed, and how is the Kubernetes cluster managed? Likely GitHub Actions for CI; deployment tooling is open.

---

## Component Map

```
┌─────────────────────────────────────────────────────┐
│                   Attendee / Browser                │
│         Phaser Client  ·  Ghost Management UI       │
└──────────────────┬──────────────────────────────────┘
                   │ WebSocket
┌──────────────────▼──────────────────────────────────┐
│                  Colyseus Server                    │
│         Room Management  ·  State Sync              │
│         Checkpoint Delivery  ·  Notifications       │
└──────┬───────────────────────────────────┬──────────┘
       │ RedisPresence / RedisDriver        │ Queries
┌──────▼──────┐                   ┌────────▼──────────┐
│    Redis    │                   │      Neo4j        │
│  Pub/Sub    │                   │   World Graph     │
│  Presence   │                   │   Social Graph    │
└─────────────┘                   │   Goal State      │
                                  └───────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────┐
│                  Agent Layer                        │
│   Ghost Reasoning  ·  Goal/Plan Engine              │
│   Memory Module Interface  ·  Checkpoint Logic      │
│   Speaker Agents  ·  Vendor NPCs                    │
└──────┬─────────────────────────────────┬────────────┘
       │                                 │
┌──────▼──────┐                 ┌────────▼────────────┐
│ LLM Provider│                 │  Memory Modules     │
│  (open)     │                 │  (pluggable)        │
└─────────────┘                 └─────────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────┐
│             Telemetry / Event Log (open)            │
│   Ghost events  ·  Checkpoints  ·  Quest state      │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────▼────────┐
              │   S3 / Blob Store   │
              │  Slides  · Assets   │
              │  Recorded streams   │
              └─────────────────────┘
```

---

## Minimal PoC (001) — subsystem ownership

The [Minimal PoC](../specs/001-minimal-poc/) combines several packages in **one Node process** (`@aie-matrix/server`). Boundaries below describe **who owns what** for that shortcut; they are not the long-term production split.

| Concern | PoC owner (code) | Notes |
|--------|-------------------|--------|
| **Spectator state** (read-only Colyseus schema, `ghostTiles` / `tileCoords`) | `server/colyseus/` (`room-schema.ts`, `MatrixRoom.ts`) | IC-004; consumed by `client/phaser` via `colyseus.js`. |
| **Movement & MCP tools** (`go`, `exits`, validation) | `server/world-api/` (`mcp-server.ts`, `movement.ts`, `auth-context.ts`) | Ghosts talk MCP only; no direct Colyseus from browser or ghost SDK. |
| **World ↔ room bridge** | `server/world-api/src/colyseus-bridge.ts` | In-process calls into Colyseus mutators (PoC only). |
| **Registry & adoption** | `server/registry/` | REST `/registry/*`; in-memory store + session guard (IC-002). |
| **Ghost credentials** | `server/auth/` | Dev JWT mint/verify for adopted ghosts. |
| **Contracts & shared types** | `shared/types/`, `specs/001-minimal-poc/contracts/` | Source of truth for REST/MCP shapes; keep docs and code aligned. |
| **Phaser spectator** | `client/phaser/` | Loads `maps/` assets; **no** move RPC. |
| **Reference GhostHouse** | `ghosts/random-house/` | Registration + adoption + MCP walker (uses `ghosts/ts-client/`). |

---

## Proposals

See [proposals/](../proposals/) for RFCs and ADRs.  
See [proposals/adr/README.md](../proposals/adr/README.md) for the ADR format.  
See [proposals/rfc/README.md](../proposals/rfc/README.md) for the RFC format.
