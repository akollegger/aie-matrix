# ADR-0007: Three-Tier Deployment Strategy

**Status:** accepted  
**Date:** 2026-05-17  
**Authors:** @akollegger

## Context

The project launched as a local PoC with all services running in a single Node.js process and in-memory state. Moving toward production for the AI Engineer World's Fair requires:

- Stateful services: **Neo4j** (world graph, ghost positions, goal state) and **Redis** (Colyseus `RedisPresence` + `RedisDriver` for horizontal scaling)
- Multiple independently deployable service processes (`colyseus`, `world-api`, `registry`, `agent-host`)
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
- One container per service package (`colyseus`, `world-api`, `registry`, `agent-host`)
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

In Tier 3, world-api fetches map and rules artifacts from GCS at startup (or on demand via the map management API — see [RFC-0013](../rfc/0013-map-management.md)) and seeds Neo4j. After seeding, **Neo4j is the runtime source of truth**; world-api does not re-read local files in production.

### Source-of-truth hierarchy

Three layers own distinct authority in staging and production:

| Layer | Owns | Notes |
|-------|------|-------|
| **GCS bucket** | Authored artifacts (maps, rules, items) | Immutable per version; publish step uploads here |
| **Neo4j Aura** | Live world state (cells, ghost positions, relationships, active map pointer, conversation history, agent catalog) | Seeded from GCS on publish; authoritative for all runtime queries |
| **world-api** | Rule enforcement and MCP tool surface | Derives its view from Neo4j, not from files in staging/production |

The current local-dev model — where world-api reads `.map.gram` from disk at startup — is a convenience shortcut that does not carry forward to multi-replica deployments.

### Operational resilience

#### Startup dependency order

Services must start in dependency order. Kubernetes readiness probes enforce this; docker-compose `depends_on: condition: service_healthy` enforces it in staging.

```
Neo4j Aura ──────────────────────────────────────┐
                                                  ▼
Redis ──────────────────┐               world-api (ready when Neo4j
                        ▼               schema check passes)
                  Colyseus (ready              │
                  when Redis +                 │
                  world-api answer)            │
                        │                      │
                        └──────────┬───────────┘
                                   ▼
                             agent-host (ready when
                             world-api + Colyseus answer)
```

Each application service exposes a `/health` endpoint that checks its own dependencies. Kubernetes `readinessProbe` hits `/health`; the service receives no traffic until it passes.

#### Failure semantics

Redis and Neo4j have different failure profiles and require different responses:

| Store | What it owns | Failure impact | Recovery |
|-------|-------------|----------------|----------|
| **Redis** | Ephemeral coordination (presence, pub/sub, matchmaking) | Cross-replica pub/sub breaks; existing Colyseus room schema survives in process memory; ghost positions in Neo4j are intact | Redis restart → Colyseus reconnects automatically via `RedisPresence` retry; ghosts re-sync on next heartbeat. No data loss. |
| **Neo4j Aura** | Live world state (cells, positions, relationships, active map, conversation history, agent catalog) | world-api rejects all tool calls; ghost movement and MCP proxy fail; agent-host cannot resolve agent catalog | world-api and agent-host enter a retry loop with exponential backoff. Colyseus continues accepting WebSocket connections but world calls error until Neo4j recovers. Neo4j Aura HA handles node failover transparently. |

#### Stateless application services

Colyseus, world-api, registry, and agent-host carry **no authoritative state that is not already in Redis or Neo4j**. Any of these services can be killed and restarted at any time without data loss:

- Colyseus restart: WebSocket clients reconnect; room state re-hydrates from ghost positions already stored in Neo4j.
- world-api restart: no local state; resumes serving from Neo4j immediately after reconnect.
- agent-host restart: agent catalog read from Neo4j on startup; registered agents re-attach via A2A heartbeat.

This property is what makes horizontal scaling (multiple Colyseus replicas) and rolling deploys (one replica at a time) safe.

