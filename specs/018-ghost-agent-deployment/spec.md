# Feature Specification: Ghost Agent Deployment

**Feature Branch**: `018-ghost-agent-deployment`  
**Created**: 2026-05-22  
**Status**: Draft  
**Input**: First-party ghost agents must be runnable locally, containerized for Tier 2 compose, and deployable to GCP staging (Tier 3), following the decision in ADR-0009.

## Proposal Context *(mandatory)*

- **Related Proposals**:
  - [ADR-0009: First-Party Ghost Deployment for Initial Release](../../proposals/adr/0009-first-party-ghost-deployment.md) — the scoping decision this spec implements
  - [ADR-0007: Three-Tier Deployment Strategy](../../proposals/adr/0007-three-tier-deployment.md) — the three deployment tiers
  - [ADR-0004: A2A as the Ghost Agent Protocol](../../proposals/adr/0004-a2a-ghost-agent-protocol.md) — behavioral tiers (Wanderer/Listener/Social) and agent card schema
  - [RFC-0007: Agent Host Architecture](../../proposals/rfc/0007-ghost-house-architecture.md) — catalog API, spawn contract, and supervision model
  - [Spec 016: Staging Deployment](../016-staging-deployment/spec.md) — the compose and Docker patterns this spec extends
- **Scope Boundary**: Define and implement the standard pattern for running, containerizing, and deploying first-party ghost agents across all three tiers. The reference implementation is `ghosts/random-agent/`. Any ghost added to `ghosts/` after this spec follows the same pattern without a new spec.
- **Out of Scope**: Ghost agent logic or behavior; third-party agent contribution (deferred per ADR-0009); agent host supervisor internals; the follow-up auth ADR for external agent endpoints; LLM integration; ghost memory backends.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer runs random-agent locally against a local stack (Priority: P1)

A developer wants to see a ghost moving in the world. They have the full local stack running (world-api, Colyseus, agent-host) and start `random-agent` with a single command. The ghost appears in the world, registers itself with the agent-host catalog, and begins moving at random. The developer can watch movement via the Intermedium client or Neo4j browser.

**Why this priority**: This is the baseline integration test. All container-level work builds on this being reliable first.

**Independent Test**: Run `pnpm dev` in `ghosts/random-agent/` while the local stack is up. Confirm the ghost registration appears in the agent-host catalog at `GET /v1/catalog` and that ghost movement events appear in the Colyseus room.

**Acceptance Scenarios**:

1. **Given** the local stack (neo4j, world-api, Colyseus, agent-host) is running, **When** a developer runs `pnpm dev` in `ghosts/random-agent/` with `AGENT_HOST_URL` and `AGENT_SELF_URL` set, **Then** the agent self-registers and a ghost appears in the world within 30 seconds.
2. **Given** random-agent is running and registered, **When** a developer queries `GET /v1/catalog` on the agent-host, **Then** the response includes random-agent's entry with its current `url` and `matrix.tier: "wanderer"`.
3. **Given** random-agent is running, **When** the developer stops the process (Ctrl-C), **Then** the ghost is released from the world and the catalog entry is cleaned up within the agent-host's health-check timeout (30s per RFC-0007).

---

### User Story 2 — Operator brings up the full stack including ghost agents via compose (Priority: P1)

An operator runs `docker compose up` and gets the full aie-matrix experience: infrastructure (neo4j, redis), game servers (colyseus, world-api), the agent host, and at least one ghost agent — all healthy and connected. The ghost is moving in the world without any manual intervention.

**Why this priority**: This is the Tier 2 deliverable and the prerequisite for staging validation.

**Independent Test**: Run `docker compose up` from the repo root. Confirm all services including the ghost container reach `healthy`, the ghost registers in the catalog, and ghost movement appears in the Colyseus room.

**Acceptance Scenarios**:

1. **Given** a developer runs `docker compose up` with a valid `.env.staging`, **Then** all services including `random-agent` start in dependency order and reach healthy within 5 minutes.
2. **Given** the compose stack is up, **When** the `random-agent` container starts, **Then** it calls `POST /v1/catalog/register` on the agent-host and the registration succeeds; the agent-host catalog reflects the registration.
3. **Given** the ghost is registered, **When** the agent-host spawns it, **Then** the ghost begins moving autonomously and movement events are visible in the Colyseus room.
4. **Given** the compose stack is running, **When** only the `random-agent` container is rebuilt and restarted, **Then** it re-registers and resumes movement without restarting any other service.

---

### User Story 3 — Operator deploys ghost agents to GCP staging (Tier 3) (Priority: P2)

After staging validation via compose, an operator pushes ghost agent images to Artifact Registry and applies Kubernetes manifests. Ghost agents run as Deployments in the GKE cluster, connect to the agent-host service, and self-register. The operator can scale the ghost replica count with `kubectl scale`.

