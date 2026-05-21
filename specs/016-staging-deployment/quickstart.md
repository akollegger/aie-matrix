# Quickstart: Staging Stack (Tier 2)

**Branch**: `016-staging-deployment`

## Prerequisites

- Docker Desktop (or any OCI-compatible runtime with Compose v2 support)
- A populated `.env.staging` file (copy from `deploy/staging/.env.staging.example` and fill required values)
- `pnpm install` completed at repo root (needed to build images, which run `pnpm build` inside the container)

## Start the staging stack

```sh
docker compose -f deploy/staging/docker-compose.yml --env-file deploy/staging/.env.staging up --build
```

On first run this builds two images (`server` and `agent-host`). Subsequent runs reuse cached layers if source has not changed. All four containers must reach `healthy` — expect 2–4 minutes on first run.

## Verify it is running

```sh
# Combined server health (includes Neo4j connectivity check)
curl http://localhost:3000/health

# Agent-host health
curl http://localhost:4000/health

# WebSocket connection (requires wscat or similar)
wscat -c ws://localhost:2567
```

## View logs

```sh
docker compose -f deploy/staging/docker-compose.yml logs -f server
docker compose -f deploy/staging/docker-compose.yml logs -f agent-host
```

## Rebuild a single service

```sh
docker compose -f deploy/staging/docker-compose.yml up --build --no-deps server
```

The remaining containers continue running. `server` reconnects to Neo4j on startup.

## Stop and preserve data

```sh
docker compose -f deploy/staging/docker-compose.yml down
```

Neo4j data is preserved in the named `neo4j-data` volume.

## Wipe Neo4j and start fresh

```sh
docker compose -f deploy/staging/docker-compose.yml down -v
```

The `-v` flag removes all named volumes including `neo4j-data`. The next `up` starts with an empty database.

## Run stateful services only (Tier 1 dev overlay)

```sh
docker compose -f docker-compose.dev.yml up
```

This starts only Neo4j and Redis. Use it when running application services outside Docker (Tier 1 workflow: `pnpm dev`).

## Interpret a health check failure

If a container stays `starting` or never becomes `healthy`:

1. `docker compose logs <service>` — check for missing env vars (service exits with a message identifying the missing variable)
2. `docker inspect <container> | grep -A5 Health` — see the last health-check exit code and output
3. Neo4j takes ~30 s to be query-ready after the JVM starts; if `server` fails immediately, increase `start_period` in the compose file or wait and retry

## ADR-0007 vision vs. current topology

ADR-0007 describes six separately-deployable services. The current codebase bundles `colyseus`, `world-api`, and `registry` into a single combined `server` process. The staging stack reflects reality: **4 containers** (server, agent-host, neo4j, redis). A future "service extraction" spec will split the combined server into independent processes to reach the full ADR-0007 topology.
