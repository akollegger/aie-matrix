# Architecture

This document describes the technical foundation of the Matrix, flags what is decided, and explicitly marks what is left open for contributors.

See the [Project Overview](./project-overview.md) for the product and game design context.

---

## Decided Stack

These components are chosen. Proposals to swap them out require an ADR with a strong justification.

| Component | Technology | Role |
|---|---|---|
| Game client (debugger) | [Phaser](https://phaser.io/) | Hex-tile world rendering, developer debug UI — `clients/debugger/phaser` |
| Human spectator client | React, [deck.gl](https://deck.gl/) (geospatial stops), [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/) (Personal stop), Vite | `clients/intermedium` — 7-stop camera model (Global→Personal); H3 world full-bleed; panels as overlays; deck.gl for geospatial stops, R3F for Personal stop ([ADR-0006](../proposals/adr/0006-personal-stop-renderer.md)); see [RFC-0008](../proposals/rfc/0008-human-spectator-client.md) |
| Realtime server | [Colyseus](https://colyseus.io/) | Authoritative world state, WebSocket connections, room management |
| Server orchestration | [Effect-ts](https://effect.website/) | Dependency injection, typed error handling, structured concurrency, observability |
| Horizontal scaling | [Redis](https://redis.io/) (`RedisPresence` + `RedisDriver`) | Colyseus multi-process pub/sub and matchmaking |
| World model | [Neo4j](https://neo4j.com/) | Tile graph, ghost positions, social graph, goal state, quest progress |
| Blob storage | S3 (or compatible) | Session recordings, slide assets, post-processed artifacts |
| Front-end hosting | GCS backend buckets + Cloud CDN + Cloud Load Balancer | Static SPA hosting: `play.matrix.relateby.dev` (Intermedium, public CDN) and `admin.matrix.relateby.dev` (Admin, IAP-gated); separate from GKE Ingress ([ADR-0008](../proposals/adr/0008-frontend-deployment-access-control.md)) |
| Operator access control | Google Identity-Aware Proxy (IAP) | Authenticates operators to the Admin client via Google Identity at the load-balancer layer; no application code required ([ADR-0008](../proposals/adr/0008-frontend-deployment-access-control.md)) |
| Deployment | Docker + Kubernetes | Containerized services, scalable cluster deployment |

**Note on Colyseus + Redis:** Redis is the official Colyseus horizontal scaling mechanism. `RedisPresence` handles pub/sub and shared state across processes; `RedisDriver` handles distributed matchmaking. Single-process development can use the default in-memory presence.

**Note on the ghost agent layer:** Ghosts do not require Phaser. The game client visualizes the world; agents move through it via Colyseus and Neo4j. These are separable concerns.

**Note on the agent host (`@aie-matrix/server-agent-host`, spec `009-agent-host-a2a`):** The canonical house is an out-of-process service that **hosts** third-party ghost agents over **A2A** (per ADR-0004 and RFC-0007). It does not replace the world’s MCP surface; it **proxies** tool calls to the world server, **subscribes** to Colyseus as a agent host client to receive `world.*` event fanouts, and **supervises** registered agents (spawn, health, world-event delivery, shutdown).

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

Canonical cell identity for ghosts, Colyseus `ghostTiles`, and MCP tools is **H3 resolution 15** (see [RFC-0004](../proposals/rfc/0004-h3-geospatial-coordinate-system.md)). Tiled maps supply `h3_anchor` so every navigable cell gets a stable `h3Index`. In **Neo4j**, `(:Tile { h3Index })` is the node identity for the world graph (uniqueness constraint `tile_h3_unique`); non-adjacent exits use `ELEVATOR` and `PORTAL` relationship types with a `name` property matching MCP `exits` / `traverse`.

### Map formats: two readers during the transition (RFC-0009)

As of `specs/013-gram-format-migration`, **`.map.gram` is the sole runtime format** across all consumers:

| Consumer | Format | Code |
|----------|--------|------|
| Colyseus room | `.map.gram` (layered format) | `server/colyseus/src/mapLoader.ts` → `mapLoader.gram.ts` via `@aie-matrix/map-gram` |
| Intermedium client | `.map.gram` (layered format) | `clients/intermedium/src/services/gramParser.ts` via `@aie-matrix/map-gram` |
| HTTP `GET /maps/:mapId` | `.map.gram` or `.tmj` | `server/world-api/src/map/MapService.ts` — byte passthrough + LayerStack validation |

The **`.map.gram`** layered format is produced by `tools/tmj-to-gram` (from Tiled `.tmj` sources) or the native map editor. All sandbox maps are committed in the layered format. Shared parsing logic lives in `@aie-matrix/map-gram` (`shared/map-gram/`). Startup validation in world-api requires a `LayerStack` walk in addition to the `kind: "matrix-map"` header.

**Tier 1 (local dev):** world-api loads the map from `AIE_MATRIX_MAP` (local file path). No GCS or session binding needed.

**Tier 2/3 (staging/production):** Maps are published to GCS via `POST /maps` (world-api validates and seeds `(:Tile)` nodes into Neo4j at publish time). A live session is activated via `POST /live`, binding a session record to a published map. world-api loads the primary map from GCS using the session assigned by `LIVE_SESSION_ID`. See [RFC-0013](../proposals/rfc/0013-map-management.md) for the full map lifecycle API.

### World item state (PoC)

World items are currently a PoC-layer extension around the existing map + MCP stack:

- Item definitions load from a `*.items.json` sidecar at startup.
- Runtime item placement and ghost inventory live in-memory in `server/world-api/src/ItemService.ts`.
- Colyseus mirrors this state through `tileItemRefs` and `ghostItemRefs` so downstream spectators can subscribe without owning the item rules.
- Neo4j persistence for item placement is explicitly deferred to a follow-on RFC.

### Selected environment variables

| Variable | Purpose |
|---|---|
| `AIE_MATRIX_RULES` | Optional path to a Gram movement rules file. Unset keeps adjacent movement permissive. |
| `AIE_MATRIX_ITEMS` | Optional path to a `*.items.json` sidecar. Unset falls back to the co-located sidecar next to the active map. |
| `AIE_MATRIX_CALENDAR` | Path to a standalone `.calendar.gram` file (current transitional loading path). Target: calendar will be loaded from the active map's `[schedule:Schedule | ...]` block; standalone file support will be removed once map-loading integration is complete. |
| `CALENDAR_TICK_MS` | Scheduler poll interval in milliseconds (default: `30000`). Set lower (e.g. `5000`) for local testing. |
| `GCS_BUCKET` | GCS bucket name for map artifact storage (e.g. `aie-matrix-maps`). Unset in Tier 1 — `GcsService` uses a local `tmp/gcs/` stub. |
| `ADMIN_TOKEN` | Static bearer token for admin-only `/maps/` and `/live/` endpoints. Never logged. Required when using map management API. |
| `LIVE_SESSION_ID` | ULID of the live session this process instance serves. Required in multi-session Tier 2/3 deployments. Unset → auto-discover single active session; fail if multiple exist. |

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
**Resolved by [RFC-0023](../proposals/rfc/0023-in-world-resource-ledger.md) and implemented in [spec 022](../specs/022-in-world-resource-ledger/).** Resource transactions are persisted as an append-only, hash-chained `(:LedgerEntry)` chain in Neo4j, scoped to the active session. Each committed `Transaction` is an event record with timestamp, cause, actor list, and transfer details. The ledger is the primary event log for resource-bearing actions. For high-frequency non-resource events (positions, proximity) the open question of a dedicated append store (ClickHouse, TimescaleDB, S3) remains for future evaluation.

### Authentication and Identity
**Operator use case resolved** ([ADR-0008](../proposals/adr/0008-frontend-deployment-access-control.md)): operators authenticate to the Admin client via Google Identity-Aware Proxy (IAP) at the load-balancer layer. No application code required; access is managed via IAM bindings.

**Attendee use case open**: How does an IRL conference badge become a ghost? Options range from simple email-based JWT to OAuth via a conference identity provider to full SSO. Okta/Auth0 (an AIEWF sponsor) is a natural candidate. Privacy and consent for ghost card sharing is a related concern.

### Voice Transcription for Speaker Agents
IRL talks could feed speaker agents via live transcription (Whisper or similar). This touches live A/V infrastructure at the venue, which is operationally complex. Whether this is in scope for v1, and what the fallback is (slides + abstract), needs a decision.

### CI/CD Pipeline
**Resolved by [ADR-0007](../proposals/adr/0007-three-tier-deployment.md) and implemented in [spec 016](../specs/016-staging-deployment/).** GitHub Actions for CI (`.github/workflows/staging-ci.yml` — builds images and runs the full compose stack on every PR targeting `main`); `docker compose` for Tier 2 staging validation (`deploy/staging/`); GKE (GCP) for production. Helm charts under `deploy/k8s/`; Neo4j Aura (managed) and GCP Memorystore (Redis) as the stateful backing services.

---

## Component Map

```
┌─────────────────────────────────────────────────────┐
│                   Attendee / Browser                 │
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

**Ghost house (A2A, `009`):** The diagram above is the long-horizon “agent layer” view. For AIEWF 2026, **ghost agents are first-party** — built from the same repo, containerized using the same Docker/K8s patterns as other services, and deployed into the same cluster (ADR-0009). The third-party remote-endpoint contribution model (ADR-0004) is deferred. First-party ghosts self-register with the agent-host catalog on startup using `AGENT_HOST_URL` and `<NAME>_PUBLIC_BASE_URL`; each container replica registers independently with a unique agentId derived from `HOSTNAME`. The agent-host has four concrete north–south links:

```
                    ┌────────────────────────┐
                    │  World server (MCP)   │
                    │  e.g. :8787/mcp         │
                    └───────────┬────────────┘
                                │ proxy (IC-003) — ghost token
                    ┌───────────▼────────────┐
  Colyseus  ◄────── │   @aie-matrix/         │
  room fanout       │   agent-host          │ ──────►  Contributor agents
  (IC-004 in)      │  bridge · A2A host     │         (A2A, /.well-known)
                    │  catalog · supervisor │
                    └────────────────────────┘
```

### Ghost house wiring (A2A contributor path)

| Connection | What crosses it |
|------------|-------------------|
| **World server (`server/world-api`, MCP at `/mcp`) ↔ Ghost house** | MCP tool calls the agent requested on its card (`matrix.requiredTools`); ghost-scoped token from the registry. Outbound `say` (Social tier) is written in the world then **fan-out** to agent host Colyseus bridge clients, which become IC-004 envelopes inside the house. |
| **Colyseus ↔ Ghost house** | Bridge client in the house subscribes as the adopted ghost; room events and `message.new` fan-out become `aie-matrix.world-event.v1` (IC-004) inside the house and are delivered to agents as A2A data/push per tier. |
| **Agent-host ↔ First-party ghosts** | HTTP A2A: agent card at `/.well-known/agent-card.json`, `message/send` for tasks and world events, catalog and session control on the agent-host HTTP API (IC-005). Ghosts self-register at startup via `POST /v1/catalog/register { agentId, baseUrl }` and deregister on SIGTERM. In compose and K8s, `baseUrl` is the container's service-DNS or pod-IP URL. |

**Contracts:** `specs/009-agent-host-a2a/contracts/` — in particular **IC-001** (agent card `matrix` block), **IC-002** (A2A + push invariants), **IC-003** (MCP tool surface), **IC-004** (world event envelope), **IC-005** (catalog HTTP), **IC-006** (spawn context).

---

## Minimal PoC (001) — subsystem ownership

The [Minimal PoC](../specs/001-minimal-poc/) combines several packages in **one Node process** (`@aie-matrix/server`). Boundaries below describe **who owns what** for that shortcut; they are not the long-term production split.

| Concern | PoC owner (code) | Notes |
|--------|-------------------|--------|
| **Spectator state** (read-only Colyseus schema, `ghostTiles` / `tileCoords`) | `server/colyseus/` (`room-schema.ts`, `MatrixRoom.ts`) | IC-004; consumed by `clients/debugger/phaser` and `clients/intermedium` via `colyseus.js`. |
| **Movement & MCP tools** (`go`, `exits`, validation) | `server/world-api/` (`mcp-server.ts`, `movement.ts`, `auth-context.ts`) | Ghosts talk MCP only; no direct Colyseus from browser or ghost SDK. |
| **World ↔ room bridge** | `server/world-api/src/colyseus-bridge.ts` | In-process calls into Colyseus mutators (PoC only). |
| **Registry & adoption** | `server/registry/` | REST `/registry/*`; in-memory store + session guard (IC-002). |
| **Ghost credentials** | `server/auth/` | Dev JWT mint/verify for adopted ghosts. |
| **Group actor** | `server/world-api/` — `GroupService` / `GroupServiceLive` | Disembodied world entity: no tile position, owns a resource bag, holds a JSONL chat thread. `(:Group)` node in Neo4j with `MEMBER_OF` (members) and `PARTICIPANT_IN` (guests) edges. Group chat fan-out targets the **member+participant set** rather than the H3 spatial cluster used by ghost proximity chat; both use the same Colyseus `message.new` signal and JSONL store. Specified in [RFC-0024](../proposals/rfc/0024-group-formation-and-chat.md), implemented in [spec 023](../specs/023-group-formation/). |
| **Eval contracts** | `server/world-api/` — `EvalContractService` / `EvalContractServiceLive` | Peer-to-peer performance agreements between ghosts. A client stakes resources into escrow; a contractor accepts or declines; an independent evaluator issues a verdict in `[0,1]` that triggers settlement. `(:EvalContract)` nodes in Neo4j; ledger movements handled by `LedgerService`. Specified in [RFC-0022](../proposals/rfc/0022-eval-contract-protocol.md), implemented in [spec 024](../specs/024-eval-contracts/). |
| **Contracts & shared types** | `shared/types/`, `specs/001-minimal-poc/contracts/` | Source of truth for REST/MCP shapes; keep docs and code aligned. |
| **Phaser debugger (spectator)** | `clients/debugger/phaser/` | Loads `maps/` assets; **no** move RPC. |
| **Agent-host + first-party ghosts** | `server/agent-host/`, `ghosts/random-agent/` | Canonical house: catalog, MCP proxy, Colyseus bridge, A2A supervisor. `random-agent` is the reference Wanderer: containerized per ADR-0009, self-registers on startup, deregisters on SIGTERM. Add new ghosts following `ghosts/README.md`. |

---

## Proposals

See [proposals/](../proposals/) for RFCs and ADRs.  
See [proposals/adr/README.md](../proposals/adr/README.md) for the ADR format.  
See [proposals/rfc/README.md](../proposals/rfc/README.md) for the RFC format.
