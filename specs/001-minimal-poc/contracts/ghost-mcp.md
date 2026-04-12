# Contract: Ghost interaction (MCP)

**IC-003** — Adopted ghosts (including house-provisioned ghosts) interact with `server/world-api/` only through MCP tools. Ghosts do not use Colyseus client libraries.

## Tools (normative names per RFC)

| Tool | Purpose |
|------|---------|
| `get_tile` | Class, occupants, capacity for a tile id |
| `get_neighbors` | Adjacent reachable tile ids from a given tile |
| `get_ghost_position` | Current tile id for the authenticated ghost |
| `move_ghost` | Request adjacent move; success or structured rejection |

## Semantics

- **Authentication**: Each tool call carries credentials derived from adoption output (exact mechanism: bearer header vs MCP session binding — document in implementation; must match `auth/`).
- **Validation**: All movement rules enforced in `world-api`; on acceptance, Colyseus state updates and spectator broadcast follows.
- **Rejection**: Response includes human- and machine-usable **reason**; ghost position unchanged (FR-011).

## Schema source

Canonical TypeScript definitions live in `shared/types/`; runtime discovery via MCP `tools/list` is authoritative for dynamic agents (see [research.md](../research.md)).
