# ADR-0007: Three-Tier Deployment Strategy

**Status:** proposed  
**Date:** 2026-05-17  
**Authors:** @akollegger

## Context

The project launched as a local PoC with all services running in a single Node.js process and in-memory state. Moving toward production for the AI Engineer World's Fair requires:

- Stateful services: **Neo4j** (world graph, ghost positions, goal state) and **Redis** (Colyseus `RedisPresence` + `RedisDriver` for horizontal scaling)
- Multiple independently deployable service processes (`colyseus`, `world-api`, `registry`, `ghost-house`)
- A clear path from a fast local-dev loop to a load-tested staging environment to a conference-day production cluster

Without a documented deployment model, each developer makes incompatible local assumptions, staging diverges from production, and the CI/CD open question in `docs/architecture.md` stays open.

## Decision

We adopt a **three-tier deployment strategy** where the same codebase and container images move across environments driven exclusively by configuration. No code branching per environment.

| Tier | Target | Orchestration | Redis | Neo4j |
|------|--------|---------------|-------|-------|
| **1 — Local dev** | Developer workstation | `pnpm dev` (watch mode) | In-memory (`LocalPresence`) | Docker Desktop or native install |
| **2 — Staging** | Single VM or CI runner | `docker compose up` | Redis container (Compose service) | Neo4j container (Compose service) |
| **3 — Production** | GCP / GKE | Kubernetes (Helm) | GCP Memorystore (Redis) | Neo4j Aura (managed) |

### Tier 1 — Local dev

`pnpm dev` starts all services in watch mode via a root-level `dev` script. Colyseus uses its default `LocalPresence` (single-process, in-memory). Developers run Neo4j locally (Docker Desktop one-liner or native). No Docker required for the application code itself.

Required env vars (`.env` or shell):
```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<local>
# REDIS_URL omitted → LocalPresence
```

### Tier 2 — Staging

A `docker-compose.yml` at the repo root (or `deploy/staging/`) defines:
- One container per service package (`colyseus`, `world-api`, `registry`, `ghost-house`)
- A `redis:7` service
- A `neo4j:5` service with persistent volume
- A shared `aie-matrix` network

Images are built from the repo's multi-stage `Dockerfile` (one per package, sharing a common base layer). Compose mounts no source code; it runs the built artefacts. This tier is the contract-validation gate before production.

### Tier 3 — Production (GCP / GKE)

Each service runs as a Kubernetes `Deployment` behind a `Service`. Helm charts under `deploy/k8s/` parameterise image tags, replica counts, and resource limits. External traffic enters through a GCP `LoadBalancer` or `Ingress`.

- **Redis**: GCP Memorystore (managed Redis). `REDIS_URL` injected via Kubernetes `Secret`.
- **Neo4j**: Neo4j Aura (managed cloud). `NEO4J_URI` injected via Kubernetes `Secret`.
- **Colyseus horizontal scaling**: `RedisPresence` + `RedisDriver` enabled when `REDIS_URL` is set.
- **Secrets**: Kubernetes `Secret` objects; never committed to the repo.
- **Service discovery**: Kubernetes `Service` DNS (`colyseus.aie-matrix.svc.cluster.local`).

### Mutable operational resources

Maps, movement rules, item definitions, ghost conversation history, and the A2A agent catalog are **not baked into container images**. They are operational content that changes independently of the application code.

| Resource | Local dev | Staging | Production |
|----------|-----------|---------|------------|
| Maps (`.map.gram`) | file on dev workstation | read-only volume mount | GCS bucket |
| Rules (`.gram`) | file on dev workstation | read-only volume mount | GCS bucket |
| Items (`.items.json`) | co-located sidecar | read-only volume mount | GCS bucket |
| Conversation history | JSONL on local disk | JSONL on named volume | Neo4j Aura |
| Ghost house catalog | `catalog.json` on disk | JSON on named volume | Neo4j Aura |

In Tier 3, world-api fetches map and rules artifacts from GCS at startup (or on demand via the map management API — see follow-on RFC) and seeds Neo4j. After seeding, **Neo4j is the runtime source of truth**; world-api does not re-read local files in production.

### Source-of-truth hierarchy

Three layers own distinct authority in staging and production:

| Layer | Owns | Notes |
|-------|------|-------|
| **GCS bucket** | Authored artifacts (maps, rules, items) | Immutable per version; publish step uploads here |
| **Neo4j Aura** | Live world state (cells, ghost positions, relationships, active map pointer, conversation history, agent catalog) | Seeded from GCS on publish; authoritative for all runtime queries |
| **world-api** | Rule enforcement and MCP tool surface | Derives its view from Neo4j, not from files in staging/production |

The current local-dev model — where world-api reads `.map.gram` from disk at startup — is a convenience shortcut that does not carry forward to multi-replica deployments.

### Configuration contract

A single env-var contract governs all tiers:

| Variable | Local default | Staging/Prod |
|----------|--------------|-------------|
| `NEO4J_URI` | `bolt://localhost:7687` | injected |
| `NEO4J_USER` | `neo4j` | injected |
| `NEO4J_PASSWORD` | local value | Secret |
| `REDIS_URL` | *(unset → LocalPresence)* | `redis://redis:6379` / Memorystore URL |
| `GCS_BUCKET` | *(unset → local file fallback)* | `gs://aie-matrix-maps` |
| `CONVERSATION_DATA_DIR` | `data/conversations` | *(unset → Neo4j store)* |
| `CATALOG_FILE_PATH` | `./catalog.json` | *(unset → Neo4j store)* |
| `AIE_MATRIX_MAP` | `maps/sandbox/freeplay.map.gram` | GCS object path or omitted (active map from Neo4j) |
| `AIE_MATRIX_RULES` | *(unset → permissive)* | GCS object path or omitted |
| `NODE_ENV` | `development` | `production` |
| `PORT` | per-package default | Kubernetes `containerPort` |

