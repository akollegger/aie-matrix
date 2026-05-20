# Contract: Environment Variable Contract (IC-002)

**Feature**: 016-staging-deployment  
**Source**: ADR-0007 §Configuration Contract, extended with inter-service URL vars  
**Consumed by**: `@aie-matrix/root-env`; all service packages at startup

## Full Variable Table

| Variable | Required | Local default | Staging value | Consumed by |
|----------|----------|--------------|--------------|-------------|
| `NEO4J_URI` | Yes | `bolt://localhost:7687` | `bolt://neo4j:7687` | server |
| `NEO4J_USER` | Yes | `neo4j` | `neo4j` | server |
| `NEO4J_PASSWORD` | Yes | local value | from `.env.staging` | server |
| `NEO4J_AUTH` | Yes (Neo4j image) | — | `neo4j/<password>` | neo4j container |
| `REDIS_URL` | No | *(unset → LocalPresence / no-op pub-sub)* | `redis://redis:6379` | server (pub-sub only; RedisPresence not yet wired) |
| `GCS_BUCKET` | No | *(unset → local file fallback)* | *(unset in staging)* | server |
| `CONVERSATION_DATA_DIR` | No | `data/conversations` | *(unset → Neo4j store, deferred)* | server |
| `CATALOG_FILE_PATH` | No | `./catalog.json` | *(unset → Neo4j store, deferred)* | agent-host |
| `AIE_MATRIX_MAP` | No | `maps/sandbox/freeplay.map.gram` | *(unset → active map from Neo4j)* | server |
| `AIE_MATRIX_RULES` | No | *(unset → permissive)* | *(unset)* | server |
| `NODE_ENV` | No | `development` | `production` | all |
| `PORT` | No | per-package default | set per service in compose | server, agent-host |
| `WORLD_API_URL` | Yes (agent-host) | `http://localhost:<PORT>` | `http://server:<PORT>` | agent-host |
| `COLYSEUS_URL` | No | `ws://localhost:<PORT>` | `ws://server:<PORT>` | agent-host, ghost clients |

## Notes

- **`REDIS_URL`**: Currently drives only `RedisPublishService` (ioredis pub-sub). `RedisPresence`/`RedisDriver` for Colyseus is not yet wired; that work is deferred to a future spec. Setting `REDIS_URL` in staging validates the pub-sub path without enabling multi-replica presence.

- **`WORLD_API_URL`**: New variable. `agent-host` must not hard-code `localhost` for world-api calls. This variable must be added to `@aie-matrix/root-env` if not already present.

- **`NEO4J_AUTH`**: Used only by the `neo4j` Docker image (format `user/password`). The application uses `NEO4J_URI` + `NEO4J_USER` + `NEO4J_PASSWORD` separately.

- **`.env.staging.example`**: Must document every `Required: Yes` variable and every variable whose staging value differs from the local default. Committed to the repo; actual `.env.staging` is gitignored.

## Inter-Service URL Pattern

In staging, service DNS follows Docker Compose service names. Hard-coded `localhost` references in any service package are a bug; all inter-service URLs must be configurable env vars.

| Caller | Target | Variable | Compose value |
|--------|--------|----------|--------------|
| agent-host | combined server HTTP | `WORLD_API_URL` | `http://server:3000` |
| agent-host | combined server WS | `COLYSEUS_URL` | `ws://server:2567` |

Adjust port numbers to match the compose port assignments in `docker-compose.yml`.
