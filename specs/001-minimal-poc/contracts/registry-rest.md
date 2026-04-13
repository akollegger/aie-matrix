# Contract: Registry (REST)

**IC-001 / IC-002** — HTTP+JSON over the `server/registry/` surface (exact paths to be finalized during implementation; this document defines required capabilities).

## Provider registration (GhostHouse)

- ** Preconditions**: Valid operator/auth as required by PoC dev middleware.
- **Behavior**: Register a GhostHouse provider; receive `ghostHouseId` and any server-assigned metadata needed for subsequent adoption calls.
- ** Idempotency**: PoC MAY allow re-registration to update metadata or MAY reject duplicates; behavior must be documented and tested.

## Ghost adoption

- **Input**: `caretakerId`, `ghostHouseId`, ghost selection parameters as needed (PoC may fix a single ghost template from `random-house`).
- **Output**: `ghostId`, **Ghost Session Credential** payload (opaque token or JWT fields per `auth/`), endpoints for MCP (`world-api` base URL), and error codes.
- **Errors**:
  - Unknown caretaker or house
  - **Exclusivity violation** (IC-002): caretaker already holds an adoption; ghost already adopted; reassignment attempted

## Provisioning outputs (before MCP navigation)

Minimum fields the adopting side must receive to start navigation tools:

- Ghost identity (`ghostId`)
- Credential acceptable by `world-api` authorization
- MCP session parameters (URL, transport hints)

Exact JSON schema: add `schemas/registry.json` or OpenAPI fragment alongside implementation; this file remains the semantic checklist until those artifacts exist.
