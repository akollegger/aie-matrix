# Staging Stack — Operator Runbook

This directory contains the Docker Compose definition for the **aie-matrix Tier 2 staging environment** (ADR-0007). It runs four containers — `neo4j`, `redis`, `server` (combined Colyseus + world-api + registry), and `agent-host` — wired together on a private Docker network with health-check dependency ordering.

---

## Prerequisites

- Docker Desktop (or equivalent OCI-compatible runtime) installed and running
- `pnpm` installed (only needed if building images locally without the cache)
- A populated `deploy/staging/.env.staging` file (see below)

---

## First-Time Setup

```bash
# 1. Clone the repo and install workspace deps
pnpm install

# 2. Create your local env file from the template
cp deploy/staging/.env.staging.example deploy/staging/.env.staging

# 3. Edit .env.staging — at minimum set these secrets:
#    NEO4J_PASSWORD, NEO4J_AUTH, GHOST_HOUSE_DEV_TOKEN
```

**Required variables** (no defaults — the stack will not start without them):

| Variable | Description |
|----------|-------------|
| `NEO4J_PASSWORD` | Neo4j database password |
| `NEO4J_AUTH` | `neo4j/<password>` — used by the Neo4j container image |
| `GHOST_HOUSE_DEV_TOKEN` | Bearer token for agent-host authenticated requests |

See `specs/016-staging-deployment/contracts/env-contract.md` for the full variable reference.

---

## Start the Stack

```bash
docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up --build
```

The `--build` flag rebuilds images from source. Omit it on subsequent runs if source hasn't changed.

Startup order (enforced via `depends_on: condition: service_healthy`):

```
neo4j  →  redis  →  server  →  agent-host
```

Each container only starts once its dependency reports healthy. Full cold-start (including image builds) takes **under 5 minutes** on a standard broadband connection.

**CI observed duration**: ~1m53s on `ubuntu-latest` (GitHub Actions, 2026-05-21).

---

## Verify the Stack is Healthy

```bash
# Check all service statuses
docker compose -f deploy/staging/docker-compose.yml ps

# Verify combined server health (should return {"status":"ok","checks":{"neo4j":true}})
curl http://localhost:8787/health

# Verify agent-host health (should return {"status":"ok","checks":{"world-api":true}})
curl http://localhost:4000/health

# Open a WebSocket to Colyseus (requires wscat: npm install -g wscat)
wscat -c ws://localhost:8787
```

---

## Inspect Logs

```bash
# Stream all service logs
docker compose -f deploy/staging/docker-compose.yml logs -f

# Stream a single service
docker compose -f deploy/staging/docker-compose.yml logs -f server
docker compose -f deploy/staging/docker-compose.yml logs -f agent-host
docker compose -f deploy/staging/docker-compose.yml logs -f neo4j
```

---

## Rebuild a Single Service

Use `--no-deps` to rebuild and restart one service without touching the others:

```bash
docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server
```

The service will reconnect to its dependencies (Neo4j, Redis) automatically. A healthy reconnect takes **under 60 seconds**. The remaining services continue running throughout.

> **Note**: Rebuilding `server` causes `agent-host` to temporarily report `degraded` (its `/health` checks `server`). Once `server` is healthy again, `agent-host` recovers automatically on its next health check cycle (~10 s).

---

## Stop the Stack

```bash
# Stop containers (preserve Neo4j volume)
docker compose -f deploy/staging/docker-compose.yml down

# Stop AND wipe Neo4j data volume (full reseed on next start)
docker compose -f deploy/staging/docker-compose.yml down -v
```

---

## Interpret Health Check Failures

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `neo4j` never healthy | Wrong `NEO4J_AUTH` format | Set `NEO4J_AUTH=neo4j/<password>` (slash separator) |
| `server` stuck in `starting` | `NEO4J_PASSWORD` mismatch, or Neo4j slow JVM startup | Check `neo4j` logs; increase `start_period` if needed |
| `server` reports `degraded` | Neo4j reachable but query failed | Check `server` logs for constraint/seed errors |
| `agent-host` stuck `starting` | `server` not yet healthy | Wait; `agent-host` depends on `server` via `depends_on` |
| `agent-host` reports `degraded` | `WORLD_API_URL` wrong or `server` restarting | Check `WORLD_API_URL=http://server:8787` in `.env.staging` |
| Image build fails mid-build | pnpm cache miss or network error | Run `docker compose build --no-cache` |

---

## 4-Container vs. 6-Container Vision

ADR-0007 describes six separately deployable services: `neo4j`, `redis`, `colyseus`, `world-api`, `registry`, and `agent-host`. The current staging stack runs **4 containers** because `server/colyseus`, `server/world-api`, and `server/registry` are library packages with no standalone entry points — they run inside the combined `server` container.

Reaching the 6-container vision requires a "service extraction" effort (splitting the combined server into independent processes). That work is tracked in a future spec. The 4-container staging stack fully validates multi-process wiring, Neo4j + Redis integration, and the CI gate described in ADR-0007.

---

## Tier 1 Helper (Local Dev Without Docker App Containers)

If you only need Neo4j and Redis running locally (to run `pnpm dev` against real infrastructure), use the Tier 1 dev compose file at the repo root:

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm dev
```

This starts only Neo4j and Redis — no application containers.
