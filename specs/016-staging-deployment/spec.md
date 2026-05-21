# Feature Specification: Staging Deployment (Tier 2)

**Feature Branch**: `016-staging-deployment`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "The second tier of @proposals/adr/0007-three-tier-deployment.md - deployment to staging."

## Proposal Context *(mandatory)*

- **Related Proposal**: [ADR-0007: Three-Tier Deployment Strategy](../../proposals/adr/0007-three-tier-deployment.md)
- **Scope Boundary**: A complete container-based staging environment that runs all aie-matrix services together using a single compose file, built from production-equivalent images. Covers Dockerfiles for each service, the compose definition, startup health-check ordering, the shared environment-variable contract, and CI integration so every PR validates the full topology.
- **Out of Scope**: Production Kubernetes/GKE manifests and Helm charts (Tier 3); local developer hot-reload workflow (Tier 1); secrets management beyond `.env.staging` conventions; load testing tooling; map publish workflow (RFC-0013); monitoring and observability stack.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator brings up the full stack locally (Priority: P1)

A developer or operator wants to validate that all aie-matrix services work together exactly as they will in production. They run a single compose command from the repo root and within a few minutes have a fully connected stack: Neo4j seeded, Colyseus accepting WebSocket connections, world-api serving MCP tools, agent-host registering agents.

**Why this priority**: This is the foundational deliverable. Everything else depends on a working compose definition. Without it, no CI integration or staging validation is possible.

**Independent Test**: Run `docker compose up` from the repo root, wait for all services to reach `healthy`, then confirm a WebSocket connection to Colyseus and a successful HTTP request to world-api's health endpoint. Delivers end-to-end confidence in multi-service wiring.

**Acceptance Scenarios**:

1. **Given** a developer has Docker Desktop running and a `.env.staging` file with required credentials, **When** they run `docker compose up`, **Then** all six services (neo4j, redis, colyseus, world-api, registry, agent-host) start in dependency order and each reports healthy within 3 minutes.
2. **Given** all services are healthy, **When** a client opens a WebSocket to the Colyseus port, **Then** the connection is accepted and a room can be joined.
3. **Given** all services are healthy, **When** a client sends an HTTP request to world-api's `/health` endpoint, **Then** the response indicates Neo4j connectivity is confirmed.
4. **Given** the stack is running, **When** the operator runs `docker compose down`, **Then** all containers stop cleanly and Neo4j data is preserved in a named volume.

---

### User Story 2 — CI pipeline validates every PR against the full topology (Priority: P2)

A contributor opens a pull request. GitHub Actions automatically builds all service images and runs `docker compose up` to confirm multi-service wiring has not regressed. The PR cannot merge if any service fails to start or its health check does not pass.

**Why this priority**: Staging CI is the contract-validation gate described in ADR-0007. Without it, staging exists only as a manual step and integration failures reach production.

**Independent Test**: Push a branch with a deliberate breakage in one service's startup (e.g., a missing env var). Confirm CI fails and reports which service was unhealthy. Then fix the breakage and confirm CI passes.

**Acceptance Scenarios**:

1. **Given** a PR is opened against `main`, **When** the CI workflow runs, **Then** it builds all service images and runs compose up; the PR check passes only if all services reach healthy.
2. **Given** a service fails its health check during CI, **When** the workflow completes, **Then** the PR check is marked failed with log output identifying the unhealthy service.
3. **Given** all services pass health checks in CI, **When** the workflow completes, **Then** compose is torn down cleanly and no dangling containers or volumes remain on the runner.

---

### User Story 3 — Operator replaces a single service without full restart (Priority: P3)

A developer has changed only `world-api` and wants to validate the fix in the running staging stack without restarting everything. They rebuild and replace just that service container while the other services continue running.

**Why this priority**: Faster iteration during staging validation; reduces the time to confirm a fix without waiting for Neo4j and Redis cold-start.

**Independent Test**: While the full stack is healthy, rebuild only the world-api image and run compose up for that one service. Confirm the other services remain healthy and world-api reconnects to Neo4j automatically.

**Acceptance Scenarios**:

1. **Given** the full staging stack is running and healthy, **When** the operator rebuilds and restarts only the world-api service, **Then** world-api reconnects to Neo4j and returns healthy within 60 seconds without restarting other services.
2. **Given** world-api is restarted while Colyseus is running, **When** world-api becomes healthy, **Then** Colyseus resumes successfully proxying world tool calls without a Colyseus restart.

---

### Edge Cases

