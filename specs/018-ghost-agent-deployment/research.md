# Research: Ghost Agent Deployment (018)

## Decision 1: Self-registration idempotency on restart

**Decision**: On startup, attempt `DELETE /v1/catalog/:agentId` (ignore 404), then `POST /v1/catalog/register`. If DELETE returns 409 (`ActiveSessionsPreventDeregister`), log a warning and continue — the agent-host supervisor will health-check the stale entry and mark it failed within 30s, at which point the operator can deregister manually via the admin panel.

**Rationale**: Ghosts restart frequently during development and after K8s pod recycling. The catalog is file-backed and does not auto-expire entries. Without deregister-before-register, a restarted container with a new `RANDOM_AGENT_PUBLIC_BASE_URL` (different pod IP) would fail to spawn because the agent-host would use the stale URL. Deregistering first ensures the catalog always reflects the live URL after a clean restart.

The 409 (active sessions) exception is safe: if sessions are active, the old agent process may still be alive on the old IP, and force-deregistering would orphan those sessions. The supervisor's health-check timeout (30s) handles this automatically.

**Alternatives considered**: 
- Upsert via deregister-always (regardless of 409) — rejected because it orphans live sessions without graceful shutdown.
- Rely on health-check to clean up stale entries — rejected because the agent-host has no mechanism to update the catalog URL; it only marks sessions failed, not catalog entries.

---

## Decision 2: Agent ID strategy for K8s replicas

**Decision**: Each ghost container uses `agentId = random-agent-${HOSTNAME}`, where `HOSTNAME` is the pod name (set automatically by K8s). For local dev (single instance), `HOSTNAME` is the machine hostname, producing e.g. `random-agent-dev-macbook`.

**Rationale**: A shared `agentId` across replicas would cause registration conflicts (each replica starts and tries to register the same ID). Using `${HOSTNAME}` makes each replica self-describing, unique in the catalog, and removes the need for replica-coordination logic. The agent-host treats each as a distinct schedulable instance.

**Alternatives considered**:
- Static `agentId: "random-agent"` — only works for single-instance deployments; breaks with replicas.
- Injected `AGENT_ID` env var — operator must set it per-replica, which defeats the point of K8s Deployments.
- UUID suffix — unique but not human-readable; operators can't correlate catalog entry to pod name.

---

## Decision 3: `/health` endpoint implementation

**Decision**: Add `GET /health` to the random-agent express server that returns `{ "status": "ok" }` (HTTP 200) when the A2A JSON-RPC handler is initialized and the server is listening. No dependency checks (agent-host reachability is not a health concern for the ghost itself — it registers separately).

**Rationale**: The health endpoint is required by compose `depends_on: condition: service_healthy` and K8s readiness/liveness probes. The ghost's only true health signal is "is my A2A server accepting connections." Agent-host reachability is checked at registration time (startup), not continuously.

**Alternatives considered**:
- Health endpoint checks agent-host connectivity — rejected because a network blip to agent-host would mark the ghost unhealthy, causing K8s to restart it unnecessarily. The ghost should stay healthy as long as its own server is running.

---

## Decision 4: Dockerfile structure

**Decision**: Copy `server/agent-host/Dockerfile` exactly, changing only the pnpm filter chain. Build order: `root-env` → `shared-types` → `ghost-ts-client` → `random-agent`.

**Rationale**: The agent-host Dockerfile already handles pnpm workspace, offline install, and the `deploy` subcommand for a self-contained artifact. The three-stage pattern (base/build/runner) is established in Spec 016 as the canonical approach. Diverging from it without reason adds maintenance surface.

**Alternatives considered**:
- Single-stage build — larger image, includes dev dependencies and build tools. Rejected.
- Turborepo or nx — not in the repo; would add tooling overhead.

---

## Decision 5: Compose placement and health-check

**Decision**: `random-agent` starts after `agent-host` (`depends_on: agent-host: condition: service_healthy`). The agent's health check uses `CMD curl -f http://localhost:4001/health` with a 30s start period to allow registration and agent-host connection.

**Rationale**: The ghost must be able to call `POST /v1/catalog/register` on startup, which requires agent-host to be healthy first. The dependency ordering matches the logical dependency.

**Alternatives considered**:
- Start in parallel with retry loop — possible but more complex; `depends_on` is the compose-native solution.
- Agent-host waits for ghosts — inverted; ghosts register to the host, not vice versa.

---

## Key implementation findings from reading the source

**`random-agent/src/agent.ts` already has:**
- `AGENT_HOST_TOKEN` env var (not `GHOST_HOUSE_DEV_TOKEN` — rename already done in this file)
- `AGENT_PORT` for the listening port
- `RANDOM_AGENT_PUBLIC_BASE_URL` for the public-facing URL used in the agent card
- Full A2A server via `@a2a-js/sdk/server/express` with `agentCardHandler` and `jsonRpcHandler`
- Bearer token auth via `requireToken` middleware

**What needs to be added to `agent.ts`:**
1. `GET /health` route (before server starts listening)
2. Startup self-registration: `DELETE` stale entry (ignore 404/409 with warning), then `POST /v1/catalog/register`
3. SIGTERM handler: `DELETE /v1/catalog/:agentId` before exiting
4. `AGENT_HOST_URL` env var for the agent-host base URL

**`agentId` construction**: `random-agent-${process.env.HOSTNAME ?? "local"}`

**Registration payload**: `{ agentId, baseUrl: publicBase }` — agent-host fetches the card from `${publicBase}/.well-known/agent-card.json`. The `publicBase` is already `RANDOM_AGENT_PUBLIC_BASE_URL`.

**Retry loop**: Registration should retry with 2s backoff up to `AGENT_REGISTER_TIMEOUT` (default 120s) to handle agent-host not yet ready — especially in compose where startup ordering adds latency.