**Why this priority**: This is the production deployment path. Tier 2 compose validates the image; Tier 3 validates the K8s manifests.

**Independent Test**: Apply `deploy/k8s/ghosts/random-agent.yaml` to the staging cluster. Confirm the pod starts healthy, the ghost registers in the agent-host catalog at the cluster-internal URL, and ghost movement events appear.

**Acceptance Scenarios**:

1. **Given** the GKE cluster is running with agent-host deployed, **When** `kubectl apply -f deploy/k8s/ghosts/random-agent.yaml` is run, **Then** the pod becomes `Ready` and the ghost self-registers in the catalog within 60 seconds.
2. **Given** random-agent is running at 1 replica, **When** the operator scales to 3 replicas (`kubectl scale`), **Then** each replica registers independently and the agent-host catalog shows 3 distinct random-agent entries.
3. **Given** a ghost replica crashes, **When** K8s restarts the pod, **Then** the new pod self-registers and the agent-host's supervision loop resumes without manual intervention.

---

### User Story 4 — Developer adds a new first-party ghost following the pattern (Priority: P3)

A developer wants to add a second ghost agent (`observer-agent`) to the project. They follow the pattern established by `random-agent` (Spec 018) and can copy the Dockerfile, env-var contract, and K8s manifest with minimal changes.

**Why this priority**: The template value of this spec is only realized when a second ghost is added. The pattern must be low-friction.

**Acceptance Scenarios**:

1. **Given** a new ghost package exists at `ghosts/observer-agent/`, **When** the developer copies and adapts the `random-agent` Dockerfile and K8s manifest, **Then** `docker compose up` starts observer-agent without changes to any other file.
2. **Given** observer-agent self-registers with `matrix.tier: "listener"`, **When** the agent-host catalog is queried, **Then** both random-agent (wanderer) and observer-agent (listener) appear with distinct entries.

---

### Edge Cases

- What happens when `AGENT_HOST_URL` is wrong or the agent-host is not yet ready when the ghost container starts? (Ghost must retry registration with exponential backoff, not crash immediately.)
- What happens when a ghost replica dies before deregistering? (Agent-host health-check timeout of 30s must mark the registration stale and stop routing spawn requests to it.)
- What happens when two replicas of the same ghost image start simultaneously? (Each must register with a distinct `AGENT_SELF_URL`; duplicate registrations must not overwrite each other.)
- What happens when `AGENT_SELF_URL` is set to a URL the agent-host cannot reach (e.g., `localhost` inside a container)? (Registration must succeed but spawn attempts will fail; this must produce a clear error at spawn time, not a silent hang.)

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every ghost package in `ghosts/<name>/` MUST expose a `/health` HTTP endpoint that returns `{ "status": "ok" }` when the agent is initialized and its A2A server is accepting connections.
- **FR-002**: Every ghost MUST call `POST /v1/catalog/register` on `AGENT_HOST_URL` at startup, retrying with exponential backoff until the registration succeeds or a configurable timeout (`AGENT_REGISTER_TIMEOUT`, default 120s) is exceeded, after which the process exits with a non-zero code.
- **FR-003**: Every ghost MUST include `AGENT_SELF_URL` in its agent card `url` field at registration time. `AGENT_SELF_URL` MUST be an externally reachable address from the agent-host's network perspective (not `localhost` inside a container).
- **FR-004**: Every ghost package MUST provide a multi-stage `Dockerfile` that builds a runnable artifact from the monorepo workspace without mounting source code, following the pattern in Spec 016.
- **FR-005**: The `docker-compose.yml` MUST be extended to include a `random-agent` service with `depends_on: agent-host: condition: service_healthy`.
- **FR-006**: The Kubernetes manifests for each ghost MUST be located at `deploy/k8s/ghosts/<name>.yaml` and include a `Deployment` with readiness/liveness probes on the `/health` endpoint.
- **FR-007**: Ghost containers MUST receive `AGENT_HOST_URL`, `AGENT_SELF_URL`, and `AGENT_HOST_TOKEN` via environment variables (injected from `.env.staging` in compose and from a Kubernetes Secret in Tier 3).
- **FR-008**: Ghost packages MUST NOT hard-code `localhost` for any inter-service URL.
- **FR-009**: When a ghost process shuts down cleanly (SIGTERM), it MUST call `DELETE /v1/catalog/:agentId` on the agent-host to deregister before exiting, within a 10s graceful shutdown window.
- **FR-010**: A `ghosts/README.md` (or equivalent) MUST document the repeatable steps for adding a new first-party ghost: package setup, env vars, Dockerfile, compose addition, and K8s manifest.

### Key Entities