#### Configuration contract

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
- **Colyseus Cloud**: Managed hosting from the Colyseus team. Removes operational burden but constrains the ability to co-locate world-api and agent-host in the same cluster, and adds a vendor dependency at the real-time core.
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
- **Filesystem-to-Neo4j migration for conversation history and agent catalog**: `server/conversation` (JSONL store) and `server/agent-host` (catalog.json) currently write to local disk. In production these must write to Neo4j Aura. Each will need an Effect-ts `Layer` implementation backed by Neo4j, selected when `CONVERSATION_DATA_DIR` / `CATALOG_FILE_PATH` are unset in the production config. This is new implementation work gated behind staging validation.
- **Map publish step**: A "publish map" operation (upload `.map.gram` + sidecar to GCS, seed Neo4j, update active-map pointer) is required before production can serve a new map. The interface for this is out of scope for this ADR; it is defined in [RFC-0013](../rfc/0013-map-management.md).
- **world-api refactor**: Removing the local-file read path from world-api in favour of Neo4j is a non-trivial change to `MapService` and `ItemService`. This work is explicitly deferred until the local-file fallback is no longer required (i.e., when the map publish workflow exists).

### Open questions resolved

This ADR resolves the **CI/CD Pipeline** open question in `docs/architecture.md`: GitHub Actions for CI; `docker compose` for staging validation; GKE for production.

### Confirmed decisions (resolved during proposal)

1. **GCP / GKE** is the agreed production platform.
2. **Neo4j Aura** (managed) is the production Neo4j target — not self-hosted on GKE.
3. **`@aie-matrix/root-env`** provides the env-loading contract and will be extended to cover all variables listed above if not already present.

## Tier 3 Deployment Plan

The following is the concrete procedure for standing up the GCP/GKE production environment from scratch. It assumes a GCP project exists with billing enabled and `gcloud` is authenticated.

### Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | GCP infrastructure | ✅ complete |
| 2 | Neo4j Aura | ✅ complete |
| 3 | Kubernetes secrets | ✅ complete |
| 4 | Helm charts | ✅ complete |
| 5 | CI/CD — image push + deploy | ✅ complete |
| 6 | DNS and TLS | ✅ complete |
| 7 | First deploy and verification | ✅ complete |

---

### Phase 1 — GCP Infrastructure

**Enable required APIs:**
```bash
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com
```

**Set default region** (us-central1 recommended — co-located with Neo4j Aura free tier):
```bash
gcloud config set compute/region us-central1
```

**Create Artifact Registry repository** (stores built container images):
```bash
gcloud artifacts repositories create aie-matrix \
  --repository-format=docker \
  --location=us-central1 \
  --description="aie-matrix container images"
```

Images will be tagged as `us-central1-docker.pkg.dev/aie-matrix/aie-matrix/<service>:<tag>`.

**Create GKE Autopilot cluster** (Autopilot manages node pools; no manual node sizing):
```bash
gcloud container clusters create-auto aie-matrix-prod \
  --region=us-central1 \
  --release-channel=stable
```

**Create GCP Memorystore Redis instance** (1 GB Basic tier is sufficient for presence + pub/sub):
```bash
gcloud redis instances create aie-matrix-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=basic
```

Record the host IP:
```bash
gcloud redis instances describe aie-matrix-redis --region=us-central1 --format="value(host)"
```

`REDIS_URL` will be `redis://<host>:6379`. GKE pods access Memorystore via VPC peering — no public IP needed.

**GCS bucket for map artifacts** (may already exist; skip if so):
```bash
gcloud storage buckets create gs://aie-matrix-maps \
  --location=us-central1 \
  --uniform-bucket-level-access
```

---

### Phase 2 — Neo4j Aura