- What happens when Neo4j is slow to start and world-api starts before it is ready? (Health-check dependency ordering must prevent world-api from being marked healthy until Neo4j is reachable.)
- What happens when the compose network is created but a service image fails to build? (Build failure must abort the `up` command with a clear error, not start partial stack.)
- What happens when the Neo4j named volume already exists from a previous run with an incompatible schema? (Operators must be able to wipe and reseed without manual volume surgery.)
- What happens when `REDIS_URL` is not set? (Colyseus must fail health check, not silently fall back to `LocalPresence` in staging where multi-replica semantics must be validated.)
- What happens when a required env var is missing from `.env.staging`? (Service startup must fail with a clear error message identifying the missing variable, not a cryptic connection error.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST provide a `docker-compose.yml` (or `deploy/staging/docker-compose.yml`) that defines all six services: `neo4j`, `redis`, `colyseus`, `world-api`, `registry`, and `agent-host`.
- **FR-002**: Each application service (`colyseus`, `world-api`, `registry`, `agent-host`) MUST be built from a per-package multi-stage `Dockerfile` that produces a runnable artifact without mounting source code.
- **FR-003**: The compose definition MUST declare a startup dependency order matching the chain: Neo4j → world-api → Redis → Colyseus → agent-host, enforced via `depends_on: condition: service_healthy`.
- **FR-004**: Each service MUST expose a `/health` HTTP endpoint that checks its own required dependencies (Neo4j connectivity for world-api; Redis + world-api for Colyseus; world-api + Colyseus for agent-host).
- **FR-005**: The compose definition MUST declare a named volume for Neo4j data so that world state persists across `docker compose down` / `up` cycles.
- **FR-006**: All services MUST share a single named Docker network (`aie-matrix`), and no service may hard-code `localhost` for inter-service communication.
- **FR-007**: All configurable values (database URIs, passwords, ports) MUST be injectable via environment variables that match the contract defined in ADR-0007; the compose file MUST read these from an `.env.staging` file or shell environment.
- **FR-008**: When `REDIS_URL` is set, Colyseus MUST use `RedisPresence` and `RedisDriver`; the health check MUST verify Redis connectivity and fail if Redis is unreachable.
- **FR-009**: A GitHub Actions workflow MUST build all service images and run `docker compose up` on every pull request targeting `main`, and the PR check MUST fail if any service does not reach healthy within a configurable timeout.
- **FR-010**: The compose definition MUST NOT mount any source-code directories; it runs only pre-built artifacts.
- **FR-011**: A convenience `docker-compose.dev.yml` override MUST be provided that starts only Neo4j and Redis for developers who run application services outside Docker (Tier 1 workflow).

### Key Entities

- **Service image**: A container image for one aie-matrix service package, built from a multi-stage Dockerfile. Tagged with the git commit SHA and optionally a human-readable label.
- **Compose stack**: The set of containers, networks, and volumes defined in `docker-compose.yml`. The unit of deployment for staging.
- **Health check**: An HTTP `/health` endpoint on each application service that reports `{ status: "ok" }` when all dependencies are reachable, used by both compose `depends_on` and Kubernetes readiness probes (Tier 3).
- **Named volume**: A Docker-managed volume for Neo4j data that survives `down` / `up` cycles.
- **`.env.staging`**: A file (gitignored) that supplies environment variables to the compose stack. Its required keys are enumerated in ADR-0007's configuration contract.

### Interface Contracts

- **IC-001**: Each service's `/health` endpoint MUST respond with HTTP 200 and `{ "status": "ok" }` when healthy; any non-200 response or connection failure counts as unhealthy for compose `depends_on` and CI timeout checks.
- **IC-002**: The environment variable names for inter-service URLs (e.g., `COLYSEUS_URL`, `WORLD_API_URL`) MUST be consistent across all service packages and match whatever is declared in `@aie-matrix/root-env`, so that compose service DNS names can be injected without code changes.
- **IC-003**: The multi-stage Dockerfiles MUST use a shared base layer (same Node.js version as declared in the repo's `.nvmrc` / `package.json` engines field) so that base image updates propagate consistently.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `docker compose up` from a clean checkout (images not yet built) completes with all services healthy in under 5 minutes on a developer workstation with a standard broadband connection.
- **SC-002**: After `docker compose up` succeeds, a WebSocket connection to Colyseus and an HTTP request to world-api's health endpoint both succeed within 10 seconds.
- **SC-003**: The CI workflow completes (build + compose up + health validation + compose down) in under 10 minutes on a standard GitHub Actions runner.
- **SC-004**: A single service can be rebuilt and restarted without restarting the remaining services, and it reconnects to its dependencies within 60 seconds.
- **SC-005**: Zero source-code files are mounted into any running container in the staging stack — verified by inspecting container mounts after `docker compose up`.
- **SC-006**: Missing or incorrect env vars in `.env.staging` cause the affected service to exit with a non-zero code and a human-readable error message within 15 seconds of startup, rather than silently degrading.

## Assumptions

- Docker Desktop (or equivalent OCI-compatible runtime) is already installed on developer workstations; this spec does not cover Docker installation.
- The `pnpm` workspace build (`pnpm build`) produces the compiled artifacts that the Dockerfiles copy into their final image stage; build tooling is already in place.
- Neo4j 5 and Redis 7 are the versions used in staging, matching the production targets (Neo4j Aura, GCP Memorystore) declared in ADR-0007.
- A `.env.staging.example` file (committed) documents every required variable with placeholder values, so contributors know what to populate in their local `.env.staging`.
- The `@aie-matrix/root-env` package already reads `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, and `REDIS_URL` from the environment; this spec assumes those variables are already wired; any new inter-service URL variables may require `root-env` extension.
- Map seeding and the map publish workflow (RFC-0013) are out of scope; the staging stack starts with an empty Neo4j and operators seed maps separately.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — Update the CI/CD open question to reference this spec and ADR-0007 as resolved; add staging setup instructions.
- `CONTRIBUTING.md` — Add a "Running the staging stack" section explaining how to populate `.env.staging` and use `docker compose up`.
- `deploy/staging/README.md` (new) — Operator runbook: how to start, stop, wipe volumes, rebuild a single service, and interpret health-check failures.
- `proposals/adr/0007-three-tier-deployment.md` — No changes needed; this spec implements what is already decided there.
