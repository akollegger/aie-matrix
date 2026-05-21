# Data Model: Staging Deployment (Tier 2)

**Feature**: 016-staging-deployment

The staging deployment does not introduce new domain data. The entities here are the operational/infrastructure objects that the compose definition and CI workflow define.

## Entities

### Service Definition

Represents one container in the staging stack.

| Attribute | Description |
|-----------|-------------|
| `name` | Compose service key (e.g., `server`, `agent-host`, `neo4j`, `redis`) |
| `image` | OCI image tag; built locally for application services, pulled for neo4j/redis |
| `port` | Host-exposed port(s) |
| `health_endpoint` | HTTP path polled by compose (e.g., `/health`) |
| `depends_on` | Ordered list of services that must be `healthy` before this one starts |
| `env_vars` | Variables consumed by this service (subset of IC-002) |

### Named Volume

| Attribute | Description |
|-----------|-------------|
| `name` | Docker volume name (e.g., `neo4j-data`) |
| `mount_path` | In-container path (e.g., `/data`) |
| `owning_service` | The service that writes to this volume |
| `survives_down` | `true` — volume persists across `docker compose down`; `false` after `down -v` |

### Docker Network

| Attribute | Description |
|-----------|-------------|
| `name` | `aie-matrix` |
| `driver` | `bridge` |
| `attached_services` | All four staging services |

### Environment Variable (see `contracts/env-contract.md` for full table)

| Attribute | Description |
|-----------|-------------|
| `name` | Variable name |
| `required` | Whether startup fails without it |
| `local_default` | Value used in Tier 1 (dev) |
| `staging_value` | Value injected in Tier 2 via `.env.staging` |
| `consumers` | Which service packages read this variable via `@aie-matrix/root-env` |

## Service Dependency Graph (staging)

```
neo4j ──────────────────────────────► server (combined)
                                           │
redis ─────────────────────────────────────┤
                                           │
                                           ▼
                                      agent-host
```

`depends_on: condition: service_healthy` enforces this ordering in Docker Compose. Kubernetes readiness probes enforce it in Tier 3.

## Staging Topology vs. ADR-0007 Vision

| ADR-0007 Service | Staging reality | Future state |
|-----------------|----------------|-------------|
| `colyseus` | runs inside `server` container | standalone after service extraction |
| `world-api` | runs inside `server` container | standalone after service extraction |
| `registry` | runs inside `server` container | standalone after service extraction |
| `agent-host` | standalone container ✅ | unchanged |
| `neo4j` | container ✅ | Neo4j Aura (Tier 3) |
| `redis` | container ✅ | GCP Memorystore (Tier 3) |