- **Ghost package**: A TypeScript package in `ghosts/<name>/` implementing an A2A server at the ghost's behavioral tier (Wanderer / Listener / Social). Ships a `start` script and a `/health` endpoint.
- **Agent card**: The A2A agent card the ghost posts to the agent-host catalog at startup. Includes the `matrix` extension object (per IC-001 / RFC-0007) with `tier`, `ghostClasses`, `requiredTools`, etc.
- **`AGENT_SELF_URL`**: The URL at which the agent-host can reach this ghost instance. Set per-replica so each replica is addressable independently. In compose, this is the container's compose service DNS name; in K8s, it is the pod IP or headless service DNS entry.
- **`AGENT_HOST_URL`**: The base URL of the agent-host service, used by the ghost for catalog registration and health-check queries.
- **Ghost Deployment**: A Kubernetes `Deployment` resource at `deploy/k8s/ghosts/<name>.yaml` managing one or more replicas of a ghost container image.

### Interface Contracts

- **IC-001**: Ghost registration MUST use `POST /v1/catalog/register` as defined in IC-005 of Spec 009. The agent card `url` field MUST equal `AGENT_SELF_URL`.
- **IC-002**: Ghost deregistration on clean shutdown MUST use `DELETE /v1/catalog/:agentId` (IC-005). The `agentId` is the value supplied at registration time.
- **IC-003**: Ghost `/health` MUST return HTTP 200 + `{ "status": "ok" }` when the A2A server is ready; any other response or connection failure is treated as unhealthy by compose `depends_on` and K8s probes.
- **IC-004**: `AGENT_HOST_TOKEN` MUST be sent as `Authorization: Bearer <token>` on all calls from the ghost to the agent-host and from the agent-host to the ghost, matching the Phase 1 auth contract in ADR-0004.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm dev` in `ghosts/random-agent/` produces a registered, moving ghost in the world within 30 seconds when the local stack is running.
- **SC-002**: `docker compose up` starts all services including `random-agent`, all reach healthy, and ghost movement is observable within 5 minutes from a clean checkout.
- **SC-003**: Applying `deploy/k8s/ghosts/random-agent.yaml` to the staging GKE cluster produces a Ready pod and a catalog registration within 60 seconds.
- **SC-004**: Scaling the `random-agent` Deployment from 1 to 3 replicas results in 3 distinct catalog entries, each with a different `url`.
- **SC-005**: A developer can add a new ghost package (`ghosts/observer-agent/`) and have it running in compose by following `ghosts/README.md` without reading any other document.
- **SC-006**: Killing a ghost container mid-run does not crash the agent-host; the agent-host marks the registration stale after the 30s health-check timeout and stops routing to it.

---

## Deliverables

The following files are created or modified by this spec:

| File | Action | Notes |
|---|---|---|
| `ghosts/random-agent/Dockerfile` | Create | Multi-stage build following Spec 016 pattern |
| `ghosts/random-agent/.env.example` | Create | Documents `AGENT_HOST_URL`, `AGENT_SELF_URL`, `AGENT_HOST_TOKEN`, port |
| `ghosts/random-agent/src/startup.ts` | Modify | Add self-registration on startup and deregistration on SIGTERM |
| `docker-compose.yml` | Modify | Add `random-agent` service after `agent-host` |
| `deploy/k8s/ghosts/random-agent.yaml` | Create | Deployment + readiness/liveness probes |
| `deploy/k8s/secrets/ghost-house-token.yaml.example` | Create | K8s Secret template for `AGENT_HOST_TOKEN` |
| `ghosts/README.md` | Create | Repeatable pattern guide for adding new first-party ghosts |

---

## Assumptions

- The agent-host catalog API (`POST /v1/catalog/register`, `GET /v1/catalog`, `DELETE /v1/catalog/sessions/:sessionId`) is implemented per Spec 009 / IC-005 before this spec is implemented.
- `ghosts/random-agent/` already contains a working TypeScript A2A server implementation; this spec adds deployment packaging around it, not agent behavior.
- The `AGENT_HOST_TOKEN` static bearer mechanism (Phase 1 auth from ADR-0004) is already wired in the agent-host.
- K8s manifests target the same cluster and namespace as the existing `deploy/k8s/` manifests from ADR-0007.
- Ghost images are pushed to the same Artifact Registry repository as other service images during CI.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — Update the "Ghost house" section to note that first-party ghosts are containerized and deployed per this spec; update the component diagram to show ghost containers alongside agent-host.
- `ghosts/README.md` (new) — The authoritative "how to add a first-party ghost" guide; referenced by `CONTRIBUTING.md`.
- `CONTRIBUTING.md` — Add a "Contributing a ghost agent" section pointing to `ghosts/README.md`.
- `deploy/staging/README.md` — Add ghost agent startup notes to the operator runbook.
- `proposals/adr/0009-first-party-ghost-deployment.md` — No changes; this spec implements what is decided there.