1. Create an **AuraDB Professional** (or Free for testing) instance at [neo4j.io/cloud/aura](https://neo4j.io/cloud/aura/).
2. Choose region closest to `us-central1` (e.g., `us-east-1` on Aura).
3. Note the connection URI (`neo4j+s://...`), username (`neo4j`), and generated password.
4. Store these in Secret Manager (Phase 3).

Aura Free is limited to one instance and 200K nodes — sufficient for the conference. Upgrade to Professional if load testing reveals limits.

---

### Phase 3 — Kubernetes Secrets

Store all credentials in GCP Secret Manager and sync to Kubernetes via [External Secrets Operator](https://external-secrets.io/) or create them directly with `kubectl`. Direct `kubectl` is simpler for a first deployment:

```bash
# Point kubectl at the new cluster
gcloud container clusters get-credentials aie-matrix-prod --region=us-central1

kubectl create namespace aie-matrix

kubectl create secret generic aie-matrix-secrets \
  --namespace=aie-matrix \
  --from-literal=NEO4J_URI="neo4j+s://<aura-host>" \
  --from-literal=NEO4J_USER="neo4j" \
  --from-literal=NEO4J_PASSWORD="<aura-password>" \
  --from-literal=REDIS_URL="redis://<memorystore-host>:6379" \
  --from-literal=GCS_BUCKET="aie-matrix-maps" \
  --from-literal=ADMIN_TOKEN="<strong-random-token>" \
  --from-literal=GHOST_HOUSE_DEV_TOKEN="<strong-random-token>" \
  --from-literal=AIE_MATRIX_INTERNAL_FANOUT_TOKEN="<strong-random-token>"
```

Never commit these values to the repo.

---

### Phase 4 — Helm Charts

Charts live under `deploy/k8s/charts/`. Each service chart follows the same pattern: `Deployment` + `Service` + optional `HorizontalPodAutoscaler`. Values files parameterise image tags, replica counts, and resource limits.

```
deploy/k8s/
  charts/
    server/          # combined server (Colyseus + world-api + registry)
    agent-host/      # A2A agent host
  values-production.yaml
```

Key chart decisions:
- **`readinessProbe`**: HTTP GET `/health` — enforces the startup dependency order at the Kubernetes layer (mirrors `depends_on: service_healthy` in Compose).
- **`secretRef`**: All env vars sourced from `aie-matrix-secrets` (Phase 3) — no plaintext values in chart files.
- **`HPA`**: `server` scales 2–8 replicas on CPU ≥ 60%; `agent-host` scales 1–4 replicas.
- **Colyseus horizontal scaling**: `REDIS_URL` being set activates `RedisPresence` + `RedisDriver` automatically — no code changes needed.

See `deploy/k8s/` once charts are authored for full manifest detail.

---

### Phase 5 — CI/CD: Image Push and Deploy

Extend `.github/workflows/staging-ci.yml` (or create a separate `production-deploy.yml`) triggered on `v*` tag push:

1. **Build** images (reuses the multi-stage Dockerfiles from Tier 2).
2. **Push** to Artifact Registry:
   ```bash
   gcloud auth configure-docker us-central1-docker.pkg.dev
   docker tag aie-matrix-staging-server us-central1-docker.pkg.dev/aie-matrix/aie-matrix/server:$TAG
   docker push us-central1-docker.pkg.dev/aie-matrix/aie-matrix/server:$TAG
   ```
3. **Deploy** via Helm:
   ```bash
   helm upgrade --install server deploy/k8s/charts/server \
     --namespace aie-matrix \
     --set image.tag=$TAG \
     -f deploy/k8s/values-production.yaml
   ```

GKE Workload Identity should be used to authenticate the GitHub Actions runner — avoids long-lived service account keys.

---

### Phase 6 — DNS and TLS

1. **Reserve a static external IP**:
   ```bash
   gcloud compute addresses create aie-matrix-ingress --global
   ```
2. **Point DNS** for `aie-matrix.example.com` at the reserved IP (A record).
3. **Create a Google-managed TLS certificate** via GKE Ingress annotation — GCP provisions and rotates automatically:
   ```yaml
   # In the Ingress manifest
   annotations:
     networking.gke.io/managed-certificates: "aie-matrix-cert"
   ```

WebSocket (`wss://`) requires the Ingress to pass through WebSocket upgrades — set `nginx.ingress.kubernetes.io/proxy-read-timeout` appropriately if using nginx ingress, or use the GKE native Ingress which handles WebSocket transparently.

---

### Phase 7 — First Deploy and Verification

1. **`helm install`** both charts (server, agent-host).
2. **Verify readiness**:
   ```bash
   kubectl rollout status deployment/server -n aie-matrix
   kubectl rollout status deployment/agent-host -n aie-matrix
   ```
3. **Check health endpoints**:
   ```bash
   curl https://aie-matrix.example.com/health
   # expect: {"status":"ok","checks":{"neo4j":true}}
   curl https://aie-matrix.example.com:4000/health   # or via Ingress path
   # expect: {"status":"ok","checks":{"world-api":true}}
   ```
4. **Publish a map and start a live session** (same workflow as Tier 2 — see `deploy/staging/README.md`):
   ```bash
   curl -X POST https://aie-matrix.example.com/maps \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -F "mapId=freeplay" -F "file=@maps/sandbox/freeplay.map.gram"
   curl -X POST https://aie-matrix.example.com/live \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"production","maps":[{"mapId":"freeplay","role":"primary"}]}'
   curl https://aie-matrix.example.com/live/@current/map | head -3
   ```

---

### Deferred work (required before conference day)

These items from the ADR consequences section must be completed before the production deployment is load-ready:

| Item | Blocking | Notes |
|------|---------|-------|
| Conversation history → Neo4j store | Agent conversations lost on restart | Implement Neo4j `ConversationStore` Layer, activate when `CONVERSATION_DATA_DIR` unset |
| Agent catalog → Neo4j store | Registered agents lost on `agent-host` restart | Implement Neo4j-backed catalog Layer, activate when `CATALOG_FILE_PATH` unset |
| `RedisPresence` + `RedisDriver` validation | Multi-replica Colyseus correctness | Integration test with 2+ server replicas before conference day |
| Load test | Unknown capacity ceiling | `k6` or similar against staging stack before provisioning prod replica counts |

---

## Related RFCs

| RFC | Title | Relationship |
|-----|-------|--------------|
| [RFC-0001](../rfc/0001-minimal-poc.md) | Minimal PoC | Runs all services in a single process as an explicit Tier 1 shortcut; this ADR defines how those services separate into independently deployable units at Tier 2 and Tier 3. |
| [RFC-0002](../rfc/0002-rule-based-movement.md) | Rule-Based Movement | Movement rulesets follow the GCS artifact → Neo4j seed path; the `AIE_MATRIX_RULES` local file is a Tier 1 convenience only. |
| [RFC-0005](../rfc/0005-ghost-conversation-model.md) | Ghost Conversation Model | The JSONL store is the Tier 1 implementation; a Neo4j-backed `ConversationStore` Layer is required at Tier 3, selected when `CONVERSATION_DATA_DIR` is unset. |
| [RFC-0006](../rfc/0006-world-objects.md) | World Items | Item sidecars (`.items.json`) follow the GCS artifact path in Tier 3; `ItemService` must support GCS fetch when `AIE_MATRIX_ITEMS` is not a local path. |
| [RFC-0007](../rfc/0007-agent-host-architecture.md) | Agent Host Architecture | agent-host is the last service in the startup dependency chain; its agent catalog must persist to Neo4j in Tier 3, not to `catalog.json` on disk. |
| [RFC-0008](../rfc/0008-human-spectator-client.md) | Intermedium Spectator Client | Reliable broadcast to spectators across Colyseus replicas requires `RedisPresence` + `RedisDriver`; this is a Tier 3 requirement. |
| [RFC-0009](../rfc/0009-map-format-pipeline.md) | Map Format Pipeline | `.map.gram` artifacts are the input to the GCS upload step; `MapService` must support GCS fetch in Tier 3. |
| [RFC-0010](../rfc/0010-h3geojson-map-editor.md) | H3GeoJSON Map Editor | Editor outputs are the "authored artifacts" in the source-of-truth hierarchy — they feed the publish-to-GCS workflow before world-api can serve them. |
| [RFC-0012](../rfc/0012-speaker-rooms.md) | Speaker Rooms | Room claim state must persist to Neo4j to satisfy the stateless-application-service invariant; in-memory storage would be lost on world-api restart. |
| [RFC-0013](../rfc/0013-map-management.md) | Map Management | Implements the publish/activate/archive lifecycle deferred by this ADR; defines the `/maps/` and `/live/` API surfaces and the `LIVE_SESSION_ID` env var. |
