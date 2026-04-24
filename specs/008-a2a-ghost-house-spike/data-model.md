# Data Model: 008 A2A Ghost House Spike

Spike-only logical entities. Not persisted to Neo4j or production stores.

## CatalogEntry

| Field | Description |
|--------|-------------|
| `agentId` | Stable string id used for lookup (may mirror agent card `name` or URL-derived id — spike chooses one rule and documents it). |
| `card` | Agent card JSON (RFC-0007 extended shape where exercised). |
| `baseUrl` | Reachable agent root URL used for spawn / task delivery. |
| `registeredAt` | ISO timestamp (optional; in-memory ok). |

## SpawnSession

| Field | Description |
|--------|-------------|
| `sessionId` | Correlation id for logs / demo (UUID or SDK task id). |
| `agentId` | Foreign key to `CatalogEntry`. |
| `status` | `pending` \| `active` \| `ended` (spike-defined enum). |

## SyntheticWorldEvent (Spike B)

| Field | Description |
|--------|-------------|
| `eventId` | Unique id for idempotency notes in report. |
| `kind` | Literal string discriminator, e.g. `demo.world.tick`. |
| `payload` | JSON object — minimal shape under `contracts/ic-008-spike-synthetic-world-event.md`. |
| `sentAt` | ISO timestamp. |

## AgentResponseSample (Spike B)

| Field | Description |
|--------|-------------|
| `inReplyTo` | `eventId` of the synthetic event. |
| `body` | JSON or text — captured verbatim in report for RFC diff. |

## SpikeEvidence

| Field | Description |
|--------|-------------|
| `pattern` | One of: `sync_task`, `streaming_task`, `push_notification`, `agent_card`. |
| `outcome` | `pass` \| `fail` \| `partial`. |
| `notes` | Freeform; must label operator-error vs SDK limitation when `fail`. |

Relationships:

- `CatalogEntry` 1 — * `SpawnSession` (over lifetime of demo).
- `SpawnSession` receives `SyntheticWorldEvent` and expects `AgentResponseSample` (1:1 for minimal spike).
