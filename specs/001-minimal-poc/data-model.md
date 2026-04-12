# Data Model: Minimal PoC

Derived from [spec.md](./spec.md) key entities and functional requirements. Field names are indicative; exact JSON keys belong in [contracts/](./contracts/).

## GhostHouse (provider registration)

| Field | Description |
|-------|-------------|
| `id` | Stable provider id assigned by registry on registration |
| `displayName` | Human/debug label for logs and dev UI |
| `baseUrl` or `callbackDescriptor` | How registry or caretakers reach provider-specific endpoints if any (PoC may omit if unused) |
| `registeredAt` | Server timestamp |

**Relationships**: Registers before adoptions; 1:N potential ghosts offered — PoC may simplify to a single offered ghost template from `random-house`.

## Caretaker

| Field | Description |
|-------|-------------|
| `id` | Registry-issued caretaker id |
| `label` | Optional display name for dev scripts |

**Validation**: One active adoption per caretaker per session (FR-004, IC-002).

## Ghost (adopted instance)

| Field | Description |
|-------|-------------|
| `id` | Ghost instance id |
| `ghostHouseId` | Owning provider |
| `caretakerId` | Adopting caretaker |
| `tileId` | Current authoritative tile (also exposed via MCP) |
| `credentialRef` | Opaque handle or embedded dev token reference (implementation detail; must map to Ghost Session Credential) |

**State transitions**: `pending_adoption` → `adopted_active` → `stopped` (TCK and clean shutdown).

## Adoption Record

| Field | Description |
|-------|-------------|
| `caretakerId` | Caretaker |
| `ghostHouseId` | Provider |
| `ghostId` | Adopted ghost |
| `sessionId` or `runId` | PoC local session scope |
| `status` | `active` / `closed` |

**Rules**: Unique active `(caretakerId)` and unique active `(ghostId)` for exclusivity (edge cases in spec).

## Ghost Session Credential

Artifact returned to the GhostHouse (or ghost runtime) after adoption. Minimum conceptual contents:

- Token or secret authorizing MCP calls as that ghost
- MCP endpoint address for `world-api`
- Ghost id and caretaker id for logging

Exact shape: see [contracts/registry-rest.md](./contracts/registry-rest.md) and [contracts/ghost-mcp.md](./contracts/ghost-mcp.md).

## Tile

| Field | Description |
|-------|-------------|
| `id` | String or int id consistent with Tiled export |
| `tileClass` | Class string from Tiled tile **`type`** (see [contracts/sample-map.md](./contracts/sample-map.md)); consumed by the movement ruleset, not synonymous with “one rule per class name” |
| `properties` | Optional custom fields from Tiled (for example `capacity`); **PoC:** MAY be loaded and returned on tools, but **no requirement to validate or enforce any specific key on move** |
| `occupants` | Current ghost ids on tile (runtime state; PoC may still track positions without capacity limits) |

**Relationships**: Graph edges implied by neighbor lists (IC-005).

## Movement ruleset (conceptual)

Configured in `world-api`, **not** in the map file. Decides whether a proposed move between **adjacent** cells is allowed — typically over **directed edges** between source and destination `tileClass` values (for example `(from:Cyan4)-[:ALLOWED]->(to:Green1)`), with future support for predicates on arbitrary tile or world state. **PoC:** MAY be a permissive no-op that allows any class transition the graph permits; **capacity / occupancy limits are deferred** (only adjacency + ruleset gate moves unless you add stricter policy later). Evaluated only in `world-api` on **`go`** after resolving the neighbor cell from the ghost’s **`toward`** compass argument. Rejection carries machine-readable `reason` code (IC-003, FR-011).

## Sample Map Asset

Bundled under `maps/`; see [contracts/sample-map.md](./contracts/sample-map.md).

## Compatibility Check Case

Ordered checklist aligning with IC-006: provider registration → adoption → position → neighbors → valid move → invalid move → shutdown. Pass/fail and stderr/stdout requirements documented in [contracts/tck-scenarios.md](./contracts/tck-scenarios.md).
