# Research: Staging Deployment Unknowns

**Feature**: 016-staging-deployment  
**Date**: 2026-05-20

---

## pnpm Monorepo Dockerfile Pattern

**Decision**: Use a three-stage Dockerfile: (1) a `base` stage that runs `pnpm fetch --prod` against only the lockfile and workspace YAML to prime the virtual store; (2) a `build` stage that copies all source, runs `pnpm install --offline` and `pnpm build`, then runs `pnpm --filter <package> deploy /app/deploy` to produce a self-contained directory with only that package's production `node_modules`; (3) a `runner` stage that copies only `/app/deploy` into a clean Node.js image.

**Rationale**: `pnpm fetch` is the official pnpm solution for Docker monorepos — it loads packages into the virtual store from the lockfile alone, maximising layer-cache reuse across all service images in the same repo. `pnpm deploy --filter <package> --prod` then produces a portable, flat `node_modules` with all workspace-internal dependencies bundled as real files (not symlinks), so the final image has no source tree and no workspace tooling. This is the pattern documented on [pnpm.io/docker](https://pnpm.io/docker) and [pnpm.io/cli/deploy](https://pnpm.io/cli/deploy). ESM (`"type": "module"`) and `--frozen-lockfile` are unaffected because `pnpm fetch` respects the lockfile by design and `pnpm deploy` copies only pre-built `dist/` artifacts.

**Alternatives considered**:
- Copying the entire monorepo source and running `pnpm install --frozen-lockfile` — simple but bloats every image with unrelated source and dev tooling.
- `pnpm pack` per package — produces a tarball but does not resolve workspace-internal dependencies automatically; more manual wiring required.

---

## Neo4j 5 Docker Health Check

**Decision**: Use `cypher-shell` with credentials extracted from `NEO4J_AUTH`:

```
test: ["CMD-SHELL", "cypher-shell -u $${NEO4J_AUTH%%/*} -p $${NEO4J_AUTH##*/} 'RETURN 1'"]
interval: 10s
timeout: 5s
retries: 10
start_period: 30s
```

**Rationale**: `cypher-shell` is the only option that proves the Bolt port is up *and* the database engine is accepting queries — not just that the JVM is alive. `wget localhost:7474` only confirms the HTTP console is listening, which comes up earlier than the Bolt/Cypher stack. The `$${NEO4J_AUTH%%/*}` / `$${NEO4J_AUTH##*/}` shell parameter expansions (double-`$` for compose variable escaping) parse username and password from the single `NEO4J_AUTH=user/pass` environment variable already required by the Neo4j image, so no additional secrets are needed. `neo4j status` is unreliable in some container configurations because it checks the process, not query readiness. A generous `start_period: 30s` avoids false failures during JVM warm-up on first boot.

**Alternatives considered**:
- `wget --spider localhost:7474` — lighter weight, but proves only HTTP console availability, not database readiness; downstream services could start before Cypher is ready.
- `/db/neo4j/cluster/available` HTTP endpoint — designed for multi-node clusters; always returns 404 or misleading results on single-node community/enterprise; not appropriate here.
- `["CMD", "neo4j", "status"]` — checks the process supervisor, not query-layer readiness; has been reported unreliable inside slim container images.

---

## GitHub Actions Docker Compose CI Pattern

**Decision**: Use `docker compose` (v2 plugin syntax, no hyphen) directly on `ubuntu-latest`. No additional setup action is needed. Use `--project-name` or set `COMPOSE_PROJECT_NAME` in the workflow to prevent collision if multiple workflows run concurrently on the same runner. Tear down with `docker compose down -v` to remove volumes.

**Rationale**: Docker Compose v2 is pre-installed as a Docker CLI plugin on `ubuntu-latest` (Ubuntu 24.04 as of early 2025). The legacy `docker-compose` v1 binary was removed from the Ubuntu 22.04 runner image in the `20240730` update and is absent from Ubuntu 24.04 images entirely. The correct command is `docker compose` (space, not hyphen). Port conflicts between parallel CI runs are unlikely on GitHub-hosted runners because each job gets an isolated virtual machine, not a shared host; no dynamic-port workaround is needed for standard single-job workflows. Known gotcha: `depends_on: condition: service_healthy` requires Compose v2 syntax — v1 ignored the `condition` key, so migrating any existing compose files is mandatory. BuildKit is enabled by default on these runners (`DOCKER_BUILDKIT=1`), so multi-stage builds benefit from parallel stage execution automatically.

**Alternatives considered**:
- `docker/setup-compose-action` marketplace action — unnecessary overhead; v2 is already present.
- Exposing service ports to the host and `curl`-polling from the workflow shell — fragile and redundant given compose's built-in `service_healthy` dependency ordering.
- Self-hosted runners — out of scope for this spec; introduces runner maintenance burden.

---

## Codebase Architecture — Runnable Process Topology

**Decision**: The staging compose stack will run **4 containers**, not 6. A future "service extraction" spec is needed to reach the 6-container ADR-0007 vision.

**Finding**: `server/colyseus` (`@aie-matrix/server-colyseus`), `server/world-api` (`@aie-matrix/server-world-api`), and `server/registry` (`@aie-matrix/server-registry`) are all **library packages** — they export TypeScript modules and have no standalone `start` script. The only runnable server process is the **combined `server` package** (`server/src/index.ts`), which imports and orchestrates all three as libraries within a single Node.js process. `server/agent-host` (→ `ghosts/agent-host` after the rename) is already a standalone service with its own `start` script.

**Rationale**: ADR-0007 describes `colyseus`, `world-api`, and `registry` as separately deployable services. That is the correct long-term target but requires first extracting each library into an independent HTTP/WebSocket process with its own entry point, Effect runtime, and port. Doing so in this spec would dramatically expand scope. The staged approach — one combined-server container in Tier 2, separate containers in a later "service extraction" spec — maintains staging value (multi-process wiring, Neo4j + Redis integration, CI gate) without entangling two major changes in one branch.

**Staging topology**:

| Container | Package | Runnable today |
|-----------|---------|---------------|
| `server` | `server/` (combined) | ✅ `node dist/index.js` |
| `agent-host` | `ghosts/agent-host/` | ✅ `node dist/main.js` |
| `neo4j` | official image | ✅ |
| `redis` | official image | ✅ |

**Spec impact**: FR-001 in the spec references six services. This plan scopes to the four containers achievable today and adds a note in quickstart.md explaining the ADR-0007 vision and where the service-extraction work lives.

---

## Health Endpoints — Current State

**Decision**: Add a `/health` route to `server/src/index.ts` (enhance the existing partial implementation) and add one to `ghosts/agent-host/src/main.ts`. No work is needed in `server/colyseus/`, `server/world-api/`, or `server/registry/` since they run inside the combined server process and do not expose their own ports.

**Finding**: `server/src/index.ts` (lines 164–172) already handles `GET /health` via a raw Node.js `prependListener`. It returns 503 `{"status":"starting"}` until `spectatorMetaReady` is set, then 200 `{"status":"ok"}`. This is close to IC-001 but returns only `status`, not the `checks` map defined in the contract. `server/agent-host/src/` has no HTTP `/health` endpoint.

**Rationale**: Enhancing the existing combined-server health route to include a Neo4j connectivity check (required by compose `depends_on`) costs one extra query. Adding one to agent-host follows the same raw Node.js pattern. No new HTTP framework is introduced.

---

## RedisPresence — Current State

**Decision**: `RedisPresence`/`RedisDriver` wiring in Colyseus is **out of scope** for this staging spec. The combined server will use `LocalPresence` in staging.

**Finding**: Colyseus is instantiated at `server/src/index.ts:192–194` with only a `transport` option — no `presence` or `driver` key. There is no `REDIS_URL`-conditional path for `RedisPresence` anywhere in the server packages. Redis is used in the project only via `server/world-api/src/redis/RedisPublishService.ts` (`ioredis`, for pub/sub event publishing), which is separate from Colyseus presence/matchmaking.

**Rationale**: `RedisPresence` is required for horizontal Colyseus scaling (multiple replicas), which is a Tier 3 concern. The staging environment runs a single combined-server replica, so `LocalPresence` is functionally correct. Adding `RedisPresence` requires changing the server bootstrap and is a distinct architectural step; it belongs in a dedicated spike or spec.