The Effect-ts `Layer` for each stateful service reads these variables at startup via `@aie-matrix/root-env` and wires the correct implementation. No runtime `if (NODE_ENV === 'production')` guards in business logic. The behaviour of an unset `GCS_BUCKET` (fall back to local file) and an unset `CONVERSATION_DATA_DIR` (fall back to JSONL) preserves the local-dev workflow without special-casing.

## Rationale

- **Environment parity**: Staging uses the same built Docker images as production, catching integration failures before conference day.
- **Colyseus scaling is already designed for this**: `RedisPresence` and `RedisDriver` are the official Colyseus multi-process mechanism; enabling them is a configuration change, not a code change.
- **docker-compose is the right staging tool**: It faithfully reproduces the multi-service topology at low operational cost and matches what GitHub Actions CI can run on a standard runner.
- **GKE for production**: GCP is the natural host for a project using Memorystore (managed Redis). Kubernetes provides the scaling and rolling-update guarantees needed for a live conference.
- **Neo4j Aura**: Eliminates StatefulSet management on GKE (no PersistentVolumeClaim, no backup configuration). Aura is a Neo4j-managed cloud service with SLA guarantees appropriate for a live event.
- **No code branching**: Effect-ts `Layer` composition makes the right implementation injectable by environment. Branching the codebase per environment is a maintenance anti-pattern.
- **GCS for authored artifacts**: Maps, rules, and items are content, not code. Storing them in GCS decouples content updates from service deploys and lets the future map management API operate without touching container images.
- **Neo4j as the runtime source of truth, not world-api**: world-api currently reads files at startup, but it is an enforcement service, not a store. In multi-replica deployments, each replica reading its own local file is a split-brain risk. Routing all runtime reads through Neo4j (seeded once at publish time) eliminates per-replica divergence and makes world-api stateless and horizontally scalable.

## Alternatives Considered

- **Heroku / Fly.io for staging**: Easier initial setup but diverges from GKE topology (networking model, secrets management). Configuration differences that pass staging could fail in production.
- **Skip staging; go dev → prod directly**: High risk for a live conference. Staging is the only place to validate multi-container wiring, volume mounts, and Redis failover before attendees connect.
- **Single docker-compose for all environments**: Works at small scale but lacks the rolling-update, health-check, and autoscaling primitives needed for conference-day load spikes.
- **Colyseus Cloud**: Managed hosting from the Colyseus team. Removes operational burden but constrains the ability to co-locate world-api and ghost-house in the same cluster, and adds a vendor dependency at the real-time core.
- **Neo4j self-hosted on GKE**: More control but adds StatefulSet management, backup procedures, and upgrade coordination. Neo4j Aura offloads this operationally without changing the driver or query surface.

## Consequences

### What becomes easier

- **CI/CD**: GitHub Actions can run `docker compose up` in staging mode, giving integration-level confidence on every PR without a live cluster.
- **Onboarding**: New contributors need only `pnpm install` + local Neo4j; no Docker required for the dev loop.
- **Horizontal scaling**: Adding Colyseus replicas on conference day is a `kubectl scale` command with no code changes.

### What becomes harder / new obligations

- **Dockerfiles**: Each service package needs a multi-stage `Dockerfile`. This is new work.
- **Helm charts**: Kubernetes manifests need to be authored and kept in sync with service changes.
- **Local Neo4j**: Developers must run Neo4j locally. A `docker-compose.dev.yml` providing only the stateful services (Redis + Neo4j) can reduce friction.
- **Secrets hygiene**: Kubernetes `Secret` objects and `.env` files must never be committed. `@aie-matrix/root-env` already reads from the environment; this is an operational discipline requirement.
- **Service discovery changes between tiers**: Localhost ports in Tier 1 become DNS names in Tier 2/3. Services must not hard-code `localhost`; all inter-service URLs must be configurable env vars.
- **Filesystem-to-Neo4j migration for conversation history and agent catalog**: `server/conversation` (JSONL store) and `ghosts/ghost-house` (catalog.json) currently write to local disk. In production these must write to Neo4j Aura. Each will need an Effect-ts `Layer` implementation backed by Neo4j, selected when `CONVERSATION_DATA_DIR` / `CATALOG_FILE_PATH` are unset in the production config. This is new implementation work gated behind staging validation.
- **Map publish step**: A "publish map" operation (upload `.map.gram` + sidecar to GCS, seed Neo4j, update active-map pointer) is required before production can serve a new map. The interface for this is out of scope for this ADR; it is deferred to the map management RFC.
- **world-api refactor**: Removing the local-file read path from world-api in favour of Neo4j is a non-trivial change to `MapService` and `ItemService`. This work is explicitly deferred until the local-file fallback is no longer required (i.e., when the map publish workflow exists).

### Open questions resolved

This ADR resolves the **CI/CD Pipeline** open question in `docs/architecture.md`: GitHub Actions for CI; `docker compose` for staging validation; GKE for production.

### Confirmed decisions (resolved during proposal)

1. **GCP / GKE** is the agreed production platform.
2. **Neo4j Aura** (managed) is the production Neo4j target — not self-hosted on GKE.
3. **`@aie-matrix/root-env`** provides the env-loading contract and will be extended to cover all variables listed above if not already present.
